# Review Findings — a2a-settlement R3 (EPIC-227)
## Scope
Static, adversarial re-verification of the Round-2 fixes. Everything was read from `context/hackathon/server/src/server/`:
- Settlement domain: `lib/settlement/{types,invariants,state-machines,verify-payout-tx}.ts` and `services/{plan-terms,plan-service,milestone-service,payout-service,rollup,dispute-service,dispute-resolve,anchor,receipt}.ts`.
- Routes: `routes/settlement/{register,settlement,settlement-admin,settlement-receipts,helpers}.ts`.
- Commerce seam: `lib/commerce/settlement-bridge.ts`, `services/submission-review.ts`, `services/offer-accept.ts`.

Not in the supplied tree, so any claim that depends on them is marked unverified:
- the `@agentbadge/database` PG and memory stores (isolation level, `atomic` impl, `disputes.list` default limit, unique indexes);
- `finops/guards` (`decimalToMicro` precision behaviour);
- the settlement event emitter;
- commerce submission creation (how `milestoneRef` gets bound).

No tests were run. Findings come from reading code. I also ran one runtime probe of `String.prototype.localeCompare` for the sort-tie question.

## Verdict
**BLOCK** (0 Critical, 3 High, 8 Medium).

No fund-theft or double-pay path was found. The Round-2 forgery, deadlock and write-then-fail fixes mostly hold. Three High issues remain, all on the "provider is never paid" or "payout attestation is blind" axis:
- **H-1:** the payout verifier is still not wired in prod. R2-H2 is only partly delivered.
- **H-2:** a submission without `milestoneRef` still completes the agreement unpaid. R2-H5 closed only the "bound but unresolved" variant.
- **H-3:** the post-commit `approveMilestone` is swallowed, and no other approval route exists in the supplied code. A single failure strands the milestone at READY forever.

Each fix is small. Re-review after H-1..H-3 and M-1..M-3.

## Critical
None.

## High

**H-1. No `VerifyPayoutTx` adapter is wired; the R2-H2 pins are dead code (R2-H2 NOT fully fixed).**
- `routes/settlement/register.ts` sets `deps.expectedPayer`, `deps.requireVerification` and `deps.chainId`. Nothing in the tree ever assigns `deps.verifyTx` (grep: only the type, the admin forward and the service read).
- Because `verifyLegTx` only runs when `deps.verifyTx` exists (`payout-service.ts:163`), `expectedPayer` and `chainId` are never evaluated.
- With `ARC_SETTLEMENT_REQUIRE_VERIFY` unset (the default) mark-paid is still blind operator attestation. With it set to `1`, every mark-paid returns 503 `VERIFIER_UNAVAILABLE`.
- `deps.chainId` is only set inside `if (receiptKey && chainId)`. Without a receipt signer key the chain pin silently disappears, even though the chain is known.
- Fix:
  - Implement and assign the adapter (viem `getTransactionReceipt` plus an ERC-20 `Transfer` log decode).
  - Decouple the chain pin from the signer.
  - Fail startup, or refuse mark-paid, when `requireVerification` is set without `expectedPayer` and an adapter.
  - Validate `ARC_SETTLEMENT_TREASURY_WALLET` as an EVM address.

**H-2. A submission with no `milestoneRef` completes the agreement and pays nobody (R2-H5 residual).**
- `submission-review.ts:53-55` only runs the settlement pre-read inside `if (pre?.milestoneRef)`.
- Without a ref: `pendingAfter` stays 0, the agreement goes COMPLETED, the post-commit approve is skipped (`result.submission.milestoneRef` is falsy), and the plan's milestones stay PENDING.
- Every accepted agreement gets a plan (`offer-accept.ts`), so this applies to all plan-having agreements, including the default single "full" plan.
- No route recovers it. The agreement is COMPLETED, so the `findMilestone` heal is off. There is no public submit or approve route.
- Fix: when `ctx.settlement` is wired and the agreement has a plan, ACCEPT must require a resolvable milestone. Either auto-bind to the sole milestone when the plan has exactly one, or throw `conflict(...)`.

**H-3. The post-commit `approveMilestone` failure is swallowed, and it is the only approval path.**
- `submission-review.ts:226-250` approves after the commerce verdict commits. Failures are `logger.warn` only, and `settled()` in the bridge also only logs.
- The submission is already ACCEPTED and the agreement may be COMPLETED. The review cannot be re-run because `submission.status !== "SUBMITTED"` blocks it.
- Reachable failures:
  - A TOCTOU between the pre-read and the commit: a dispute is raised on this milestone or on a sibling, so the plan is DISPUTED and `approveMilestone` rejects `plan.status !== "ACTIVE"`.
  - A transient store error.
  - A milestone with `releasePolicy: EVALUATOR_VERDICT`. `createPlan` accepts it, but v1 `approveMilestone` always rejects it (`milestone-service.ts:126`), so the milestone is permanently unpayable. The review pre-check never looks at the policy.
- Recovery gap: FOR_PROVIDER on a disputed READY milestone only restores READY (`to = prev`). SPLIT requires a prior APPROVED. The operator therefore has no way to force-approve.
- Fix, any of:
  - Approve before the commerce commit (idempotent: treat an already-APPROVED milestone as success), and abort the review if approve fails.
  - Add a reconciler that re-approves READY milestones whose submission is ACCEPTED.
  - Reject EVALUATOR_VERDICT in `checkMilestoneInputs` until it is implemented.
  - Let the operator resolve FOR_PROVIDER on READY into APPROVED plus an intent.

## Medium

**M-1. Concurrent reviews on different milestones can strand the agreement ACTIVE (R2-H4 residual).**
- `pendingAfter` is computed outside the commerce tx, against settlement state that is only advanced after commit.
- Reviews of m1 and m2 that overlap (or whose pre-read lands in the other's commit→approve window) each count the other as READY, so each sees 1 pending.
- Both commit, neither completes the agreement, and nothing triggers a later completion. The agreement stays ACTIVE and the task IN_PROGRESS.
- Sequential reviews are fine, because APPROVED is excluded.
- Fix: recompute at completion time. For example, complete the agreement from the post-approve step when the count is 0, or add a settlement→commerce "all milestones terminal" callback. The same missing callback leaves a plan whose last milestone is cancelled by FOR_BUYER ACTIVE forever.

**M-2. Throw-based rollback with a non-transactional emitter can leave phantom events (new from R2-H3 / M-C).**
- All `ctx.emit.emit(...)` calls go through `ctx` (the `Database` facade), not the atomic's `s` (`SettlementStores`). If the emitter does not join the transaction, a rolled-back section leaves its events in the append-only hash chain.
- M-C moved `leg.completed` before the rollup. A rollup MOVED now commits a `leg.completed` event for a rolled-back leg.
- `approveMilestone` emits `leg.opened` per leg before a later leg-conflict throw.
- Unverified because the emitter is not supplied. Fix: bind the emitter to the transaction, or buffer events and emit after commit.

**M-3. Throws surface as HTTP 500 instead of typed 409s.**
- `markLegPaid` (rollup MOVED), `approveMilestone` (intent or leg insert conflict), `raiseDispute` (dispute insert null) and `resolveDispute` (split leg conflict) throw plain `Error`.
- None is caught, so the admin and participant routes return 500 for conditions the code classifies as concurrent-state conflicts.
- Fix: throw a sentinel class inside the atomic and map it to `fail("INVALID_STATE" | "CONFLICT")` outside it.

**M-4. The plan-wide dispute dedupe (R2-H6) is a read-then-write check.**
- It relies on `atomic` being serialized. Under READ COMMITTED without a plan-row lock or a partial unique index, two disputes on different subjects of one plan can both pass.
- The loser's guarded `applyStatus` calls then no-op, which reproduces the empty freeze map this fix was meant to prevent.
- Fix: make the plan row the serialization point (`SELECT … FOR UPDATE`, or an ACTIVE→DISPUTED `applyStatus` before the dispute insert that aborts if it fails), or add `UNIQUE(planId) WHERE status='OPEN'`.
- Also, pre-R2-H6 data may hold several OPEN disputes per plan. Check for them when deploying.

**M-5. An invalid provider-authored offer payload permanently bricks an agreement.**
- `acceptOffer` does not validate `offer.payload.milestones`. If the sum does not equal the price, a payee is invalid, or an id is duplicated, `createPlan` returns BAD_INPUT.
- The result: no plan, `findMilestone` heal fails every time, and every milestone-bound review returns 409. The accepted slot and agreement are lost.
- The unbound-ref path (H-2) completes unpaid.
- Fix: validate with `checkMilestoneInputs(ms, offer.price)` at offer creation and inside the accept tx.
- Also, `verifyAgreement` and the `findMilestone` heal read the live offer row. If offers are mutable after acceptance, a provider can change the canonical vector. Snapshot the milestones into `agreement.payload` at accept.

**M-6. Verifier hardening gaps that matter once the adapter exists.**
- `PayoutTxExpectation` has no token contract address. `asset` is compared by symbol, so a fake "USDC" ERC-20 can satisfy it. Pin the USDC address from `getUsdc(chainId)`.
- `expectedPayer` is optional even with `requireVerification`. Any prior same-amount transfer to the payee after `notBeforeMs` then satisfies the leg (Q6: intended only when no pin is configured; see H-1 for the startup fail-fast).
- `chainId` and `network` use strict, case-sensitive string equality. A number or hex id from an adapter DoSes mark-paid, which is fail-closed. Normalize both.
- Confirm `decimalToMicro` rejects more than 6 decimals. It is not in the supplied tree. If it truncates, "10.0000009" matches 10.

**M-7. `milestoneVector` can throw on provider-authored data in the route seam (R2-M-H residual).**
- In `register.ts` the `try/catch` covers only the agreement amount compare.
- `sort`/`milestoneVector(canonical)` run on raw offer JSON. A non-string `milestoneId`, a non-string `payee`, or a malformed amount throws a TypeError, so POST /plans returns 500.
- An offer with `milestones: []` yields canonical `[]` in the seam. The bridge treats an empty array as "full", so the route can never create the plan the bridge creates (a false FORBIDDEN).
- Fix: wrap the vector compare in `try/catch` → FORBIDDEN, and treat an empty array like absent, consistent with `ensurePlan`.

**M-8. Participant griefing and lost evidence under the plan-wide dedupe.**
- Plan-wide dedupe means one participant's dispute on milestone A makes the counterparty's dispute on milestone B an INVALID_STATE.
- The counterparty's dispute on the same milestone returns `duplicate:true` and drops their reason and evidence.
- A plan-DISPUTED status also closes submit and approve for every milestone.
- Operator-resolved by design. Consider appending counterparty evidence to the OPEN dispute row, and add an SLA or alert.

## Nits / Suggestions
- `milestoneVector` joins with `|` and `\n` and ids are unescaped. Sum conservation makes a collision unexploitable (embedding a field in an id drops its amount from the squatter's total), but `JSON.stringify` the rows anyway.
- The sort uses `localeCompare`, which ties NFC and NFD ids (verified: `"é".localeCompare("e\u0301") === 0`). Ties keep input order, so the vector becomes order-dependent. The only effect is a false FORBIDDEN/CONFLICT, never a bypass. Use a code-point comparator.
- `title`, `acceptanceCriteria` and `dueAtMs` are not in the vector. A participant who wins the squat window (after accept commit, before `ensurePlan`) can set these, and `samePlanTerms` then adopts them silently. They are display and metadata, not payout.
- `verifyAgreement` denylists CANCELLED only. Use an allowlist (ACTIVE).
- `dispute-resolve.ts` plan restore: the global `s.disputes.list({status:"OPEN"})` may be capped by a default limit. `stillOpen` is now effectively dead because of plan-wide dedupe. Scope it by `planId` (the dispute payload already stores it).
- FOR_BUYER cancelling every milestone sets the plan to COMPLETED. `DISPUTED→CANCELLED` is legal and more truthful. A FOR_BUYER with already-COMPLETED legs leaves those paid legs and needs an out-of-band refund note.
- An AGREEMENT-subject dispute on a terminal plan can create an OPEN dispute with an empty freeze (the M2 terminal check only covers MILESTONE).
- `resolveDispute` emits `intent.cancelled` or `intent.unfrozen` even when the intent was not FROZEN.
- The `rollup.ts` header says dispute resolution uses the rollup. It does not.
- `submission-review.ts:54,80,84` are still unguarded awaits, so M-D is not fully typed. The PENDING heal also writes `milestone.ready` attributed to the provider on a buyer-driven path.
- `drainSettlementAnchors` has no claim step, so concurrent drains can double-send a memo.

## Verified-good
- **Forgery compare (R2-H1).** `verifyAgreement` and `samePlanTerms` both use the same `milestoneVector` (id, amount, policy, leg role/payee/amount multiset). Checked cases:
  - Duplicate ids in the request are impossible: `checkMilestoneInputs` enforces unique ids.
  - Duplicate ids in the canonical set can never equal a valid request.
  - Legs undefined versus `[]` compare equal, and `[]` is rejected at creation anyway.
  - An undefined `releasePolicy` is the same as BUYER_ACCEPT on both sides, and stored rows carry the default.
  - Sorting by id makes `seq` irrelevant.
  - Payee lowercasing and micro-normalized amounts are applied on both sides.
- **Leg payees (Q1).** A provider can name leg payees through the offer payload and the plan then pays them. That is by design (D-227-5, collaborators). Totals are conserved: legs sum to the milestone amount, which sums to the agreed amount. The provider can only redistribute their own funds, so this is not an escalation. The only surfaces are the mislabelled `PLATFORM_FEE` role (cosmetic) and buyer consent in the UI.
- **No `return fail` after a first write.** Verified in every atomic section:
  - `createPlan`: returns precede the plan insert; the milestone conflict throws.
  - `approveMilestone`: the intent-exists check is before the milestone `applyStatus`; the intent and leg conflicts throw.
  - `markLegPaid`: intent re-read, then `complete(...)` null return (no write yet), then rollup MOVED throws.
  - `raiseDispute`: the dedupe and plan-wide returns are before any write; the dispute-null case throws.
  - `resolveDispute`: the `!resolved` return is before any write; the split-leg conflict throws.
  - `rollupIntent`: every `"MOVED"` is returned before the intent write.
- **In-memory implementation (test-only).** No rollback on throw, so a throw leaves partial rows:
  - `createPlan` conflict: plan plus some milestones, and a retry then returns a permanent CONFLICT.
  - `approveMilestone`: APPROVED milestone with a partial intent or legs.
  - `raiseDispute`: frozen work with no dispute row.
  - `resolveDispute`: RESOLVED with a FROZEN intent.
  - `markLegPaid`: a COMPLETED leg with the txHash bound. Retry returns INVALID_STATE (leg not OPEN), and a different leg using that hash gets TX_REUSED.
  - Document this in the test notes. PG rolls the whole section back, assuming the store maps `atomic` to a real transaction.
- **Pending count (Q3 / R2-H4).** DISPUTED milestones still count as pending, so the agreement cannot complete under a live dispute. Excluding APPROVED removes the payout-lag deadlock for sequential reviews.
- **Review heal paths (R2-H5).**
  - A submission with `milestoneRef` that does not resolve, or a milestone that is not READY, now throws 409.
  - A PENDING milestone gets one `submitMilestone` retry then a recheck.
  - The `findMilestone` heal builds its plan from the offer vector and runs only for ACTIVE agreements.
  - A repeated or colliding milestoneRef finds the milestone APPROVED or RELEASED and 409s, so there is no double-approve.
- **Stuck READY (Q3).** A READY milestone with no review has no release path. There is no timeout, no evaluator, and no public approve route. Arbitration cannot force release (see H-3). Covered above.
- **Cross-plan interference (Q4).** Disputes on different plans cannot interfere. Intents, legs and freeze maps are keyed per plan and milestone. `agreementRef` equals a commerce agreement id (`ag_…`), so it cannot collide with `ms_…` ids in prod. The only shared surfaces are the global `disputes.list` (see Nits) and the global `(network, txHash)` replay index, which is intended.
- **Rollup gate and PG path (Q5).**
  - liveM DISPUTED → MOVED → throw rolls back the leg's txHash bind in PG, so there is no TX_REUSED poison.
  - The memory-only edge is documented above.
  - M-C is correct: the gate runs before the intent write.
  - Residual: 500 via M-3, phantom events via M-2.
- **Verifier split (Q6).**
  - An adapter returning network `arc` with no `chainId` while `expected.chainId` is set fails with "missing chainId". This is intended fail-closed behaviour, and its effect is correct.
  - `expectedPayer` unset leaves the payer optional (the self-pay guard still applies when reported). This is the intended "pin only when configured" mode, but see M-6 and H-1 for production.
  - Amount parse errors are `TX_UNVERIFIED`, the asset compare is case-insensitive, and the payer compare is lowercase.
- **Other fixes.** The `ensurePlan` closure is destructuring-safe (the method name `approveMilestone` does not shadow the imported function). `verifyAgreement` resolves the DB through `getDb`.
- **No new dispute-freeze regression.** The plan-wide dedupe sits entirely before the first write, and `scope.plan.status` staleness is harmless because `applyStatus` is guarded.

## Round-2 status
- **R2-H1 (milestone/leg/policy forgery): CONFIRMED-FIXED for every payout-bearing field.** The same vector is compared in `register.ts` and `plan-terms.ts`, and CANCELLED agreements are rejected. Residual: `title`, `acceptanceCriteria` and `dueAtMs` are not compared (Nits).
- **R2-H2 (verifier not wired in prod): NOT-FIXED / PARTIAL.** The admin routes receive `deps` and forward `chainId` and `expectedPayer`, but `verifyTx` is never assigned, so no verification runs (H-1).
- **R2-H3 (write-then-fail inside atomic): CONFIRMED-FIXED.** Every `return fail` sits before the first write and the post-write conflicts throw. Residual: M-2 (events), M-3 (500s), and no memory rollback.
- **R2-H4 (APPROVED counted pending): CONFIRMED-FIXED for sequential reviews.** Concurrent reviews can still strand the agreement ACTIVE (M-1).
- **R2-H5 (unresolved milestoneRef completes unpaid): PARTIAL.** The bound-but-unresolved case, the PENDING heal and the offer-vector heal are fixed. The unbound-`milestoneRef` case is still unpaid (H-2), and the swallowed post-commit approve is unfixed (H-3).
- **R2-H6 (overlapping disputes): CONFIRMED-FIXED (serialized).** The plan-wide check is correct. It is race-prone unless `atomic` serializes the plan (M-4).
- **M-A (payer, amount, asset, chainId): CONFIRMED-FIXED.** Residual: asset is checked by symbol only (M-6).
- **M-C (rollup gate and `leg.completed` ordering): CONFIRMED-FIXED.** The gate and ordering are correct. The earlier emit adds phantom-event exposure (M-2).
- **M-D (review pre-read wrapped): PARTIAL.** The `findMilestone` and `pendingMilestoneCount` calls are typed 409. The `submissions.getById`, `agreements.getById` and heal `submitMilestone` awaits are unguarded.
- **M-E (`ensurePlan` local closure): CONFIRMED-FIXED.** The closure is used in both `ensurePlan` and the `findMilestone` heal.
- **M-H (`getDb` seam and `decimalToMicro` try): PARTIAL.** `getDb` is honoured and the amount compare is wrapped. `milestoneVector` and the sort on offer JSON are unguarded (M-7).

## Round-3 remediation status (SLICE-227-8 r3)

- **H-1 (no adapter wired): FIXED.** `verify-payout-tx-viem.ts` — real viem `getTransaction`/`getTransactionReceipt`/`getBlock` adapter; native USDC rail (Arc gas token) + pinned-ERC-20 `Transfer` decode. `register.ts` assigns `deps.verifyTx`, pins `chainId` independently of the receipt signer, validates `ARC_SETTLEMENT_TREASURY_WALLET`/`ARC_SETTLEMENT_USDC_TOKEN` as EVM addresses, and **fails startup** when `REQUIRE_VERIFY=1` lacks adapter or treasury pin. `notBeforeMs` inclusion-age enforced via block timestamp. Spec: `settlement-verify-viem.test.ts` (8 tests).
- **H-2 (unbound submission completes unpaid): FIXED.** `openMilestones` bridge method (heals missing plan) + submit auto-binds the sole PENDING milestone; >1 pending → `milestoneRef` required (400); review's unbound path counts plan-wide pending instead of 0. Specs: `commerce-settlement-r3.test.ts`.
- **H-3 (swallowed post-commit approve): FIXED.** Approve moved BEFORE the commerce verdict commit (`resolveSettlementGate` in `review-settlement.ts`) — a failure leaves the submission SUBMITTED and returns typed 409. APPROVED is a resume state. Recovery seam: `POST /admin/settlement/milestones/:id/approve` → `forceApproveMilestone` (idempotent, `admin:true` event). `EVALUATOR_VERDICT` rejected at plan create (`checkMilestoneInputs`) + offer create/accept. Specs: lifecycle + routes + r3.
- **M-1 (concurrent reviews strand agreement): FIXED.** `IN_PROGRESS→COMPLETED` task edge + post-commit `completeAgreementIfClear` re-checks pending count and completes agreement+task.
- **M-2 (phantom events): FIXED.** `SettlementEventEmitter.buffer()` — all atomic sections queue emits and flush after commit; rolled-back sections leave no events.
- **M-3 (500s): FIXED.** `SettlementConflictError` sentinel thrown inside atomic; every service catches at the section boundary → typed `fail("CONFLICT"|"INVALID_STATE")` → 409.
- **M-4 (dedupe read-then-write race): FIXED.** `plans.applyStatus(ACTIVE→DISPUTED)` is now the first write inside the section — the CAS claim serializes concurrent plan-scope disputes; the loser gets INVALID_STATE. Also rejects disputes on non-ACTIVE plans (covers the AGREEMENT-on-terminal-plan nit).
- **M-5 (bad offer milestones brick agreement): FIXED.** `checkMilestoneInputs` at offer create + inside the accept tx; milestones snapshotted into `agreement.payload` — `verifyAgreement` reads the snapshot, not the live offer.
- **M-6 (verifier hardening): FIXED.** `expected.token` pin (fake-USDC can't satisfy); REQUIRE_VERIFY without payer/adapter throws at startup; chainId normalized (number/hex/decimal) and network compared case-insensitively; `decimalToMicro` rejects >6dp (no silent truncation).
- **M-7 (milestoneVector throws on provider JSON): FIXED.** Vector compare wrapped in try/catch → FORBIDDEN; empty milestones array treated like absent (canonical "full").
- **M-8 (dedupe evidence loss): ACKNOWLEDGED — design tradeoff.** Counterparty re-raises after the OPEN dispute resolves; no store evidence-append method exists (would need a schema/repo change). Operator SLA is a runbook item, not code.
- **Nits:** JSON.stringify vector rows + code-point comparator (no localeCompare ties); `disputes.list` in resolve scoped by `payload.planId` with explicit limit; FOR_BUYER all-cancelled plan → CANCELLED (not COMPLETED); resolve emits unfrozen/cancelled only on actual CAS success; rollup.ts header corrected; review unguarded awaits wrapped; `drainSettlementAnchors` has an in-process claim guard (cross-process double-send is idempotent — same memo args).
- **Deferred nit:** `title`/`acceptanceCriteria`/`dueAtMs` not in the term vector — display metadata, not payout; a squat-window winner could set them but cannot move funds (documented).
