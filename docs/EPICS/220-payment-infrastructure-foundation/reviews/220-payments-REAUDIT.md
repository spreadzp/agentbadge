# Review Findings — payments-stripe-live (EPIC-220)
## Scope
packages/payments/src/{service,stripe-provider,entities,registry,persistence,memory-stores,status,sweeper,provider}.ts, verification/checks.ts, hackathon/server/scripts/payments-stripe-dogfood.mts (verification/index.ts was not supplied; reproductions used a thin shim that runs the 9 supplied checks).

## Verdict
**REQUEST CHANGES.** The money primitives are sound (decimal strings, BigInt cents, guarded CAS writes, claim-first refunds, honest rail-call try/catch), and the happy path in your live run is real. But the state machine has one silent captured-funds failure (local-clock expiry beats the rail) and several refund-protocol holes that the live run could not reach because it was sequential and single-actor. I reproduced the Critical and the High refund findings against the supplied code with an in-memory fake Stripe client (repro results quoted inline); none of them need exotic inputs.

---

## Critical

### C-1. Paid sessions are terminally EXPIRED by the local clock; the rail is never consulted, and there is no API recovery
- **Evidence**
  - `persistence.ts:347-369` `expirePaymentRowIfDue` moves the payment to EXPIRED (`:353-359`) and every attempt to EXPIRED (`:361-368`) purely on `expiresAtMs < nowMs`. No `verifyPayment` call.
  - It runs on every read: `service.ts:373-383` (`getPayment`), `:385-389`, `:391-404` (`listPayments`). A status-polling UI triggers it.
  - `sweeper.ts:87-99` expires **payments** unconditionally. The H-2 rail consult (`:104-107`) guards only the attempts loop below it.
  - `service.ts:424-426`: once the attempt is EXPIRED, `confirmPayment` returns `{status:"EXPIRED"}` without pulling evidence.
  - `service.ts:666-670`: `refundPayment` rejects EXPIRED as not refundable.
  - `service.ts:499-519`: a sweeper/lazy-expiry write that lands during the `verifyPayment` round trip makes the guarded CONFIRMED write lose, and the caller gets EXPIRED for captured funds.
  - `sweeper.ts:61-63`: `railReportsAlive` fails open. Any rail error (Stripe 5xx, 429, a rotated or revoked key giving 401) returns `false`, so every expired attempt, including paid ones, is expired.
- **Why it is reachable on Stripe:** pull-only confirmation (no webhooks) means a buyer who pays and closes the tab before the success redirect has no confirm in flight. Payment `expiresAtMs` (`service.ts:250`) and the Stripe session `expires_at` (`stripe-provider.ts:285-287`) are the same instant, so the last minutes before expiry are exactly when late payers land.
- **Repro (fake Stripe, clock injected):** create with 1h expiry, buyer pays at T-100s, no confirm runs, clock passes T, then `getPayment` / `confirmPayment` / `refundPayment`:
  `getPayment: EXPIRED | confirm: {"status":"EXPIRED","deduped":true} | refund: FAILED "status EXPIRED is not refundable"`
- **Exploit scenario:** the buyer is charged, the system says EXPIRED, nothing alerts ops, and the only trace of the capture is in the Stripe dashboard. The merchant never fulfills and never refunds. No attacker is needed, so this is a silent captured-funds-without-record failure. It is rated Critical because of the silence and the absence of any API path out, not because funds are unrecoverable by hand.
- **Fix:** (a) lazy expiry and the payment-level sweep must consult the rail first, exactly as the attempt sweep intends. Never terminalize a payment whose attempt evidence is SUCCESS or PENDING. (b) Treat rail errors in `railReportsAlive` as "defer", not "expire". Cap the deferral with an alert, not with a silent EXPIRED. (c) Let `confirmPayment` re-verify EXPIRED attempts that have a `providerReference` and, if the rail says SUCCESS, route to DISPUTED with the evidence persisted (see M-5). (d) Add a reconciler (see H-6).

---

## High

### H-1. Fiat-rail expectations (`network`, `recipient`) land captured funds in a DISPUTED state that has no API exit
- **Evidence**
  - `service.ts:266` and `:274-277` persist caller `network` / `recipient` on the attempt for any provider. `service.ts:218-225` never asks the provider whether it can satisfy them.
  - `service.ts:456-465` feeds them to the pipeline. Stripe evidence never sets `network` or `recipient` (`stripe-provider.ts:162-182`), so `checks.ts:183` (`addressEquals(undefined, …)` is false) and `checks.ts:201` fail by construction.
  - `service.ts:529-544`: SUCCESS + non-retryable failed check → payment DISPUTED.
  - `token` is stored (`service.ts:267`) but no check ever reads it, so it **fails open** while `network` / `recipient` fail closed. The asymmetry is itself a bug.
- **Correction to the premise in the brief:** `refundPayment` does *not* reject an already-DISPUTED payment. `service.ts:646-647` explicitly lets DISPUTED through as "claim already held, resume". The real blocker is `service.ts:673-677`: a verification-DISPUTED payment never has a CONFIRMED attempt (the attempt stays PENDING; `:539-544` only moves the payment), so the refund returns `FAILED "no confirmed attempt to refund"`.
- **Repro:** create with `network:"stripe-testmode"`, pay, confirm, then refund:
  `confirm: DISPUTED … network_match | refund: FAILED "no confirmed attempt to refund" | payment: DISPUTED`
- **Dead end confirmed:** re-confirm re-runs the same check against the same persisted `attempt.network` (`:465`), so it can never pass. The only exits are a direct store write or the rail dashboard.
- **Fix:** add a provider capability descriptor (`{networks:false, recipient:false, tokens:false, currencies:["USD"]}`) and make `createPayment` throw before any insert when an unsupported expectation is supplied. Add an explicit, ops-gated `resolveDispute` (refund-from-evidence or force-confirm). Let `refundPayment` fall back to the attempt that holds the SUCCESS evidence when no attempt is CONFIRMED.

### H-2. `confirmPayment` caller input replaces persisted expectations (grief on fiat, bypass on onchain)
- **Evidence:** `service.ts:456-457` `input.expectedRecipient ?? attPayload.expectedRecipient`, `:465` `input.network ?? attempt.network`, `:466-467` `minConfirmations` / `usedTransactionHashes` come only from the caller. The comment at `:453-454` says caller values "only refine"; the code lets them *replace*.
- **Exploit scenarios**
  - Fiat grief: the success-redirect endpoint is the natural caller (`stripe-provider` success URL carries `session_id`). Any caller that can pass `network:"x"` to `confirmPayment` on a paid Stripe payment forces `network_match` to fail and pushes the payment to DISPUTED, with no exit (H-1).
  - Onchain bypass: a caller that supplies its own `expectedRecipient` makes `recipient_match` compare against the attacker's value instead of the merchant address bound at create (the H-4 binding is defeated).
  - `minConfirmations` is never persisted, so a confirm call that omits it skips finality entirely (`checks.ts:217`).
- **Fix:** persisted attempt expectations are authoritative. Caller input may only tighten (for example a larger `minConfirmations`) and a mismatch should be rejected with an error, not evaluated. Persist `minConfirmations` at create.

### H-3. Refund claim is not exclusive, and its CAS results are ignored
- **Evidence**
  - `service.ts:646-647`: a second caller that reads the payment *after* the first claim sees DISPUTED and proceeds to the rail ("resume"). The CONFIRMED→DISPUTED CAS only excludes callers that read CONFIRMED at the same instant.
  - Idempotency key is `refund_${paymentId}_${amount ?? "full"}` (`:691`), built from the raw string. "5.00" vs "5.0" (same 500 cents) produce different keys, as do partial vs full.
  - `:695` and `:704` ignore the `null` returned when the guarded write loses.
  - `service.ts:574-580`: `completeConfirmation` on an already-CONFIRMED attempt drives payment DISPUTED→CONFIRMED (legal per `status.ts:41`). A routine re-confirm (the success-page poll) therefore silently cancels an in-flight refund claim.
- **Repro 1 (two refunds, same payment):** two refund calls 10ms apart with amounts "5.00" and "5.0":
  `resume race: REFUNDED REFUNDED rail calls: [{amt:"5.00",key:…_5.00},{amt:"5.0",key:…_5.0}]`. Stripe would execute both.
- **Repro 2 (rail refunded, ledger says CONFIRMED):** refund running while a re-confirm lands:
  `concurrent refunds: REFUNDED FAILED reconfirm: CONFIRMED | rail refund calls: 1 | payment: CONFIRMED`
  The caller was told REFUNDED, the buyer got their money back, and the persisted payment is CONFIRMED, so entitlements stay live. This violates the file-header invariant "every reported status reflects what is persisted".
- **Fix:** use a distinct `REFUND_PENDING` state (or a separate `refund_claims` row) so DISPUTED stops doubling as "claim held". `completeConfirmation` must never move a payment out of a refund/dispute state. Normalize the amount to cents before building the key. Check the CAS result at `:695` and `:704` and surface it. Add a stored `refundId` and resume by looking it up rather than re-issuing.

### H-4. The claim leaks on every early-return and throw path after it is taken
- **Evidence:** the claim is taken at `service.ts:649-665`. These exits then leave the payment DISPUTED with no rollback:
  - `:675-677` no confirmed attempt
  - `:678` `providers.get` throws `ProviderNotFoundError`
  - `:681-686` provider has no `refundPayment` (UNSUPPORTED)
  - `:688` the rail call throws. `stripe-provider.ts:357-363` has no try/catch, so a 5xx, an over-capture amount, `usdToCents("1.234")`, or `charge_already_refunded` all escape.
  - The rollback at `:703-709` only covers a *returned* FAILED/UNSUPPORTED.
- **Repro:** a CONFIRMED payment on a rail without `refundPayment`: `unsupported: UNSUPPORTED payment now: DISPUTED`. A refund with amount "1.234": throws `InvalidAmountError`, payment left `DISPUTED`.
- **Impact:** anyone who can call `refundPayment` can flip healthy CONFIRMED payments to DISPUTED (a denial of entitlement), and refund input errors are only detected after the state change. `service.ts` never validates the refund `amount` (no `assertDecimalAmount`, no `<= payment.amount`).
- **Fix:** validate amount, provider capability and confirmed attempt *before* claiming. Wrap the rail call in try/catch that rolls back (or marks the claim "unknown, needs reconcile" if the error is ambiguous), and return a `RefundResult`, not an exception.

### H-5. "Refund" is a payment-level terminal flag with no ledger; partials destroy the remainder
- **Evidence:** `service.ts:694-699` any `REFUNDED` rail result, including a partial one, moves the payment to REFUNDED, and `status.ts:40` makes REFUNDED terminal. `:638` then answers every later call "already refunded".
- **Repro:** `refund("2.00")` on a $10 payment, then `refund("8.00")`: `D partial: REFUNDED then remainder: {"status":"REFUNDED","reason":"already refunded"} payment: REFUNDED`. The $8 is unrefundable through the API, and the second call falsely reports success.
- **Stripe mapping:** `stripe-provider.ts:365-370` maps `requires_action` and `canceled` to FAILED, which triggers the CONFIRMED rollback while a Stripe refund object may still exist.
- **Idempotency window:** Stripe idempotency keys expire (24h per Stripe docs). A claim resumed after that with the same key issues a *new* refund. For a payment that is already fully refunded Stripe errors, the error escapes (H-4), and the payment is stuck DISPUTED while the rail shows REFUNDED.
- **Fix:** store `refundedAmount` and refund rows. Only move to REFUNDED when `refundedAmount == amount`. Add PARTIALLY_REFUNDED (or keep CONFIRMED with a ledger). On resume, list refunds for the PaymentIntent before creating one.

### H-6. Pull-only design has no reconciler, so paid-but-unconfirmed payments are deferred forever
- **Evidence:** `sweeper.ts:55-60,104-107` defers (skips) attempts whose rail status is SUCCESS or PENDING, and nothing ever calls `confirmPayment` for them. Confirmation depends entirely on a client hitting the confirm path.
- **Scenario:** buyer pays, never returns to the site. The session is `complete`/`paid`. The sweeper sees SUCCESS, defers every tick, and the payment sits PROCESSING until C-1 terminalizes it. The merchant has been paid and the buyer received nothing.
- **Fix:** the sweeper should call `service.confirmPayment` for every non-terminal attempt whose rail says SUCCESS, and page ops when a session has been `paid` for more than N minutes without a receipt.

---

## Medium

### M-1. Payments can be pinned in PROCESSING forever
- `service.ts:250,254-255` payment `expiresAtMs` is `null` when the caller passes no `expiresAt`, but the attempt gets Stripe's default 24h expiry (`:331-332`). `persistence.ts:322-332` and `memory-stores.ts:88-94` never expire a payment whose `expiresAtMs` is null, and nothing cascades "all attempts EXPIRED" up to the payment. Once the attempt expires, `confirmPayment({paymentId})` returns EXPIRED for the attempt (`:759-762`, `:424-426`) and never touches the payment.
- `stripe-provider.ts:137-146`: `complete` + `unpaid` is PENDING. Async methods are enabled via `paymentMethodTypes` (`:261`). An async payment that *fails* leaves the session `complete`/`unpaid` forever (Stripe signals failure only via the async_payment_failed webhook, which this design omits), and the sweeper then defers it indefinitely (`sweeper.ts:58-60`).
- Fix: derive the payment expiry from the rail `expiresAt` when absent. Cascade attempt EXPIRED to payment. For `complete`+`unpaid`, expand `payment_intent` and map `requires_payment_method` / `canceled` to FAILED.

### M-2. Stripe amount/status mapping verifies what was requested, not what was paid
- `stripe-provider.ts:169` uses `amount_subtotal ?? amount_total`. Per Stripe docs, subtotal is "before discounts or taxes". Today the session params (`:278-299`) carry no coupons, tax or adjustable quantity, so the two values are equal and nothing is exploitable now.
- `stripe-provider.ts:137-141` maps `no_payment_required` to SUCCESS. If anyone later enables `allow_promotion_codes`, a 100% coupon yields `no_payment_required` with the full-price subtotal, which passes `amount_match` and CONFIRMS a $0 payment. That would be a free-goods Critical.
- Fix: compare `amount_total` for `amount_match` and separately assert `total_details` has no unexpected discounts. Treat `no_payment_required` as SUCCESS only when the expected amount is zero. Require `payment_status === "paid"` otherwise.
- Currency: `stripe-provider.ts:170` reads `session.currency`. Per Stripe's 2025-03-31 changelog, newer API versions keep `currency` in the integration currency (the buyer's local currency is only in `presentment_details`), but sessions on older API versions carry the customer's currency with the original in `currency_conversion`. Your script pins `2025-06-30.basil`, but the adapter takes an injected client and does not pin or assert a version. On an older client, an Adaptive Pricing buyer yields `currency_match` failure on captured funds, then DISPUTED. I could not exercise this live; treat it as a documented risk to verify, not an observed bug. Fix: assert the client API version at construction, or fall back to `currency_conversion.source_currency`.
- `:170` casts any Stripe currency to `PaymentCurrency`. `centsToUsd` (`:49-56`) assumes two decimals, so a zero-decimal currency would render a wrong amount (currency_match fails first, but the receipt and event paths would carry the cast value).

### M-3. Dedupe and fingerprint weaknesses
- Fingerprint (`service.ts:158-171`) includes reference, amount, currency, provider, purpose, customer/agent/product/order and recipient. It **omits** `network`, `token`, `payer`, `expiresAt`, `metadata` and `idempotencyKey`. Two callers with the same reference and the same IDs but a different `network` or `expiresAt` silently dedupe to the first caller's payment and its stored `network`/deadline.
- `idempotencyKey` is not an independent anchor: it is looked up second (`:229-232`) and the fingerprint contains the reference. Repro (same key, regenerated reference, identical body): `E key retry new ref -> deduped:false conflict:"reference \"E2\" already bound to a different request"`. A client that retries with a fresh auto-generated reference but the same key gets a conflict, not a replay. Conversely, a reference match with a *new* key returns deduped and never records the new key.
- Conflict leaks the winner: `dedupeOutcome` (`:724-736`) returns the existing `payment` and `providerMetadata` (the Checkout URL) on a conflict. The repro shows `leaks checkoutUrl: {"checkoutUrl":"https://x/cs_1",…}`. Anyone who knows a reference and sends a mismatching body receives the other party's payment and checkout link; the type is non-optional so callers that only check `.payment` (like the dogfood script at `:152`) proceed with the wrong payment. There is no caller/tenant binding on a reference at all.
- `:724-726` fails open when the stored fingerprint is `null`, so legacy rows never conflict.
- `:739-744` `latestAttempt` throws when the winner has not yet inserted its attempt (concurrent create) and permanently if the process died between payment insert (`:238`) and attempt insert (`:262`). The reference is then poisoned: every later create with it throws.
- `:255-259` a race lost on `idempotencyKey` (not reference) throws a raw `Error` because only `getByReference` is retried.
- Fix: put every request-shaping field in the fingerprint (hash it). On conflict, return only `{conflict}` with no payment data. Make `idempotencyKey` the primary anchor when present. Make payment+attempt creation atomic (one transaction in the DB store).

### M-4. createPayment error paths burn references and mis-state ambiguous failures
- `service.ts:300-319`: any throw from the rail marks the payment FAILED, including timeouts and connection resets where Stripe may have created the session. That session is then orphaned and the reference is permanently consumed (`FAILED` is terminal, `status.ts:38`; the reference stays unique).
- `StripeLikeClient.sessions.create` (`stripe-provider.ts:107`) accepts no options, so `sessions.create` is sent with no Stripe idempotency key (`:278`). A safe retry is impossible. Pass `idempotencyKey: reference` and let the service retry ambiguous failures instead of failing them.
- Validation that belongs before the insert happens after it: the 15-digit bound (`service.ts:770-773`) is wider than `usdToCents` accepts (`stripe-provider.ts:42-44`, safe-integer cents) and Stripe's own maximum, so an over-large amount inserts rows, then fails inside the rail `try` and burns the reference. Same for non-USD currency (`stripe-provider.ts:266-270`), over-long metadata, or an invalid `expiresAt` (Stripe requires the expiry to be between 30 minutes and 24 hours out).
- `reason` (`service.ts:301-307`, up to 200 chars of the SDK error) is stored in the event log and returned to the caller. Stripe auth errors echo a partially masked key (`Invalid API Key provided: sk_test_****abcd`), so a misconfiguration leaks the last four characters into the audit log and API responses.

### M-5. The DISPUTED-on-captured-funds path persists no evidence and can misreport
- `service.ts:539-544` writes only a status transition with the failed check IDs. The PaymentIntent id and evidence are not persisted (no receipt, no `transactionHash` patch, no attempt transition), so ops had to find the charge in the Stripe dashboard by hand, which matches your live run.
- The `drivePaymentTo` result is not checked, yet the function returns `status:"DISPUTED"`. If the payment was already EXPIRED/FAILED the persisted status is different (the same invariant violation as H-3).
- `stripe-provider.ts:272-298`: `metadata` goes on the Session only, not on the PaymentIntent (`payment_intent_data.metadata`), so the charge cannot be mapped back to a reference from the PI side.

### M-6. Replay guard and token verification are weaker than the comments claim
- `service.ts:473-484` is check-then-act. `memory-stores.ts:150-178` `applyStatus` patches `transactionHash` with no uniqueness check, and `getByTxHash` (`:143-148`) ignores the provider while `create` (`:110-116`) scopes by provider. Two attempts racing on the same hash both pass, and both confirm. A DB store needs a unique `(provider, transaction_hash)` index enforced on the patch, not only on insert. Stripe is safe in practice (one PI per session); DIRECT_USDC/X402 are not.
- None of the 9 checks verifies `token` (see H-1). An onchain payment in the wrong token with the right amount depends solely on `currency_match`, which only distinguishes `USD` from `USDC`.

### M-7. The dogfood script proves less than the writeup says it does
- `payments-stripe-dogfood.mts:281` expects the re-refund to be `FAILED — claim already taken`, but `service.ts:638` short-circuits to `{status:"REFUNDED", reason:"already refunded"}` before the claim is ever attempted. The `railRefundCount=1` result is real, but it demonstrates the REFUNDED short-circuit, **not** the claim-first guard. The concurrent paths (H-3) are never exercised. Add a `Promise.all` of two refunds and a refund-plus-reconfirm case, and fix the comment or the expectation before publishing the transcript.
- `:152` is dead code: `createPayment` always returns `payment` and `attempt` (rail failure sets `error`), so a failed create falls through to the "no checkout URL" exit at `:168-171` and hides the real error.
- `:216-223` has no try/catch: one transient Stripe error from the confirm loop aborts the run before `writeTranscript` (only called at `:229` and `:288`). No state is lost on Stripe's side, but the evidence file is.

### M-8. Self-heal receipts record expectations as if they were observations
- `service.ts:584-601`: when the heal path runs without evidence (`:421-423`), the receipt is built from the attempt (`amount: attempt.amount`, `network: attempt.network`, `payer: null`) with `verifiedAtMs: at` (now) and `payload: null`. For an append-only receipt that is supposed to be evidence, it states a verification time that did not happen and echoes the expected network ("stripe-testmode") that Stripe never reported. Mark self-healed receipts explicitly (`payload:{healed:true}`, `verifiedAtMs` from the original confirm) or re-pull evidence before writing.

---

## Nits / Suggestions
- `checks.ts:68-87` `reference_exists` is a tautology for Stripe: `expected.reference` is `attempt.providerReference` (`service.ts:460`), which is the id used for the retrieve. Check `session.client_reference_id` / `metadata.reference` against `payment.reference` for real binding.
- `service.ts:352-359` marks the payment PROCESSING while the attempt is still PENDING (buyer has not opened checkout). PENDING would be the honest state; PROCESSING should mean "payment seen on the rail".
- `service.ts:614` and `:513` cast arbitrary payment/attempt statuses (REFUNDED, PROCESSING) to `ConfirmPaymentOutcome["status"]`, which excludes them. Widen the union instead of casting.
- `service.ts:238-253` stores `payment.amount` as given ("100.5" stays "100.5") and, for USDC, a 6-decimal value under `currency:"USD"` (`:247`). `validatePayment` / `validatePaymentAttempt` (`entities.ts:231-241`) are never called by the service. Normalize to canonical form ("100.50") at ingestion so string equality elsewhere is safe, and call the validators.
- `service.ts:218-225` never checks at runtime that `currency` ∈ {USD, USDC} or that `purpose` / `provider` are valid, so an untyped JSON caller can persist arbitrary strings (an unknown currency takes the USD branch).
- `stripe-provider.ts:332-384` `refundPayment` does not check `payment_status === "paid"`, passes no refund `reason` or metadata, and treats `requires_action` as FAILED (H-5).
- `stripe-provider.ts:266`: `customer_email: input.payer` conflates "payer" with an onchain payer address elsewhere in the interface. A non-email value makes Stripe reject the session.
- `client_reference_id` and metadata have Stripe-side length and character limits; a reference with unusual characters fails at the rail after rows exist (M-4). Validate the reference shape in the service.
- `refundPayment` has no `actor` parameter and hardcodes `"payment-service"` (`service.ts:652,696,705`), so the audit log cannot say who initiated a refund. There is also no authorization concept anywhere in the service; document that the caller must enforce it.
- `sweeper.ts:87-99` and `memory-stores.ts:88-94`: `listExpired` returns DISPUTED rows every tick that `isPaymentExpiredRow` then discards. Filter in the store query.
- Dogfood script: `PUBLIC_BASE_URL` comes from the same `.env` as the server (`:65`), so a test-mode checkout may redirect to the production host. Use a dedicated var. The `--wait` argument has no NaN guard (`:55`; NaN silently skips the loop). Abort paths leave open test sessions with no cleanup.
- `memory-stores.ts` is O(n) per lookup, which is fine for a reference implementation but must be documented as test-only. Its uniqueness semantics differ from what a SQL store needs (H-3, M-6).

---

## Verified-good
- Provider resolution happens before any insert (`service.ts:218`), so an unregistered provider leaves no orphan rows.
- Money is decimal strings end to end. The USD regex `^(0|[1-9]\d*)(\.\d{1,2})?$` (`entities.ts:167`) rejects exponents, signs, leading zeros, ".5", "5." and 3+ fractional digits. `"100.5"` is accepted and correctly becomes 10050 cents (it is not rejected, and shouldn't be). JavaScript's `$` anchor does not match before a trailing newline, so there is no newline-suffix bypass. Non-strings fail the `typeof` guard.
- `usdToCents` (`stripe-provider.ts:36-46`) uses BigInt and rejects values above `MAX_SAFE_INTEGER` cents; `centsToUsd` rejects negative and non-integer input. There is no floating-point path.
- `decimalAmountsEqual` compares integer and fractional parts as strings after padding, so "9.9" equals "9.90" with no rounding, and a malformed evidence amount fails the check rather than throwing (`checks.ts:96-102`).
- Missing `amount_total` maps to "0.00" and fails `amount_match` closed (`stripe-provider.ts:169`).
- Only the rail call sits inside the create `try` (`service.ts:288-320`), so post-rail persistence errors surface honestly instead of being relabelled as rail failure.
- The rail can never CONFIRM at create: `rail.status === "CONFIRMED"` is clamped to PROCESSING (`service.ts:342-343`), and CONFIRMED is only reachable through the verification pipeline or the self-heal completion.
- Guarded CAS writes (`persistence.ts:261-313`, `memory-stores.ts:74-85,150-178`) plus the domain transition tables (`status.ts`) make the state machine illegal-transition-safe, with an append-only event per transition. A lost race returns `null` rather than overwriting.
- Lost guarded write on confirm re-reads and reports persisted truth (`service.ts:499-519`), and receipts dedupe on `(provider, externalReference)` so re-confirm cannot double-issue.
- Retrieve failures during verify are not turned into FAILED: a non-404 error propagates and leaves the payment PENDING, a 404 maps to UNKNOWN and leaves state untouched (`stripe-provider.ts:315-330`, `service.ts:437-442`). That is the correct direction for an ambiguous rail read.
- `complete` + `unpaid` is PENDING, not failure (`stripe-provider.ts:143-146`), which avoids a false terminal state for async methods.
- Caller metadata cannot spoof the `reference` key (written last, `stripe-provider.ts:243-245`) and the 40-key Stripe cap is respected.
- The refund claim itself works for the sequential case. Taking CONFIRMED→DISPUTED before the irreversible call, plus a deterministic idempotency key, gave `railRefundCount=1` in your live run, and the rollback on a returned FAILED/UNSUPPORTED restores CONFIRMED (`service.ts:703-709`).
- The Stripe SDK never enters the pure package; the structural `StripeLikeClient` keeps the domain testable (`stripe-provider.ts:104-120`).
- Dogfood script: refuses any key that is not `sk_test_*` before constructing the client (`:57-64`), never logs the key, and writes a whitelisted-field transcript (`:80-84`, `:291-308`). Hosted Checkout means no card data touches the process. Conflict and dedupe edges are exercised against the real rail.

---

## Resolution (2026-11-09) — fixes verified, re-audit requested

| Finding | Status | Fix / evidence |
|---------|--------|----------------|
| C-1 | **FIXED** | `sweeper.ts` exports `railAttemptStatus` → `alive/dead/error`; payment+attempt sweeps and lazy `expirePaymentRowIfDue` consult the rail and defer on `alive` **or** `error`. `confirmPayment` re-verifies EXPIRED attempts that carry a `providerReference` — late SUCCESS routes to DISPUTED (with M-5 evidence), not a dead end. Test: `lazy expiry › defers expiry while the rail reports alive (C-1)`. |
| H-1 | **FIXED** | `PaymentProviderCapabilities` (`supports`) added; `createPayment` rejects `network`/`recipient`/`token`/currency expectations the provider can't satisfy **before any insert** (Stripe declares all three false). DISPUTED exit: `refundPayment` falls back to the attempt whose rail evidence is SUCCESS when no CONFIRMED attempt exists. Live proof: `edge-fiat-network-guard → guardRejected:true` in `stripe-dogfood-1794257054489.json`. |
| H-2 | **FIXED** | Persisted attempt expectations are authoritative — caller `expectedRecipient`/`network` only fill gaps, `minConfirmations` is persisted at create and caller may only tighten. Test: `caller expectedRecipient cannot override the create-time binding (H-2)`. |
| H-3 | **FIXED** | Idempotency key uses canonicalized amount (`canonicalAmount`); guarded-write `null` results now checked; `completeConfirmation` returns early for DISPUTED/REFUNDED — re-confirm can no longer cancel an in-flight claim. Live proof: concurrent refunds → `railRefundCount:1`. |
| H-4 | **FIXED** | `refundPayment` validates amount + resolves provider + locates refundable attempt **before** claiming; rail-call wrapped — thrown errors roll back a newly acquired claim; final CAS results checked. |
| H-5 | **DEFERRED** | Refund ledger / partial-refund states (PARTIALLY_REFUNDED, `refundedAmount`) — design decision recorded; same class of deferral as the 220-8 M-6 ledger tail. Tracked as open follow-up. |
| H-6 | **DEFERRED** | Dedicated reconciler sweep (auto-confirm paid-but-unconfirmed sessions + ops paging) — separate slice; the C-1 fix removes the silent-loss path meanwhile (alive rail evidence always defers expiry). |
| M-1 | **Subsumed by C-1** | Payments can no longer be silently pinned to terminal EXPIRED while the rail reports alive; a truly-stuck PROCESSING payment still needs the H-6 reconciler — deferred together. |
| M-2 | **PARTIAL** | `compareDecimalStrings` added for amount checks in refund; Stripe amount-vs-paid verification tightening left open (needs charge-level amount compare, deferred). |
| M-3 | **PARTIAL** | Fingerprint conflict already enforced (live `edge-fingerprint-conflict` reproves); remaining dedupe-hardening items deferred. |
| M-4 | **FIXED** | `createPayment` returns `{ error }` instead of throwing after persist (script handles `created.error`); Stripe session create now uses `input.reference` as the Stripe idempotency key + `payment_intent_data.metadata` — retries don't burn references. |
| M-5 | **FIXED** | `disputeEvidence` persisted on the DISPUTED audit event via `ApplyContext.eventPayload`. |
| M-6 | **PARTIAL** | Refund idempotency hardened (H-3); replay-guard/token-check comment-vs-code tightening deferred. |
| M-7 | **FIXED** | Script: finite `--wait` fallback, `created.error` check, transcript preserved on confirm exceptions, concurrent refund calls + `railRefundCount` rail-side verification, capability-guard edge. Transcript `stripe-dogfood-1794257054489.json` now proves what the writeup claims. |
| M-8 | **FIXED** | Self-healed receipts persist `{ healed: true }` when there is no fresh verification verdict — expectations no longer masquerade as observations. |

**Verification:** `vitest` 114/114 green (6 files), `tsc --noEmit` clean, live Stripe test-mode re-run CONFIRMED → REFUNDED with all edge steps green (`evidence/stripe-dogfood-1794257054489.json`, `evidence-stripe-success-postfix.png`).

**Deferred (non-blockers, need decisions):** H-5 refund ledger + partials, H-6 reconciler sweep, M-2 charge-level amount compare, M-3 tail, M-6 tail.
