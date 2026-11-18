# Review Findings — payments-domain (EPIC-220)

## Scope
`entities.ts`, `status.ts`, `provider.ts`, `registry.ts`, `fake-provider.ts`, `stripe-provider.ts`, `verification/checks.ts`, `verification/pipeline.ts`, `persistence.ts`, `memory-stores.ts`, `service.ts`, `sweeper.ts` (all under `packages/payments/src/`; `verification/index.ts` was not supplied and is assumed to re-export the pipeline).

## Verdict
**BLOCK**

The money-critical orchestration in `service.ts` does not uphold the stated invariants. CONFIRMED is reachable without running the pipeline (C-1). `confirmPayment` reports CONFIRMED for transitions it never made (C-2). The confirm and refund flows are non-atomic with no repair path (C-3, C-4). The default `FakeProvider` is fail-open and is the only implementation of three of the four rail ids (C-5…

---

## Critical

### C-1. `createPayment` drives the attempt to CONFIRMED on a rail-reported status, skipping the 9-check pipeline
- `service.ts:257-263`, `provider.ts:36`, `service.ts:247`, `service.ts:353-358`
- Evidence: `CreatePaymentResult.status` allows `"CONFIRMED"`. The service does `if (rail.status !== "PENDING") driveAttemptTo(this.stores, attemptRow, rail.status, ...)`, which hops PENDING to PROCESSING to CONFIRMED. `verifyPayment()` from the pipeline is never called on this path. The attempt's `transactionHash` is also taken from the self-reported `rail.evidence?.transactionHash` (line 247). T…
- Reproduced: a provider returning `status:"CONFIRMED"` from `createPayment` and `FAILED` from `verifyPayment` gave attempt `CONFIRMED`, payment `PROCESSING`, `confirmPayment` returned `CONFIRMED` (deduped), and 0 receipts.
- Exploit scenario: any rail adapter (or a mis-scripted provider) that reports CONFIRMED at creation produces an attempt that callers see as CONFIRMED. Anything keyed on `confirmPayment().status` or on the attempt row fulfils with no verification, no receipt and no amount, recipient or replay check.
- Fix: never accept CONFIRMED from `createPayment`. Map it to PROCESSING and force a `verifyPayment` round trip through the pipeline. Alternatively reject it at the type level (`Exclude<..., "CONFIRMED">`).

### C-2. `confirmPayment` returns CONFIRMED when it merely lost the guarded write, whatever the winner did
- `service.ts:397-412`
- Evidence: `if (!confirmed) return { status: "CONFIRMED", verification: verdict, deduped: true }`. `driveAttemptTo` returns `null` when any hop's `applyStatus` loses the `expectedFrom` guard. The winner may have moved the attempt to EXPIRED (sweeper), FAILED (a concurrent confirm with different expectations), or still be mid-flight. The comment says "already confirmed elsewhere", but nothing chec…
- Reproduced: the sweeper ran during `verifyPayment` (expiry hit mid-confirm). `confirmPayment` returned `CONFIRMED, deduped:true`. The DB held attempt `EXPIRED`, payment `EXPIRED`, 0 receipts.
- Exploit scenario: a webhook retry or user-triggered confirm races the sweeper, or races a slower first confirm that later fails. The loser reports CONFIRMED and the caller fulfils. Persisted state says EXPIRED or FAILED, and the funds were captured on the rail.
- Fix: on `null`, re-read the attempt and payment and return the persisted status. Only report CONFIRMED when the row is CONFIRMED and the receipt exists.

### C-3. Confirm is a non-atomic 3-step write with no repair path (CONFIRMED without receipt, split attempt/payment state)
- `service.ts:397-431`, `service.ts:353-358`, `persistence.ts:269-276`, `persistence.ts:299-307`
- Evidence: the order is (1) attempt CONFIRMED, (2) `drivePaymentTo(...)` whose result is ignored (line 413), (3) `receipts.append` (415). Each store write is followed by a separate `events.append`. A crash or throw between any two leaves a half-written state. Retries then short-circuit at 353-358 on the terminal attempt, so nothing ever completes the missing steps. `receipts.append` also returns …
- Reproduced: `receipts.append` threw once, then the retry returned `CONFIRMED, deduped:true` with 0 receipts for the payment (payment was CONFIRMED). The same shape applies if the process dies after step 1: attempt CONFIRMED, payment stuck at PROCESSING.
- Related race: the sweeper loops payments first, then attempts (`sweeper.ts:41-59`). A confirm that lands after the payment is EXPIRED but before the attempt is EXPIRED confirms the attempt, writes a receipt, and ignores the `null` from `drivePaymentTo`. The result is attempt CONFIRMED, payment EXPIRED (a terminal state), a receipt, and a CONFIRMED outcome.
- Exploit scenario: the customer's funds are captured but the order is never fulfilled (payment not CONFIRMED), or it is fulfilled twice by consumers that key off different rows. There is no auditable receipt for a CONFIRMED payment.
- Fix: make "attempt CONFIRMED + payment CONFIRMED + receipt + events" one store transaction (a port method such as `confirmAtomically`), or make the terminal short-circuit self-healing (if the attempt is CONFIRMED, re-run payment and receipt completion idempotently). Check the return value of `drivePaymentTo`, and fail loudly on `null`.

### C-4. Refund claims the state after the irreversible rail side effect (double refund)
- `service.ts:448-483` (provider call 471-474, claim 475-481), `fake-provider.ts:103-117`, `stripe-provider.ts:334-337`
- Evidence: the service reads the payment (449), checks `status === "CONFIRMED"` (453), calls `provider.refundPayment` (471), and only then does `applyPaymentTransition(... "REFUNDED")` (476). The guarded write that should serialise concurrent refunds happens after the side effect. No idempotency key reaches Stripe (`StripeLikeClient.refunds.create` takes no options, `stripe-provider.ts:102-115`).
- Reproduced: two concurrent `refundPayment(id, "60.00")` calls on a $100 payment hit the provider twice (2 refund calls, both `REFUNDED`).
- Exploit scenario: two concurrent partial refunds both succeed on Stripe and over-refund up to the charge total. If the rail refund succeeds and the `applyStatus` throws or the process crashes, the payment stays CONFIRMED and is refundable again. A `PENDING` refund result is not recorded at all (no state change, no row), so it can be re-issued.
- Fix: claim first (CONFIRMED to a REFUNDING state or a persisted refund row with a unique key), pass a deterministic idempotency key to the rail, then finalise. Persist refund records (amount, reference, status).

### C-5. `FakeProvider` is fail-open by default and is the only code that can serve DIRECT_USDC / X402 / HEDERA
- `fake-provider.ts:56-69` (default `verifyMode ?? "auto-confirm"` at 66), `fake-provider.ts:119-138` (evidence echoes the create input, line 131), `registry.ts:27-33`, `service.ts:366-389`
- Evidence: `FakeProvider.verifyPayment` returns `SUCCESS` for any reference it holds, and evidence amount, currency, provider, network, payer and recipient are copied from the create input. Checks 1 to 4 therefore pass tautologically. Nothing stops `registry.register(new FakeProvider({provider:"DIRECT_USDC"}))` in production (no env guard, no `isTestOnly` marker, no distinct class check in `Payme…
- Exploit scenario: a deployment that registers `FakeProvider` for an onchain rail "temporarily" confirms any created payment with no funds moved, producing a CONFIRMED payment and a receipt with a synthetic `tx_fake_...` hash.
- Fix: default `verifyMode` to `"pending"`. Make the constructor throw unless an explicit `allowInProduction: false` / `NODE_ENV !== "production"` assertion is satisfied, or put the fake in a `/testing` subpath export only. Add a registry hook (`assertProductionSafe`).

---

## High

### H-1. A verification failure on genuinely SUCCESS evidence terminalises the payment with no review or refund path (paid but FAILED)
- `service.ts:434-443`, `verification/checks.ts:204-219`, `stripe-provider.ts:129-139`, `stripe-provider.ts:156`
- Evidence: whenever `verdict.ok` is false the attempt and payment are driven to FAILED (or EXPIRED) permanently, even when `evidence.status === "SUCCESS"` and funds were captured. Three realistic triggers:
  1. `finality`: confirmations below `minConfirmations` is a transient condition, but it becomes terminal FAILED.
  2. Stripe `complete` + `payment_status:"unpaid"` (delayed-notification methods when `paymentMethodTypes` is not card) maps to FAILED (reproduced). `checkout.session.async_payment_succeeded` is never handled, and the attempt is terminal.
  3. Stripe `amount_total` (includes tax, shipping, adjustments) differs from `attempt.amount`, so `amount_match` fails on a paid session.
- Exploit scenario: the customer is charged, the payment is FAILED permanently, and no state machine path exists to reconcile it (attempts have no outgoing edges; `FAILED -> PENDING` has no producer).
- Fix: distinguish retryable from terminal verdicts. Keep the attempt PENDING or PROCESSING for `finality` and `unpaid`. Route captured-funds mismatches (SUCCESS evidence, failed amount/recipient/network) to a new review state (or DISPUTED) and alert instead of FAILED.

### H-2. Expiry (lazy and sweeper) never consults the rail, and EXPIRED is terminal
- `persistence.ts:315-367`, `sweeper.ts:41-59`, `service.ts:254-256`, `stripe-provider.ts:285-288`
- Evidence: PROCESSING payments past `expiresAtMs` are expired from local data alone. A customer who paid just before the deadline, with a delayed webhook or confirm, gets EXPIRED. EXPIRED has no outgoing transitions (`status.ts:38`, `status.ts:59`). Also, `service.ts:254-256` assigns the rail's `expiresAt` to a local copy of the row only; it is never persisted. For Stripe without a caller-supplie…
- Exploit scenario: paid-but-EXPIRED orders on deadline boundaries; unbounded accumulation of non-terminal rows otherwise.
- Fix: before expiring, call `provider.verifyPayment` (or require a grace window) and only expire on `EXPIRED`/`PENDING` evidence. Persist the rail's expiry via the attempt patch. Make Stripe session expiry authoritative.

### H-3. Create-path error handling leaves orphans, lies about persisted state, and burns the reference
- `service.ts:222` (outside the `try`), `service.ts:224-305`, esp. `299-304`
- Evidence:
  - `this.providers.get(input.provider)` runs outside the `try`. An unregistered provider throws `ProviderNotFoundError` after both rows are inserted (reproduced: payment `PENDING`, attempt `CREATED`, and a retry returns the orphan with `deduped:true`, so the reference is permanently burned).
  - The `catch` covers all errors in the `try`, including store and event failures after a successful rail call. A live Stripe Checkout Session then exists while rows are marked FAILED (no session cancel/expire call, and no Stripe idempotency key can be sent). Customers who pay it hit the terminal short-circuit (353-358).
  - The return value in the `catch` is fabricated: `attemptFromRow({ ...attemptRow, status: "FAILED" })` and `{ ...paymentRow, status: "FAILED" }` are returned even when `applyAttemptTransition` / `applyPaymentTransition` returned `null` (the guard lost, `paymentRow` is also stale versus the post-`drivePaymentTo` DB state) or threw.
  - If the compensating writes themselves throw, the original error is replaced and rows stay CREATED/PENDING; rows with `expiresAtMs == null` are never swept (`memory-stores.ts:87-94`, `177-183`).
  - A crash between `sessions.create` and the PENDING patch (238-253) loses the Stripe session id: `confirmPayment` returns `UNKNOWN: attempt has no providerReference` forever while the session remains payable.
  - Transient rail errors (timeouts, 5xx) are recorded as FAILED, so retrying the same `reference` returns the FAILED payment instead of retrying.
- Fix: move `providers.get` into the guarded block (or resolve it before inserting rows). Persist an intent before calling the rail and use a deterministic rail idempotency key (`reference`). Distinguish definite rail rejections from ambiguous failures and leave ambiguous ones PENDING for reconciliation. Return what was actually persisted.

### H-4. Evidence binding is weak: replay protection is opt-in and three checks pass vacuously
- `service.ts:380-389`, `verification/checks.ts:154-158`, `175`, `193`, `210`, `service.ts:206-217`, `memory-stores.ts:189-202`
- Evidence:
  - Check 1 is self-matching: `expected.reference = attempt.providerReference` (service.ts:381) is the same value used to fetch the evidence (366-368). It cannot fail for an honest provider and proves nothing about a dishonest one. Checks 3 and 4 compare provider-derived values to provider-derived values for the Fake.
  - `tx_not_reused` only runs if the caller supplies `usedTransactionHashes`, and passes when `evidence.transactionHash` is absent. The service never consults `attempts.getByTxHash` (defined on the port, never called) or receipts.
  - Receipt dedupe is `(provider, externalReference)` (memory-stores.ts:195-197). It does not include `transactionHash`. Two attempts with distinct `providerReference` values that point at one onchain tx both get receipts.
  - `recipient_match`, `network_match` and `finality` return `pass` when no expectation is provided (checks.ts:175, 193, 210). `recipient` given to `createPayment` is passed to the rail but never persisted on the attempt, so it must be re-supplied by whoever calls `confirmPayment`.
- Exploit scenario (on the first onchain rail): one 5 USDC transfer confirms multiple 5 USDC payments to the same merchant, and a confirm call that omits `expectedRecipient` or `minConfirmations` skips those checks silently. As shipped (Stripe only) the PaymentIntent id is unique per session, so exposure is conditional on adding a chain rail.
- Fix: persist recipient, network and min-confirmations on the attempt at create time and read them in confirm. Make the replay check mandatory (service-side lookup by `(provider, txHash)` plus a unique index including `transactionHash`). Fail closed when an onchain provider returns evidence without hash or recipient.

### H-5. Idempotent create ignores the request fingerprint and loses the checkout handle
- `service.ts:156-168`, `service.ts:192`, `service.ts:216`
- Evidence: the first lookup is `getByReference(...) ?? getByIdempotencyKey(...)`. The existing payment is returned without comparing `amount`, `customerId`, `provider`, `productId`, `purpose`. If both keys match different rows, the reference row wins. `providerMetadata` (Stripe `checkoutUrl`) is only returned from the first call, and `payload: null` (192, 216) means it is never stored.
- Exploit scenario: a guessable or colliding reference (or idempotency key) from another caller returns someone else's payment and attempt rather than an error, which is a disclosure and lets a different order bind to a paid payment. A client that loses the first response can never recover the checkout URL.
- Fix: store a request hash and return a conflict on mismatch. Persist and return rail metadata on dedupe.

### H-6. "CONFIRMED only via verification" is a convention, not an enforced invariant
- `persistence.ts:257-278`, `persistence.ts:400-415`, `status.ts:34-40`, `memory-stores.ts:74-85`, `150-174`, `service.ts:382-389`
- Evidence: `applyPaymentTransition` / `drivePaymentTo` / `transitionPayment` are exported and accept any legal edge, including `PROCESSING -> CONFIRMED` and `DISPUTED -> CONFIRMED` (no re-verification), and `FAILED -> PENDING` (a resurrected payment can then hop to CONFIRMED through `nextPaymentStep` at `persistence.ts:378` with no attempt or receipt). Store `applyStatus` itself does not validate…
- Illegal edges via stale rows are not reachable: every apply uses `expectedFrom = row.status` and the guard blocks it (verified good below).
- Fix: do not export raw transition helpers from the package barrel. Enforce legality in the store `applyStatus` (DB CHECK/trigger or app-level map). Require a receipt row (or a verification id) for any transition to CONFIRMED. Compare against `payment.amount` in confirm. Remove `FAILED -> PENDING` or gate it behind a new-attempt operation.

---

## Triage (2026-11-09, verified against code)

Fixes are implemented in **SLICE-220-8** (MYPROJ-2789). Verdict per finding after independent re-verification:

| # | Verdict | Severity | Fix target (220-8) |
|---|---------|----------|--------------------|
| C-1 | **CONFIRMED** — `CreatePaymentResult.status` allows `CONFIRMED` (provider.ts:36); service.ts drives attempt to rail status, skipping pipeline. Repro logic sound. | Critical | Map rail `CONFIRMED`→`PROCESSING` at create; CONFIRMED only reachable via `confirmPayment`. Optionally narrow the provider type. |
| C-2 | **CONFIRMED** — service.ts:411 returns `CONFIRMED` on any lost race without re-reading. | Critical | On `null` from drive, re-read attempt+payment and return persisted status. |
| C-3 | **CONFIRMED** — non-atomic attempt→payment→receipt; terminal short-circuit has no repair; `drivePaymentTo` result ignored (line 413). | Critical | Self-healing: when attempt already CONFIRMED, idempotently complete payment transition + receipt append instead of blind dedupe. Check drive result. |
| C-4 | **CONFIRMED** — rail side effect before state claim; no idempotency key to Stripe. | Critical | Claim-first: gate refund behind a guarded state claim (CONFIRMED→REFUNDED attempted first, or persisted refund record); pass idempotency key through rail call. |
| C-5 | **CONFIRMED (design risk)** — FakeProvider defaults `auto-confirm`, echoes input as evidence, registerable as real rail. | Critical | Default `verifyMode` → `"pending"`; add `isTestProvider` marker + registry `assertProductionSafe` hook. |
| H-1 | **CONFIRMED** — SUCCESS evidence + failed check → terminal FAILED is wrong for transient/ambiguous verdicts (finality, Stripe `complete`+`unpaid`, tax-adjusted amount). | High | Split retryable (finality/PENDING-like) vs terminal failures; captured-funds mismatch → DISPUTED-style review path instead of FAILED. Stripe async-payment statuses handled. |
| H-2 | **CONFIRMED** — expiry never asks rail; also true bug: rail `expiresAt` patched into local row copy only, never persisted (service.ts:254-256). | High | Expire only after rail consult or grace policy; persist rail expiresAt via attempt patch. |
| H-3 | **CONFIRMED** — `providers.get` outside try → orphan rows + burned reference on unregistered provider; catch fabricates return state; rail errors recorded FAILED block retry. | High | Resolve provider before row insert (or wrap whole path); return actual persisted rows; ambiguous rail failures → PENDING not FAILED. |
| H-4 | **CONFIRMED** — replay check opt-in; recipient/network/finality pass vacuously when unconfigured; tx hash not part of receipt dedupe; check 1 self-matching. | High | Persist expectation fields (recipient/network/minConfirmations) on attempt at create; service-side `(provider,txHash)` replay lookup mandatory for onchain evidence. |
| H-5 | **CONFIRMED** — dedupe ignores request fingerprint; `providerMetadata`/checkout URL never persisted → unrecoverable after first response lost. | High | Store request hash + rail metadata in payload; conflict response on fingerprint mismatch; return stored metadata on dedupe. |
| H-6 | **CONFIRMED** — raw transition helpers exported; `FAILED→PENDING` resurrection edge exists. | High | Un-export raw helpers from barrel; gate `FAILED→PENDING` behind new-attempt op; document CONFIRMED-requires-receipt invariant. |
| M-1..M-11 | **CONFIRMED / accepted** — see details; cheap ones fixed in 220-8 (M-3 sweeper hardening, M-4 decimalAmountsEqual throw → fail, M-5 metadata ordering+limits, M-7 error-text hygiene); M-1/M-2 atomicity subsumed by C-3; M-6 partial-refund semantics + persisted refund record part of C-4 fix. | Medium | |

---

## 220-8 Resolution (fixed in `packages/payments`, tests 112/112)

| # | Status | What shipped |
|---|--------|--------------|
| C-1 | **FIXED** | `createPayment` clamps rail `CONFIRMED`→`PROCESSING`; CONFIRMED only via `confirmPayment` pipeline (`service.ts`). |
| C-2 | **FIXED** | Lost guarded-write races re-read the persisted attempt and return its real status; a CONFIRMED winner self-heals via `completeConfirmation`. |
| C-3 | **FIXED** | `confirmPayment` on an already-CONFIRMED attempt idempotently completes payment transition + receipt (self-heal); `drivePaymentTo` result checked and persisted status reported. |
| C-4 | **FIXED** | Refund is claim-first: guarded `CONFIRMED→DISPUTED` before the rail call, deterministic `refund_<paymentId>_<amount>` idempotency key passed to providers, `DISPUTED→REFUNDED` on success, rollback `DISPUTED→CONFIRMED` on failure, `PENDING` stays claimed. |
| C-5 | **FIXED** | `FakeProvider` defaults `verifyMode: "pending"` (fail-closed); `isTestProvider = true` marker. Registry `assertProductionSafe` hook deferred — noted below. |
| H-1 | **FIXED** | SUCCESS evidence + only retryable fails (`finality`) → `PENDING`; SUCCESS + other failed checks → payment `DISPUTED` (`PROCESSING→DISPUTED` added to the map); Stripe `complete`+`unpaid` → `PENDING`, `amount_subtotal` preferred over `amount_total`. |
| H-2 | **FIXED** | Rail `expiresAt` persisted via `PersistedAttemptPatch.expiresAtMs`; sweeper consults `providers` (SUCCESS/PENDING evidence defers expiry) — `sweepExpiredPayments(stores, now, { providers })`. |
| H-3 | **FIXED** | `providers.get` resolved BEFORE any row insert; `try` scoped to the rail call only — post-rail persistence errors propagate honestly; failure path returns real persisted rows. |
| H-4 | **FIXED** | Expected recipient/network persisted in attempt payload at create and merged into the expectation; service-side `attempts.getByTxHash` replay check runs on every onchain evidence. |
| H-5 | **FIXED** | Request fingerprint stored in `payment.payload.request`; dedupe with mismatched fingerprint → `CreatePaymentOutcome.conflict`; rail metadata persisted in attempt payload and replayed as `providerMetadata` on dedupe. |
| H-6 | **FIXED** | `index.ts` no longer exports raw `transitionPayment`/`transitionAttempt` (maps, error, `canTransition*`, `TransitionContext` still public); `FAILED→PENDING` removed — FAILED is terminal, retry = new payment. |
| M-1/M-2 | **Subsumed** | Self-healing completion (C-3) repairs transition/event/receipt splits idempotently; `payments.create` race surfaces winner via `dedupeOutcome`. Atomicity inside one DB transaction stays a DB-store concern. |
| M-3 | **FIXED** | Per-row try/catch (one poison row can't abort the sweep), `errors[]` in `SweepResult`, `inFlight` tick-overlap guard, `intervalMs` validated, `onError` wrapped. |
| M-4 | **FIXED** | `checkAmountMatch` fail-closed on unparseable evidence; `createPayment` rejects zero amount and >15 integer digits (`assertPositiveAmount`). |
| M-5 | **FIXED** | `toStripeMetadata` writes `reference` last (caller can't override) and caps copied keys at 39. |
| M-6 | **Partial / deferred** | Claim-first + idempotency key done; a dedicated persisted refund-record row (partial-refund ledger) deferred — see decisions.md. |
| M-7 | **FIXED (code part)** | Rail error text truncated to 200 chars before persisting (`truncateReason`); PII discipline stays a provider-evidence concern. |

**Open follow-ups:** registry `assertProductionSafe` hook (C-5 tail), persisted refund-record ledger (M-6 tail), DB-level transition enforcement (H-6 tail, `@agentbadge/database` CHECK/trigger when stores land).

**Verified-good (agrees with code):** `usdToCents`/`centsToUsd` BigInt-exact; `decimalAmountsEqual` strict compare; guarded `applyStatus` blocks stale-row illegal edges; no keys/seeds anywhere in the package; `.unref()` correct; dedupe-before-provider prevents `DuplicateReferenceError` masking.

---

## Medium

### M-1. Transition and audit event are two writes; the event result is ignored
- `persistence.ts:269-276`, `299-307`. `events.append` runs after the guarded `applyStatus` and its `null` (duplicate id) result is dropped. A crash or event-store failure yields a transition with no `PaymentEvent`. The initial insert of payment (PENDING) and attempt (CREATED) emits no event, so the audit log starts at the first transition. Fix: same-transaction event insert in the port, or an out…

### M-2. Create race windows and ambiguous `null` from `payments.create`
- `service.ts:194-204`, `service.ts:487-492`. `create` returns `null` for id, reference or idempotency-key collisions alike. On an idempotency-key-only collision the follow-up `getByReference` returns `null` and the code throws `"payment insert deduped but row not found"` (197). `latestAttempt` throws if the loser reads between the winner's `payments.create` and `attempts.create` (a window on any …

### M-3. Sweeper robustness
- `sweeper.ts:41-59`: one throwing row (store or event failure) aborts the whole sweep, and the same poison row is first in line every tick (head-of-line blocking; attempts are skipped entirely when the payment loop throws).
- `sweeper.ts:99-101`: no in-flight guard, so slow ticks overlap (correctness is saved by the guard, load and duplicate work are not).
- `memory-stores.ts:87-94`: `listExpired` is unbounded and un-paginated, and the payment feed includes `DISPUTED` rows (not in `TERMINAL_PAYMENT`) that `isPaymentExpiredRow` then skips on every tick forever.
- `sweeper.ts:93-94`: `now()` throwing synchronously escapes `.catch`; an `onError` that throws produces an unhandled rejection; `intervalMs` is unvalidated (NaN/0/negative gives a hot loop); `stop()` does not await an in-flight tick. No memory leak (no retained state), and `.unref()` is correct.

### M-4. Amount handling edge cases
- `service.ts:170-185`: a USDC create validates up to 6 decimals but stores that string in `Payment.amount`, which is documented as USD with at most 2 decimals (`entities.ts:167`, `231-233`; `validatePayment` is never called). `"0"` / `"0.00"` pass `isUsdDecimal` and a Stripe `no_payment_required` session confirms as SUCCESS (`stripe-provider.ts:132-134`). There is no upper bound on integer digits…
- `entities.ts:213-218` / `checks.ts:96`: `decimalAmountsEqual` throws `InvalidAmountError` for malformed evidence amounts (e.g. 19+ fractional digits) instead of returning a failed check, so the pipeline rejects instead of producing a verdict and the attempt stays non-terminal. Fix: catch in `checkAmountMatch` and return `fail`.
- Note (verified good): `usdToCents` and `centsToUsd` are exact (BigInt, no floats); edge values `0.1`, `0.01`, `100`, `0.30`, `1234567.89` convert correctly; `.5`, `1.`, `-1`, `1e3`, `05` are rejected.

### M-5. Stripe metadata `reference` can be overwritten by caller metadata
- `stripe-provider.ts:212-227`. `out = { reference }` is assigned first, then the loop copies every caller key, including a caller-supplied `reference`. Reproduced: input reference `REAL` with `metadata:{reference:"SPOOF"}` gave `params.metadata.reference === "SPOOF"`. Any reconciliation that keys on Stripe metadata is spoofable. Also no key/value count or length limits (Stripe rejects, which FAIL…

### M-6. Refund semantics
- `service.ts:475-481`: any `REFUNDED` result, including a partial `amount`, moves the payment to terminal REFUNDED, so the remainder can never be refunded and no refund amount is stored. `refundPayment` does not validate `amount` itself (Stripe's adapter does via `usdToCents`, throwing out of the service) and has no authorization hook; callers must enforce ownership.

### M-7. PII and error-text leakage into append-only records
- `stripe-provider.ts:151-155`: the payer email is copied into `PaymentReceipt.payer` (append-only, conflicting with erasure requests). `service.ts:284-303`: raw provider error text goes into the audit event `reason` and into `CreatePaymentOutcome.error` (an API layer may forward it to end users; Stripe errors can include request ids and a masked key suffix). `sweeper.ts:89` logs the raw error obj…