# Review Findings — a2a-settlement (EPIC-227)
## Scope
All 20 attached files: `lib/settlement/{types,state-machines,invariants,verify-payout-tx,receipt}.ts`, `services/{ctx,plan-service,milestone-service,payout-service,dispute-service,dispute-resolve,anchor,receipt}.ts`, `routes/settlement/{settlement,settlement-admin,settlement-receipts,helpers}.ts`, `lib/commerce/{settlement-bridge,services/offer-accept,services/submission-review}.ts` (not attached, so every claim about them is marked "unverified": `finops/{guards,admin-actions,payment-mutex}`, `settlement/events`, the `atomic()`/store implementations and DB constraints, `adminAuth`, `cacheHeadersMiddleware`, `commerce/shared`, `eaas/{anchor,verdict}`, `board/task-receipt`, commerce submission-create).

## Verdict
**BLOCK**

The domain core is carefully built (decimal money, set-once guarded leg completion, honest `auditRecorded`). The edges are not safe to merge or take near mainnet. One counterparty can author the settlement terms of an agreement the commerce layer never approved (C1). The SPLIT outcome can never reach RELEASED (H1). Several resolve and dispute paths act on live status instead of the dispute's own freeze map (H3), and correctness depends on an unverified `atomic()` rollback convention (H2). Fix C1 and H1–H4 and re-review.

## Critical

### C1. Public plan creation is not bound to the commerce agreement, so a counterparty can forge the settlement terms (agreementRef squat / term forgery) — **RESOLVED r1** (verifyAgreement seam on POST /plans wired to commerce agreement in register.ts; terms mismatch → 403/404; duplicate-with-different-terms → 409 CONFLICT via samePlanTerms; regression test in settlement-e2e)
- **Evidence**
  - `routes/settlement/settlement.ts:82-135`: `POST /api/settlement/plans` accepts any `agreementRef`, `buyerWallet`, `providerWallet`, `totalUsd`, `milestones[].legs`.
  - `services/plan-service.ts:108-113`: the only authorization is "caller is the buyer or provider named in the body".
  - `services/plan-service.ts:117-124`: first writer wins. A later create returns `duplicate:true` with the existing plan.
  - `commerce/settlement-bridge.ts:87-101` and `:60-70`: the bridge calls `createPlan` and `settled()` only logs on `!ok`. A `duplicate:true` plan with different wallets, total, milestones or legs counts as success. The plan is never compared to `agreedAmount` or the offer milestones.
  - `commerce/services/offer-accept.ts:41-154` commits the agreement. Only at `:160-183` does the post-commit `ensurePlan` run. `agreement.id` is visible to the provider as soon as the transaction commits.
  - `services/milestone-service.ts:142-151` and `:169-179` build the payout legs from the stored `payoutTemplate`, so the squatter's payees and amounts become the intent.
- **Exploit scenario**
  1. The buyer accepts an offer for 100 USDC.
  2. The provider sees the new `ag_…` id and POSTs `/api/settlement/plans` with `agreementRef=ag_…`, the correct buyer and provider wallets, `totalUsd=10000`, and a leg template that pays an attacker-controlled `PLATFORM_FEE` or `COLLABORATOR` address.
  3. The provider wins the gap between the commit and `ensurePlan`. The same outcome follows whenever `ensurePlan` fails, because that failure is only logged and "lazy retry" does not exist (see H7).
  4. The bridge's `ensurePlan` reports success on the duplicate.
  5. The buyer accepts a milestone submission. `approveMilestone` runs as the real buyer wallet, so the buyer-only check passes, and an OPEN intent is created from the forged plan.
  6. Ops pays what the intent says. The signed receipt and memo anchor then certify the inflated settlement.
- **Fix**
  - Plan creation must be bridge-only or admin-only.
  - If the route stays public, require an injected `verifyAgreement(agreementRef, buyer, provider, totalUsd)` that checks against commerce.
  - The bridge must compare an existing plan's buyer, provider, total and milestone amounts to the commerce agreement on `duplicate:true` and fail loudly on a mismatch.
  - Better: create the plan inside the accept transaction.

## High

### H1. SPLIT can never finalize: `allLegs.every(COMPLETED)` counts CANCELLED legs — **RESOLVED r1** (shared rollupIntent in services/rollup.ts counts non-CANCELLED legs, ≥1 COMPLETED; mark-paid re-reads intent inside atomic)
- **Evidence**
  - `services/payout-service.ts:197-200` rolls up only when every leg of the intent is `COMPLETED`.
  - `services/dispute-resolve.ts:150-152` marks the original legs `CANCELLED` and `:154-169` adds new legs on the same intent. The cancelled legs remain.
- **Impact**
  - After a SPLIT and full payment, the intent stays OPEN and the milestone stays APPROVED. The plan never reaches COMPLETED and an anchor is impossible, because `anchor.ts:59-69` needs every milestone terminal.
  - The only exit is another dispute, and FOR_BUYER on that dispute cancels a fully paid milestone (see M13).
  - FOR_PROVIDER and SPLIT resolves also never re-run the rollup. An intent whose legs are all COMPLETED at resolve time (for example the last-leg-pays-while-freezing race) is thawed to OPEN with "no OPEN legs" forever (`payout-service:124-126`).
- **Fix**
  - Roll up over non-CANCELLED legs and require at least one COMPLETED leg.
  - Extract one `rollupIntent(s, intentId)` and call it from both mark-paid and resolve.

### H2. Correctness depends on `atomic()` rolling back on a returned `{ok:false}`; the code mixes `throw` and `fail` — **RESOLVED r1** (all post-write fail() sites hoisted before first write: intent re-read pre-leg-complete, dispute dedupe+id check inside atomic, intent-conflict check pre-approve, SPLIT completed-leg check pre-atomic; in-memory mutex still lacks tx rollback — documented residual)
- **Evidence**: aborts use `throw` at `plan-service.ts:163`, `milestone-service.ts:181`, `dispute-resolve.ts:166`. These sites return `fail(...)` after writes:
  - `dispute-resolve.ts:103-112` marks the dispute RESOLVED. `:138` flips the milestone. `:145-149` then returns `fail("cannot SPLIT — a completed leg is immutable")`.
  - `milestone-service.ts:130-134` sets the milestone APPROVED. `:160-167` returns `fail` when the intent insert conflicts.
  - `payout-service.ts:184-190` completes the leg with its txHash. `:201-210` returns `fail` when the intent moved concurrently.
  - `dispute-service.ts:129-172` freezes milestones, intents, legs and the plan. `:187-189` returns `fail("dispute insert conflicted")`.
- **Impact** (unverified: `atomic()` is not attached). If `atomic()` only rolls back on throw:
  - A SPLIT over a partially paid intent leaves the dispute RESOLVED, the milestone APPROVED, and the intent and legs FROZEN with no OPEN dispute. That is a permanent lock.
  - An approve conflict leaves the milestone APPROVED with no intent.
  - A concurrent freeze can leave a leg COMPLETED (with its txHash) inside a FROZEN intent that never rolls up.
  - A failed dispute insert leaves frozen work with no dispute row.
  - These also violate the claim that failed operations write nothing.
- **SPLIT over a partially paid intent is a normal path, not an edge case.** `dispute-resolve.ts:74-96` pre-validates everything except the intent's legs.
- **Fix**
  - Make `atomic()` roll back on any `ok:false` and add a test for it, or convert every post-write failure to `throw`.
  - Hoist the completed-leg check above the first write.

### H3. Dispute resolution ignores the dispute's own freeze map and acts on live status; duplicate disputes are possible — **RESOLVED r1** (resolve scoped to dispute.payload.freeze intentIds/legIds; dedupe inside atomic; milestones re-read in tx)
- **Evidence**
  - `dispute-resolve.ts:73` reads `freeze` but only uses `freeze.milestones`. `freeze.intentIds` and `freeze.legIds` are never consulted.
  - `:126`, `:140` and `:173-179` thaw or cancel any intent that is currently FROZEN for the milestone, regardless of which dispute froze it.
  - `dispute-service.ts:112-124` is the dedupe check, outside `atomic`. `:173` is the insert. There is no unique OPEN-dispute-per-subject guarantee visible.
  - `:132` uses a stale `m.status` from before the transaction.
- **Exploit scenario (reachable through the public route)**
  1. A participant double-submits `POST /milestones/:id/dispute`, or the buyer and provider both do.
  2. Both requests pass the dedupe check.
  3. D1 gets a full freeze map. D2 loses the `applyStatus` race, so its map is empty.
  4. The operator resolves D2 FOR_PROVIDER. `prev` is undefined, so the milestone stays DISPUTED, but the intent is FROZEN, so it is thawed: legs go FROZEN→OPEN and the intent goes FROZEN→OPEN.
  5. `markLegPaid` never looks at milestone, plan or dispute state (`payout-service:149-157` loads the plan and ignores its status), so the leg can be paid under an OPEN D1.
  6. D2 resolved FOR_BUYER instead cancels the intent that D1 froze.
- The same leak applies to any AGREEMENT-subject dispute overlapping a MILESTONE dispute. Only MILESTONE disputes are reachable from the attached routes (`settlement.ts:218-224`), but the domain accepts AGREEMENT.
- **Fix**
  - Operate only on ids in `dispute.payload.freeze`.
  - Add a partial unique index on OPEN disputes per subject, or move the dedupe inside `atomic`.
  - Re-read the milestone inside the transaction.

### H4. mark-paid fails open by default, and the signed receipt and anchor launder an unverified attestation into proof — **PARTIAL r1** (verified facts now mandatory — H5; receipt lacks per-leg verified flag — deferred to r2; requireVerification stays opt-in per D-227-4 manual-attestation design, documented residual)
- **Evidence**
  - `routes/settlement/helpers.ts:22-25`: `verifyTx` and `requireVerification` are optional.
  - `settlement-admin.ts:92-95` passes `undefined` through.
  - `payout-service.ts:160-178`: with no adapter and no `requireVerification`, any `0x` plus 64 hex string completes the leg.
  - `lib/settlement/receipt.ts:46-53` (the leg object in the signed body) has no `verified`, attestation mode or `completedBy`. `:157-164` builds legs without them. `verified` is only in an event payload (`payout-service.ts:263`).
- **Exploit scenario**: one admin credential and a self-declared `operator` string can mark every leg paid with random hashes. The receipt GET then signs an EIP-712 artifact that shows `txHash` values, and the anchor publishes its hash onchain. A third party cannot tell a verified payout from an attested one, so a signed settlement can be fabricated without any onchain transfer.
- **Fix**
  - Default `requireVerification` to true outside dev.
  - Persist `verified` and `verifiedBy` on the leg and include them in the receipt body.
  - Refuse to sign or anchor a receipt that contains unverified legs.

### H5. `verifyLegTx` is not fail-closed on missing facts, and the expectation is under-specified for Arc — **RESOLVED r1** (verified:true requires asset/payee/amount/network/confirmations≥1; numeric decimalToMicro amount compare; chainId + expectedPayer expectation wired)
- **Evidence**
  - `verify-payout-tx.ts:86-90` rejects only a non-boolean `verified`. `:107-152` run every cross-check only `if (field !== undefined)`.
  - An adapter that returns `{verified:true}` passes with no asset, payee, amount, network or confirmation check.
  - `confirmations` is never compared. The header's "mandatory adapter checks" are not enforced by the service.
  - `payout-service.ts:164-170` never passes `chainId`, so the pin in `PayoutTxExpectation.chainId` is dead.
  - There is no expected payer. Any third-party transfer to the payee after `notBeforeMs` can satisfy a leg.
- **Arc-specific**
  - USDC is both the native gas token (18 decimals) and an ERC-20 (6 decimals). The expectation says only `amount: "10.5"` and `currency: plan.currency`. Nothing says which view the adapter must compare. Hashes can verify an equal numeric string at the wrong scale.
  - `leg.network` is hard-coded to the literal `"arc"` (`milestone-service:177`, `dispute-resolve:162`, `payout-service:140`). It does not distinguish Arc Testnet from Mainnet, and it is also the replay scope.
- **Fix**
  - Require `asset`, `payee`, `amount`, `network` and `confirmations ≥ threshold` to be present when `verified` is true, comparing the amount numerically after normalisation.
  - Add `expectedPayer` (treasury), a real `chainId`, and an explicit `view: "erc20" | "native"` to the expectation.

### H6. A multi-milestone agreement is terminated by the first accepted submission — **RESOLVED r1** (review completes agreement only when pendingMilestoneCount==0; multi-milestone plans stay ACTIVE)
- **Evidence**
  - `commerce/services/submission-review.ts:115-125` completes the agreement on any `ACCEPTED` verdict.
  - `:86-91` rejects later reviews with "agreement is COMPLETED — review closed". The post-commit approve at `:152-165` only runs for that single submission.
- **Impact**: milestones 2..N (offer-defined, `offer-accept.ts:162-176`) can never be buyer-approved through commerce. They stay PENDING or READY, so no intent is created and the provider is not paid for them. The plan never completes and no anchor is possible. Unverified: submission-create is not attached.
- **Fix**: complete the commerce agreement only when the settlement plan is terminal, or when the milestone being accepted is the last one.

### H7. Bridge failures and misses are silent, and the documented "lazy retry" does not exist — **RESOLVED r1** (findMilestone lazy-heals plan from commerce agreement terms via ensurePlan)
- **Evidence**
  - `offer-accept.ts:158-159` and `settlement-bridge.ts:5-13` claim `ensurePlan` is "retried on every milestone path".
  - `submission-review.ts:158-164`: `findMilestone` returning null causes no action and no log.
  - Nothing in the attached bridge or commerce paths re-calls `ensurePlan`.
  - An illegal transition is only `logger.warn`ed (`bridge.ts:60-70`), for example PENDING→APPROVED when the bridge's submit failed.
  - A submission with no `milestoneRef` (`submission-review.ts:154`) approves nothing.
  - Invalid offer-payload milestones fail `createPlan` validation deterministically and permanently.
- **Impact**: the buyer's `ACCEPTED` verdict commits and the agreement is COMPLETED, but no payout intent exists. Nobody is alerted and there is no reconciliation job.
- **Fix**
  - Make `findMilestone` or approve call `ensurePlan`.
  - Add a reconciler that finds ACCEPTED submissions with no intent.
  - Emit a metric or event on every bridge miss.

## Medium

### M1. Participant APIs reuse resolver-only edges of the transition table — **RESOLVED r1** (submit requires PENDING, approve requires READY + plan ACTIVE + no OPEN dispute)
- **Evidence**
  - `state-machines.ts:34-37` allows DISPUTED→APPROVED and DISPUTED→READY.
  - `milestone-service.ts:124` and `:32` only check `isLegalTransition`.
  - The buyer can call approve on a DISPUTED milestone that has no intent. The result is APPROVED plus an OPEN intent while the dispute is OPEN.
  - The provider can call `submitForReview` on a DISPUTED milestone and un-freeze it to READY.
  - `approveMilestone` and `submitForReview` never check `plan.status`.
- **Fix**: require `from === "READY"` or `"PENDING"` explicitly in the participant paths, and reject when a dispute is OPEN.

### M2. The anchored hash includes the mutable `plan.status`, which a participant can influence — **PARTIAL r1** (disputes on terminal milestones rejected; plan.completed emitted only on landed applyStatus; status field still hash-bound — residual)
- **Evidence**
  - `receipt.ts:174-182` hash-binds `agreement.status`.
  - `dispute-service.ts:130-131` skips freezing terminal milestones but `:170-172` still flips an ACTIVE plan to DISPUTED. A participant can open a MILESTONE dispute on an already-RELEASED milestone.
  - The final rollup then silently no-ops: `payout-service.ts:248` ignores the `applyStatus(plan, ACTIVE→COMPLETED)` result, and `:249-255` still emits `plan.completed`.
  - `anchor.ts:59-69` gates only on milestone statuses.
- **Impact**
  - An anchor can be requested while `status=DISPUTED`.
  - When the operator later resolves the empty dispute, the plan flips to COMPLETED (`dispute-resolve:209-213`). The receipt then hashes differently from the anchor on chain.
  - That anchor is permanently unmatchable.
- **Fix**: reject disputes on terminal milestones, check the `applyStatus` result, require `plan.status === COMPLETED` for the anchor, and drop `agreement.status` from the hash body or bind it as `COMPLETED` only.

### M3. The anchor drain has no claim or lease, and the route swallows its errors — deferred r2 (anchor claim/lease)
- **Evidence**
  - `anchor.ts:135-153` lists PENDING rows and sends without claiming them.
  - `settlement-receipts.ts:167-173` starts `void drain(...).catch(() => undefined)` on every POST.
  - Two concurrent POSTs (any two agreements), or two instances, send the same memo twice.
  - `markAnchored` and `emit` sit inside the `try` (`anchor.ts:154-166`). A throw after a successful send falls into `catch` and calls `markAttempt` on a row that is already ANCHORED. Unverified: store guards.
  - Also `txHash` from `send` is stored as-is. There is no 0x+64hex check and no receipt-status wait (unverified: `SendAnchorFn`).
  - A crash between send and `markAnchored` re-sends on restart.
- **Fix**: a CAS claim (PENDING→SENDING with a lease) before sending, validate the txHash, log in `.catch`, and keep `emit` out of the `try`.

### M4. FAILED anchors are unrecoverable — deferred r2 (FAILED anchor retry route)
- **Evidence**
  - `anchor.ts:72-77` returns the existing row as `duplicate:true` whatever its status.
  - `state-machines.ts:63` declares FAILED→PENDING, but nothing uses it. There is no retry route and no scheduled drain.
- **Impact**: after 3 attempts the agreement can never be anchored.
- **Fix**: add an admin retry that resets the row, and a scheduled drain.

### M5. The admin anchor path mutates without an AdminAction or an operator label — deferred r2 (admin anchor operator+AdminAction)
- **Evidence**
  - `settlement-receipts.ts:141-149` accepts the admin key and sets `actor = "admin"`. `anchor.ts:85-112` then creates a row.
  - The route lives under `/api/settlement/...`, not `/admin/`, so the "no-store for free by path" assumption does not hold. Unverified: `cacheHeadersMiddleware`.
  - `isAdminRequest` re-implements `adminAuth` from `process.env.ADMIN_API_KEY`, so any rotation, multi-key or rate-limit logic in `adminAuth` is bypassed or duplicated. The comparison itself is timing-safe.
- **Fix**: reuse `adminAuth`, require `operator`, record an AdminAction, and add no-store to the response.

### M6. `verifySettlementReceiptSignature` proves consistency, not authenticity — **RESOLVED r1** (expectedSigner param + agreementId/issuedAt/chainId cross-field assert)
- **Evidence**
  - `receipt.ts:236-247` recovers against `receipt.signer`, a field in the body. Any key can mint a receipt for any agreement and this returns `true`.
  - `body.agreementId`, `body.issuedAt` and `body.chainId` are signature-bound but never compared to `agreement.ref`, `issuedAt` and `chainId`, which are hash-bound.
- **Fix**: require an `expectedSigner` argument, assert the three cross-fields, and document that `true` alone is not proof.

### M7. The event stream records state that did not happen, and omits state that did — documented residual (ctx.emit inside atomic is codebase convention; events idempotent)
- **Evidence**
  - `dispute-resolve.ts:182-193` emits `intent.cancelled` or `intent.unfrozen` whenever an intent exists, including COMPLETED intents of other milestones in an AGREEMENT scope.
  - It emits no events for milestone transitions, leg cancel/open or plan transitions on resolve.
  - `ctx.emit` is used inside `atomic` rather than the transaction handle `s` (`milestone-service:184-214`, `payout-service:212-264`, `dispute-service:150-200`). If the emitter is outside the transaction, a later throw leaves orphan events. For example `leg.opened` for leg 1 is emitted before leg 2's insert can throw at `milestone-service:181`.
  - `transitionMilestone` (`milestone-service:38-56`) writes the status and then emits. A throw leaves a change without an event.
- **Impact**: the hash-chained history is not a faithful audit trail.

### M8. Admin route schemas are decorative, so a bad body returns 500 — **RESOLVED r1** (safeParse on admin bodies → 400; leg null guard)
- **Evidence**
  - `settlement-admin.ts:34-38` and `:111-119` declare zod schemas only for OpenAPI. The handler uses `readBody` and `as never` casts (`:143-146`).
  - `splitLegs: [null]` reaches `invariants.ts:179-181` and `leg.payee` throws a TypeError. That is a client error returned as a 5xx and INTERNAL_ERROR, which is the 4xx/INTERNAL_ERROR class bug.
- **Fix**: `safeParse` the body with the declared schemas, and guard `leg` types in `checkLegTemplate`.

### M9. Replay and idempotency of signed public writes (unverified: `requireWallet`) — documented residual (nonce replay covered by commerce sig layer — unverified by auditor)
- **Evidence**
  - `settlement.ts:113`, `:205` and `settlement-receipts.ts:146` pass `allowIdemReplay: true`.
  - `:126` reads the idempotency key and discards it. The dispute route never reads it.
  - Dispute dedupe is against OPEN disputes only (`dispute-service:112-124`).
- **Impact**: if a signed request can be replayed, a captured POST after resolution re-freezes the milestone.

### M10. Participant GET responses set no `Cache-Control` (unverified: `cacheHeadersMiddleware`) — deferred r2 (Cache-Control on participant GETs)
- **Evidence**: `settlement.ts:139-185` and `settlement-receipts.ts:58-115` return participant-gated data with no `private, no-store` header.
- **Impact**: the A4 comment implies `/api/*` GETs are stamped cacheable by default. A shared cache keyed by URL would serve one participant's view to anyone.

### M11. The plan creator controls fields that flow into verification and payee semantics — **RESOLVED r1** (currency enum USDC; zero-address payee rejected)
- **Evidence**
  - `currency` is any string up to 16 characters (`plan-service.ts:100-103`) and becomes `expected.currency` (`payout-service:167`).
  - Leg payees accept any EVM address (including `0x000…000`), and `PLATFORM_FEE` has no fixed payee (`invariants.ts:164-206`).
- **Fix**: allow only `USDC` (an enum), and reject the zero address and a leg role with an unexpected payee.

### M12. Decimal strictness is unverified (`finops/guards.ts` not attached) — **RESOLVED r1** (numeric amount compare via decimalToMicro in verifyLegTx)
- **Evidence**
  - `invariants.ts:46-48` and `:64-70` delegate to `isDecimalString`, `decimalToMicro` and `sumDecimals`. Raw strings are stored (`plan-service:131`, `:155`) and compared as strings by the verifier (`verify-payout-tx.ts:125-133`).
  - If `decimalToMicro` truncates beyond 6 decimals, `"1.0000009"` passes the sums while the payout expectation is a different string. "10.0" versus "10.00" falsely rejects a real payment.
- **Verify**: add tests for `1e3`, `+1`, ` 1`, `00.5`, `.5`, `5.`, Unicode digits, `1.0000001`, and 31-digit values.
- **Fix**: normalise amounts to a canonical form on write.

### M13. Edge semantics that lose money state — documented residual (money-in-flight edges documented, reconciliation = follow-up)
- **Evidence**
  - FOR_BUYER cancels the milestone and FROZEN legs but leaves COMPLETED legs under a CANCELLED milestone (`dispute-resolve.ts:122-133`). There is no refund record.
  - `mark-paid` requires an OPEN intent and OPEN leg (`payout-service.ts:105-110`, `:135-137`). Money already sent when a freeze lands cannot be attached to the leg until resolution.
  - `auditRecorded:false` cannot be repaired. A retry returns TX_REUSED or INVALID_STATE, and no reconciliation exists.

### M14. Plan DISPUTED→ACTIVE restore looks only at the same subject — deferred r2 (plan restore scans same-subject only)
- **Evidence**: `dispute-resolve.ts:197-213` considers only `agreementRef` and `scope.milestones`. Resolving a dispute on m1 sets the plan ACTIVE while an OPEN dispute on m2 exists. The `disputes.list({status:"OPEN"})` call may also be limited by a default page size (unverified).

### M15. `createPlan` dedupe silently returns a different plan — **RESOLVED r1** (samePlanTerms CONFLICT covers the mismatch case)
- **Evidence**
  - `plan-service.ts:117-124` returns the stored plan even if the new input disagrees on wallets, total or milestones.
  - A unique-violation inside a Postgres transaction aborts it, so the "lost the unique race" branch (`:135-146`) may never run (unverified).

## Nits / Suggestions
- `receipt.ts:142-144` sorts legs with `localeCompare` on random ids. Use code-unit ordering, or sort by `(role, payee, amount)` so the order is meaningful to an external verifier.
- `receipt.ts:109` passes `body.chainId as unknown as number` to `buildReceiptDomain`. The signer's own `chainId` field is unused. A BigInt used as a number will break if `buildReceiptDomain` does arithmetic.
- `settlement-receipts.ts:104-112` swallows build failures into `artifact:null`, and signs on every GET.
- `PROVIDER_ERROR→503` is used for insert conflicts (`plan-service:145`, `dispute-service:188`, `anchor.ts:103`). Use `CONFLICT` (409).
- 403 versus 404 on POST dispute, plan and anchor leaks existence of a milestone or agreement id, unlike the GET views.
- The settlement routes mix the `errorResponse` envelope with `{error:{code,message}}` from `respond`. `ErrorCodes.CHECKOUT_PROVIDER_UNAVAILABLE` is reused for the signer (`settlement-receipts.ts:154`).
- "Services never throw" does not hold: `payout-service.ts:84-91` rethrows, `plan-service.ts:163` throws, and emit failures throw. Routes depend on a global `onError`.
- `milestone-service.ts:142-151` trusts the JSON template without re-validation. A one-line `checkLegTemplate` call keeps the invariant defensive.
- A provider-authored `EVALUATOR_VERDICT` release policy (via the offer payload) makes a milestone buyer-unapprovable (`milestone-service.ts:112-118`).
- `adminAuth` is applied per route; prefer `r.use("/admin/*", adminAuth)` so new routes cannot omit it. `operator` is a self-declared label and not the authenticated principal.
- `"arc"` should be a shared constant. Payload `JsonValue` casts (`dispute-resolve.ts:109`) hide type errors.
- Wrap `recordPostEffectAudit` in try/catch so a throw becomes `auditRecorded:false` (unverified). Otherwise a committed effect returns a 500.
- `drainSettlementAnchors` doc says it returns rows but it returns counts. A throw from `markAttempt` aborts the rest of the batch.
- `createPlan` has no upper bound on amounts (31 digits). Add a sane maximum.

## Verified-good
- **Participant authorization.** Plan create, submit (provider-only) and approve (buyer-only) are gated (`plan-service:108`, `milestone-service:76`, `:119`). Dispute raise is participant-only and the route passes the authenticated wallet as `raisedBy` (`dispute-service:99-110`, `settlement.ts:218-224`). Participant GET views return 404 to non-parties.
- **mark-paid ordering.** Validate → lock (intent then tx, same order everywhere, so no deadlock) → verify → set-once guarded `complete(leg, "OPEN", txHash)` → rollup → audit. `legId` is scoped to the intent. The txHash is normalised and replay-checked per (network, hash). Failures write no AdminAction (`payout-service.ts:66-295`).
- **Honest audit result.** `auditRecorded` is the actual outcome of `recordPostEffectAudit`. There are no swallowed audit voids in the settlement domain. `requireVerification` returns a typed 503 (`VERIFIER_UNAVAILABLE`).
- **Adapter failures.** Timeouts, throws and empty responses become typed errors, not a 200 (`verify-payout-tx.ts:80-104`).
- **Money.** No floats anywhere. BigInt micro-unit sums are compared in canonical form (`invariants.ts:64-70`). Positive-only amounts, leg count caps (32), a milestone cap (64), and payee+role duplicate detection. SPLIT needs a `MILESTONE` subject, a previously APPROVED milestone, and a leg sum equal to the milestone amount, and refuses COMPLETED legs.
- **Concurrency primitives.** Every status write is a guarded `applyStatus(id, expectedFrom, to)`. Transitions are validated by one table with explicit terminal states. The intent has a unique milestone ref, so approve cannot double-settle. Dispute resolve takes its single-winner guard before applying effects.
- **Receipt.** Verification recomputes the hash over the public body (any added, removed or edited field fails), then checks the EIP-712 signature over `{agreementId, receiptHash, issuedAt, chainId}`. `issuedAt` comes from stored leg time, not the wall clock. BigInt is serialised explicitly (`settlementReceiptToJson`). The receipt requires at least one COMPLETED leg.
- **Anchor.** Gated to fully terminal plans with at least one RELEASED milestone. The row is a durable outbox with a unique `receiptRef`. ANCHORED is terminal in the table, and only a txHash returned by the send seam is stored.
- **Bridge.** `findMilestone` resolves `milestoneRef` inside the agreement's own plan (`getByPlanMilestone(plan.id, ref)`), so milestone-key confusion across agreements is closed. Settlement never imports commerce. Bridge errors cannot roll back a committed commerce verdict.
- **Admin key.** The comparison in `isAdminRequest` hashes both sides before `timingSafeEqual`. Domain error codes map to status classes with no INTERNAL_ERROR on typed 4xx (`helpers.ts:39-51`).
