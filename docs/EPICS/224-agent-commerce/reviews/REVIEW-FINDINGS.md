# Review Findings — AgentCommerce (EPIC-224)
## Scope
commerce-store.ts, commerce-repository.ts, commerce/{types,state-machines,events,guards,index}.ts, commerce/services/{ctx,task,offer,agreement,submission,evidence,payment}-service.ts, routes/commerce/{shared,tasks,offers,flows,index}.ts, middleware/agent-auth.ts. Not provided, so unverified: `idempotentWrite` (`contract-guards`), `CONTRACT_LIMITS` (`machine-entry`), the Prisma schema and migrations (unique constraints, column types), `error-response` and the global `onError`.

## Verdict
**REQUEST CHANGES.** The authn and authz core is sound: all 12 write routes require a signature, actors come only from the verified header, and per-row guarded transitions hold. The multi-entity workflows, though, are written as unguarded sequences of independent writes, with no precondition checks on sibling entities and no transaction. Ordinary, non-adversarial call orders (accept a second offer, cancel then accept, submit twice) leave permanently inconsistent, terminal-state rows. Idempotency scoping and signature/body binding also need fixing before this is exposed publicly. No funds are at risk, because payment is RECORD_ONLY. The risk is corrupt state and forgeable "verified" commerce history.

## Critical

### C1. Offer accept is a non-atomic 7-step sequence with no sibling preconditions
`offer-service.ts:119-184`. Order of writes: offer → ACCEPTED (134), `agreements.create` (141), emit (156), task → IN_PROGRESS (163), `payments.create` (166), emit (176). There is no `$transaction` anywhere in `commerce-repository.ts`, and the in-memory stores have no equivalent. `accept` never checks `task.status === "OPEN"` or whether the task already has an agreement.

Exploit scenarios, all reachable by the buyer with ordinary calls and no concurrency:
1. **Second accept.** Task has PENDING offers A and B. Buyer accepts A, so the task goes IN_PROGRESS. Buyer then accepts B. The offer transition at 134 passes (B is PENDING), then `agreements.create` returns null on the `taskId` uniqueness, so line 154 throws `conflict`. Offer B is now **ACCEPTED forever with no agreement**, and the offer is terminal so it cannot be repaired. Provider B sees an "ACCEPTED" offer.
2. **Cancel, then accept.** `cancel` (task-service.ts:109-126) leaves PENDING offers PENDING. Buyer cancels the task, then accepts a pending offer. The offer goes ACCEPTED and an **ACTIVE agreement is created for a CANCELLED task** (141). Only then does the task transition CANCELLED → IN_PROGRESS throw (163), so no payment row is ever created. The orphan ACTIVE agreement lets the provider submit work (submission-service.ts:85 checks only agreement status).
3. **Mid-sequence failure.** Any DB or emit error between 134 and 166 leaves a partial graph. Examples: agreement with no payment row, so `payment.record` returns 404 forever (payment-service.ts:43); or task still OPEN with an ACCEPTED offer. Nothing retries or compensates.
4. **Concurrent accepts of two different offers.** Both pass the pre-checks. On Postgres the loser hits the DB unique violation (see H6), which is thrown raw as a 500 after its offer was already set ACCEPTED.

Fix: run accept in one DB transaction and take a row lock on the task (`SELECT … FOR UPDATE`). Require `task.status === "OPEN"` and no existing agreement before any write. Create the payment row inside the same transaction. Auto-reject sibling PENDING offers at accept and at cancel.

### C2. Submit and review persist a terminal row before validating the rest of the graph
`submission-service.ts`.
- **Orphan submissions.** `doSubmit` creates the submission (93) and emits (109) before touching the task. If the task is already UNDER_REVIEW (a second submit), the `IN_PROGRESS` branch is skipped (122) and `transitionRow(... "UNDER_REVIEW")` at 132 throws UNDER_REVIEW → UNDER_REVIEW, returning 409. **The new SUBMITTED row and its event stay persisted.** A provider can loop this call to create unbounded orphan submissions, each returning an error. Every orphan stays reviewable.
- **Terminal verdict stuck.** `review` marks the submission ACCEPTED/REJECTED (165-176) before it checks the task and agreement. It never checks `task.status === "UNDER_REVIEW"`, that this is the latest submission, or that the agreement is ACTIVE. The task and agreement transitions (181-202) can then throw. Example: provider round 1, buyer REJECTS (task goes IN_PROGRESS), and an orphan submission from round 1 is still SUBMITTED. The buyer reviews the orphan ACCEPTED. The submission becomes ACCEPTED (terminal) and `IN_PROGRESS → COMPLETED` throws. The result is an ACCEPTED submission on a task that can never complete. The same happens if the task is CANCELLED or SUBMITTED. If the agreement transition at 184 fails, the task is COMPLETED and the agreement stays ACTIVE.
- **Cancel vs. review race.** Task transitions are guarded (cancel and review both start from UNDER_REVIEW, only one wins), but the loser runs after the submission row was already moved to terminal.
- **Stuck SUBMITTED.** If the `SUBMITTED → UNDER_REVIEW` step at 132 fails after 123 succeeded, the task is stuck in SUBMITTED. The only legal exits are UNDER_REVIEW or CANCELLED, and `review` can never complete it.

Fix: check preconditions first (`agreement.status === ACTIVE`, `task.status === UNDER_REVIEW`, submission is the head, no other SUBMITTED row). Then apply all writes in one transaction, or order them so the most reversible write comes last. Collapse the transient SUBMITTED task state.

## High

### H1. Idempotency is not scoped to the actor or to the request
`task-service.ts:42`, `offer-service.ts:56`, `submission-service.ts:57`, `evidence-service.ts:40`. `idempotentWrite(scope, key, fn)` receives only a constant scope string (`"commerce.offer.submit"`) and the raw header value. It gets no wallet, no taskId or agreementId, and no body fingerprint. Unless `idempotentWrite` derives them some other way (it cannot see the closure), the key space is **global per operation**. The brief says the key is buyer/provider-scoped, and the code does not do that.
- **Cross-user disclosure.** Wallet B replays Wallet A's key (leaked in logs or guessed, e.g. `offer-0001`). B gets `duplicate: true` and **A's full row** from the cached body. This includes A's DRAFT task, which is supposed to stay private.
- **Targeted suppression.** An attacker pre-claims a victim's predictable key (8-128 chars). The victim's later create silently no-ops and returns 200 with the attacker's entity, so the victim believes the offer or task was created.
- **Cross-resource collision.** The same key reused by one provider on task A and task B returns offer A for task B.
- **Retry hazard.** A retry replays the stored first-time snapshot, not current state.

Fix: namespace by `scope|wallet|resourceId|sha256(canonicalJson(body))`. Reject the same key with a different fingerprint (422). Never return another wallet's row.

### H2. Signature is not bound to the body or a nonce, so captured headers can be replayed
`agent-auth.ts:197-221`, `shared.ts:21-41`. The challenge covers wallet, method, path and timestamp (48-52) but not the body or the `idempotency_key` header. There is no nonce or replay cache, and the window is symmetric ±300s (209-210), so a validly signed request is replayable for up to 600s.
- Anyone holding `X-Wallet/X-Sig/X-Timestamp` (reverse-proxy or APM header logs, a relaying agent) can replay `POST /api/commerce/tasks/:id/offers` with **an attacker-chosen `price`/`proposal`**. The same works for `POST …/agreements/:id/submissions` with a malicious `resultUrl`, `POST …/agreements/:id/payment` with an arbitrary `note`/`paymentId`, and `POST /tasks` as spam creation.
- Replay of the original request before it is processed (front-run) lets the replayer swap the body. For `/review` the verdict is in the body, so ACCEPTED can be swapped for REJECTED.
- Path binding blocks cross-endpoint replay (good), but the challenge has no host/audience/environment, so a staging signature is valid on production for identical paths.

Fix: sign `sha256(body)` plus the idempotency key in the challenge. Add a short-lived nonce cache (`wallet:sig` for 10 min). Include host and chain id as a domain separator.

### H3. PAYMENT_VERIFIED has no separation of duties, and any wallet can farm commerce history
`payment-service.ts:81-93`, `shared.ts:21`. `record` is buyer-only (40), but `verify` accepts either agreement party. The buyer can call record then verify immediately. `verifiedBy === recordedBy` is allowed, so "verified" does not mean "confirmed by the counterparty". Nothing is checked against the chain: `paymentId` is optional and `amount` is not stored (see M3).

Sybil path: wallet X creates a task, wallet Y offers, X accepts, Y submits, X reviews ACCEPTED, X records, Y verifies. The graph is fully COMPLETED and PAYMENT_VERIFIED at zero cost. `requireWallet` demands only a signature, with no pass or stake. Any badge, reputation or ranking derived from these rows can be farmed.

Fix: require `verifiedBy === agreement.providerWallet` (the payee). Require a txHash or paymentId for verify, or check it against the chain when EXTERNAL_PAYMENT ships. Label RECORD_ONLY rows "self-reported" in the API and docs.

### H4. DRAFT, CANCELLED and private data are publicly readable despite the stated model
`tasks.ts:87-91, 118-136`; `flows.ts:229-241`. `GET /tasks?status=DRAFT` or an unfiltered `GET /tasks` lists every wallet's DRAFT tasks, although the route doc (`tasks.ts:35`) says DRAFT "stays private". `GET /tasks/:id` and `/tasks/:id/events` serve DRAFT tasks, including `title` in the `task.created` payload (`task-service.ts:87`). The task detail also returns, to any caller, every provider's `submissions` (summary, `resultUrl`, payload, `reviewNote`) and the payment row (`note`, `paymentId`, `recordedBy`). Deliverables are therefore readable before the buyer accepts or pays.

Fix: for non-parties, hide DRAFT and redact submission, payment and note fields. Alternatively expose a party-only authenticated read.

### H5. Client-asserted identity links are stored unverified
`task-service.ts:71`, `offer-service.ts:99`. `buyerAgentId` and `providerAgentId` are copied from the request body with no check that the signing wallet owns that Passport agent. Anyone can attribute a task or offer to someone else's agent id. If any UI or reputation code trusts the link, this forges identity. Verify ownership against the Passport registry, or drop the field from inputs.

### H6. Check-then-insert in the Postgres repositories surfaces uniqueness races as raw 500s
`commerce-repository.ts:293-297` (agreement), `546-549` (payment), also 176, 243, 365, 436, 486. Each `create` pre-checks with `getById`, `getByTaskId` and so on, then inserts. The `id` pre-check is pointless, since ids are random UUIDs. The `taskId`/`offerId`/`agreementId` pre-checks are a TOCTOU gap, and the unique constraint is the only real guard. I cannot see that constraint in the provided files. A violation throws a Prisma error. It is not mapped to `null`, which breaks the store contract ("`null` on duplicate", `commerce-store.ts:131, 290`). It reaches `commerceError`, which rethrows non-`CommerceError` values (`shared.ts:79`), so the caller gets a 500 after the offer was already marked ACCEPTED (see C1). In-memory `create` has no `await` between check and set, so it is atomic there.

Fix: catch the unique-violation code in each repo `create`, return `null`, and add `try/catch` mapping in the services. Confirm the unique indexes exist in the migration.

### H7. Event hash chain forks across processes, and state and event writes are not atomic
`events.ts:30-38, 41-57`, `ctx.ts:41-56`.
- The queue is a per-`CommerceEventEmitter`, in-process promise chain. With more than one server instance (or `createCommerceService` called twice), read-then-append (`listByEntity` at 41, `append` at 57) can read the same head and **fork the chain**. The store has no compare-and-set, and no unique `(entityType, entityId, prevHash)` is visible.
- `transitionRow` writes status (41) then emits (46). If `emit` throws, status has changed with no event, and the chain cannot reveal a missing tail event. The client sees a 500 and a retry gets 409.
- Causal order is not guaranteed. Two requests on one task can enqueue emits in the opposite order to their DB commits, producing `task.cancelled` before `task.in_progress` in the chain.
- One global FIFO means a single hung DB call blocks every emit for the instance (no timeout).

Fix: insert the event in the same DB transaction as the status change. Add a unique `(entityType, entityId, prevHash)` index or a per-entity sequence, with retry on conflict. Add a statement timeout.

## Medium

### M1. Input validation is bypassed because create routes never run the zod schemas
`tasks.ts:50`, `offers.ts:50`, `flows.ts:54, 188` cast the body (`body as unknown as …`). The schemas in `shared.ts:84-130` are OpenAPI documentation only for these routes, and they are not enforced. Service guards cover only some fields:
- **URL schemes.** `resultUrl` (`submission-service.ts:98`) is stored unvalidated. Evidence `url` is checked only with `Boolean(input.url)` (`guards.ts:138, 157`). `javascript:`, `data:` and `file:` URLs are accepted, which is stored XSS if any UI renders them as `href`. There is no length cap either.
- **Hash format.** Only FILE, HASH and TRANSACTION validate `hash` (`guards.ts:140-155`). For URL, API_RESPONSE and ATTESTATION an arbitrary string is stored in `hash`. Hex case is not normalised (`SHA256_RE` has `/i`, the value is stored as sent).
- **Unbounded or untyped fields.** There is no cap on `title`, `eta`, `paymentId`, evidence `content`, or any `payload`/`requirements`/`metadata` JSON. `currency`, `expiresAtMs`, `buyerAgentId` and `providerAgentId` have no type check. `expiresAtMs: "x"`, `1e300` or `1.5` throws in `BigInt(...)` (`commerce-repository.ts:191, 309`) and becomes a 500. `\u0000` in any string or JSON is rejected by Postgres text/jsonb, also as a raw 500.
- **evidenceRefs cap bypass.** `submission-service.ts:101-106` spreads user `payload` after `evidenceRefs`, so `payload: {evidenceRefs: [...5000 items]}` overwrites the validated list. The 50×1000 cap is skipped.
- **Decimal strings.** `assertDecimal` (`guards.ts:109-117`) is solid: ASCII digits only, so no NaN, Infinity, negatives or exponents. It has no length, scale or maximum limit, though. 100k digits, 20 decimal places and `"0"` are all accepted and stored unnormalised (`"007.50"`). That risks numeric overflow and a 500 at the DB, and a rounding mismatch once real settlement ships (USDC has 6 decimals).

Fix: parse each body with its zod schema in the route (with `.max()`, `.url()` limited to `https:`, a `.regex()` for the hash, and a serialised-JSON byte cap). Normalise hex to lowercase and decimals to a canonical form with scale ≤ 6.

### M2. Public list and detail endpoints are unbounded
`tasks.ts:75-91`: the route doc promises "default 50, max 200", but `limit` is applied only when the query parameter is supplied. A plain `GET /tasks` returns every row. `GET /tasks/:id` returns all offers and submissions. Providers can submit unlimited offers per task with no `(taskId, providerWallet)` uniqueness check (`offer-service.ts:95`), despite "single-round" (D-224-9), which inflates that response. `emit` also reads the entire entity stream on each append (`events.ts:41`). Apply a default limit and add pagination. Cap offers per provider per task.

### M3. Payment `amount` is validated and then dropped, and the event does not commit to the recorded data
`payment-service.ts:48-50, 57-66`. `input.amount` is validated, but `applyStatus` (`PaymentStatusPatch`, `commerce-store.ts:280-287`) has no amount, so a recorded amount is silently ignored. The `payment.recorded` event (via `transitionRow`) contains only `from/to`, not `note`, `paymentId` or `amount`. Likewise `submission.reviewed` carries no `reviewNote`. The hash chain proves status transitions only, not entity content, so the stored columns can change without breaking the chain.

### M4. Audit trail loses the actor on most transitions
`transitionRow` takes `actorWallet` through `opts`. These calls omit it, so `actorWallet` is null: task open (`task-service.ts:104`), task cancel and cascade (`115, 121`), offer reject and withdraw (`offer-service.ts:195, 207`), the task transitions in `submission-service.ts:123, 132, 181-202`, and the agreement completion. For a hash-chained audit log, "who cancelled" is missing. The event also holds only the server's assertion of the actor. The request signature is not stored in the event, so the chain is not non-repudiable. It is unkeyed SHA-256, and anyone with DB write access can recompute the whole chain. No head is anchored externally.

### M5. Hash chain is never verified, and its coverage is thin
No file in the bundle contains a `verifyChain` function. Public readers get `prevHash` and `hash` but have nothing that checks them. Tail truncation or whole-stream deletion is undetectable. `eventSeq`, `id` and `createdAt` are excluded from the hash (documented at `state-machines.ts:114`). So order and timestamps can be altered undetected. `canonicalize` serialises `Date` as `{}` and `JSON.stringify` rejects `BigInt`. Current payloads avoid both, so this is latent. `store.latest()` is documented as the "chain head" (`commerce-store.ts:243`) but chains are per entity, and the emitter never uses it.

### M6. Evidence has no author column, and attach is not gated on state
`commerce-store.ts:188-202` has no `attachedBy`. The author exists only in the `evidence.attached` event, keyed on the evidence id, and the public feed exposes only task events. Both parties can append to any submission (`evidence-service.ts:85-101`), so the buyer can attach evidence that is indistinguishable from the provider's own. There is no agreement or submission status check, so evidence can be appended after COMPLETED or CANCELLED. Add `attachedBy` and restrict attach to ACTIVE agreements.

### M7. Cancel semantics and cascade gaps
`task-service.ts:109-126`. The buyer can cancel in SUBMITTED or UNDER_REVIEW after the provider has delivered, and the machine permits it (`state-machines.ts:21-24`). The cascade cancels only an ACTIVE agreement. It leaves PENDING offers (still acceptable, see C1), SUBMITTED submissions (still reviewable, see C2) and the payment row untouched. A buyer can also reject forever (REJECTED/REVISION_REQUIRED loops the task to IN_PROGRESS) with no round cap and no DISPUTED path (D-224-5, D-224-12), which is a griefing vector against providers. Cancel is task-then-agreement, two non-atomic writes.

### M8. Auth hardening
- `agent-auth.ts:81`: with `ARC_RPC_URL` unset, the ERC-1271/6492 check silently falls back to a hardcoded testnet RPC. A production server would validate contract-wallet signatures against the wrong chain. Fail at startup instead.
- ERC-6492 verification makes an RPC `eth_call` per request, before any rate limit. Unauthenticated callers can consume the RPC quota. Add per-IP and per-wallet throttling ahead of verification.
- `agent-auth.ts:141`: `configureAgentAuthForTesting` is exported from the production module and replaces the verifier globally. If any production path can reach it, it is a full auth bypass. Gate it on `NODE_ENV === "test"`.
- `agent-auth.ts:207`: `Number(timestampRaw)` accepts `"1e9"`, `"0x…"` and `"…0.0"`, so many distinct header strings sign to the same message (the message uses the numeric value). Any future replay cache keyed on raw headers would be defeated. Require `/^\d{10}$/`.
- `shared.ts:43`: the idempotency header is `idempotency_key` with an underscore. Many proxies (nginx default) drop underscore headers, which silently disables idempotency. Use `Idempotency-Key`.

### M9. Other state and data integrity gaps
- `offer.currency` may differ from `task.currency` and nothing checks it (`offer-service.ts:101`). The agreement inherits the offer currency. `price` is not compared to `budget`.
- Unknown (non-`CommerceError`) errors are rethrown (`shared.ts:79`), so exposure depends on the global handler, which was not provided. Raw Prisma errors can include internal SQL, constraint and column names. Confirm the handler returns a generic 500 with a request id only.
- Memory impl: `Map` rows are returned by reference (for example `append`, `getById`), and `payload` is shared with the caller (`commerce-store.ts:529-543, 572-580`). A caller that mutates a returned event or its payload alters the "append-only" store without changing the hash. Freeze or structured-clone on insert and return. Unbounded growth and O(n) scans (`getByTaskId`, `latest`, agreement and payment `create`) make a long-lived DATABASE_ENABLED=off process a memory and CPU DoS target.

## Nits / Suggestions
- `task-service.ts:66` throws `forbidden` (403) for an invalid `status` value. `GUARD_REJECTED` (400) is correct.
- Create task is two steps (DRAFT row, then OPEN) at `task-service.ts:68-93`. A failure between them leaves a DRAFT task, and with an idempotency key the retry behaviour depends on whether `idempotentWrite` caches errors. Create directly in the requested status inside one transaction.
- State machine: `DISPUTED` is a dead end (`[]`) with no resolution path, and `SUBMITTED` on the task is redundant (always followed immediately by UNDER_REVIEW). Both are worth revisiting before DISPUTED is wired.
- Event type naming: `task.in_progress` is used for both the first accept and the rejection rollback, distinguishable only by `payload.from`.
- Action endpoints (accept, review, record) return 409 on a retry after a timeout the server actually completed. Consider returning the current state if the actor and target state match.
- `ORDER BY createdAt` ties (submissions, evidence, offers, tasks) are not deterministic at same-millisecond resolution. Order by an auto sequence.
- `limit` is fine, but the `buyer` filter (`tasks.ts:89`) is not validated as an address. It is harmless because it is parameterised.
- `newId` slices 24 hex chars off a UUIDv4 (about 90 random bits), which is adequate. Authz never relies on id secrecy, which is correct.
- Add Postgres `REVOKE UPDATE, DELETE` (or a trigger) on `CommerceEvidence` and `CommerceEvent`, so append-only is enforced below the TypeScript interface.
- `Number(r.submittedAtMs)` is safe for epoch ms, but add a note if int8 is ever used for larger values.

## Verified-good
- **Every write route is signature-gated.** All 12 write handlers (tasks: create, patch, cancel; offers: submit, accept, reject, withdraw; flows: submit, review, evidence, record, verify) call `requireWallet` first. The 5 GET routes are intentionally public.
- **Actors never come from client input.** Services receive the wallet only from `requireWallet`. Buyer, provider and agreement-party identity is always compared against stored rows (`task.buyerWallet`, `offer.providerWallet`, `agreement.*Wallet`). Request bodies never supply a wallet. Zod strips unknown keys on the routes that use it.
- **Wallet canonicalisation holds.** The challenge lowercases the address (`agent-auth.ts:48`). `isAddress` is strict, so bad mixed-case checksums are rejected. `assertWallet` lowercases and enforces `^0x[0-9a-f]{40}$`. No non-ASCII character lowercases to a hex digit, so Unicode tricks cannot pass.
- **Authz is checked before state.** In `accept`, `submit`, `record`, `reject` and `withdraw` the 403 comes before any transition, so a non-party cannot probe state through error text.
- **Guarded transitions are correct.** `applyStatus` is `WHERE id AND status = expectedFrom`, and `null` becomes `INVALID_TRANSITION`. In-memory `applyStatus` is synchronous, so it is atomic on the event loop. Concurrent double-accept, double-review and double-record of the same row yield exactly one winner.
- **State machine is closed and complete.** Terminal states have empty edge lists. Every status write in the services goes through `transitionRow` and `assertTransition`. I found no direct store `applyStatus` call outside it (the only direct calls are inside the `transitionRow` callbacks). Evidence has an empty table and no update path. Payment can only go NOT_PAID → PAYMENT_RECORDED → PAYMENT_VERIFIED, so **verify without record is impossible**.
- **Payment is never auto-derived from task or agreement status.** There is no code path in task, offer or submission services that touches payment status beyond creating the NOT_PAID row at accept.
- **Offers and evidence are immutable by interface.** The store surface has no update or delete for offers' content, evidence or events (`commerce-store.ts`). Offer price cannot be changed between view and accept. Provider withdraw and buyer accept race safely, with one winner.
- **Replay is path-bound across endpoints.** Method and the full path (including the entity id) are signed. Verification failures are caught and fail closed. The skew window is enforced symmetrically.
- **Money is a string at the edge.** The decimal regex is ASCII-only, so exponents, signs, NaN and Infinity are impossible. Stored as `numeric` on Postgres.
- **Error mapping is tidy.** `CommerceError.detail` is not forwarded to clients (`shared.ts:64-80`). Messages echo only ids the caller supplied.
- **Hash primitives are sound.** Recursive sorted-key canonical JSON, SHA-256, per-entity genesis sentinel, and the `eventSeq` exclusion is documented and justified. In-memory `eventSeq` is gapless. Postgres sequence gaps are benign because chain linkage does not depend on contiguity.
