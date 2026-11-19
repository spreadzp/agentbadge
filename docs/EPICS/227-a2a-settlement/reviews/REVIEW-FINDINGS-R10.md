# Review Findings — a2a-settlement R10 (EPIC-227)

## Scope
Static re-verification of the Round-9 fixes. I could not run `vitest` or `tsc` here, so test and type claims below come from reading the code.

Files read in full:
- `settlement/services/`: `milestone-release.ts` (new), `milestone-revert.ts`, `milestone-force.ts`, `milestone-approve.ts`, `milestone-service.ts`, `resolve-apply.ts`, `rollup.ts`
- `settlement/`: `state-machines.ts`, `index.ts`
- `commerce/services/`: `review-revert.ts`, `review-postcommit.ts`, `review-settlement.ts`, `submission-review.ts`
- `commerce/settlement-bridge.ts`
- `routes/settlement/`: `settlement-admin-milestones.ts`, `helpers.ts`, `register.ts`
- `finops/admin-actions.ts`
- Tests: `settlement-lifecycle-force`, `settlement-lifecycle-revert`, `commerce-settlement-r4`, `review-revert`, `settlement-admin-routes`

I grepped `submission-service.ts` for its status guards and `settlement/services/*` for commerce imports.

I did not read `payout-service.ts` or `dispute-service.ts` in full. Both are unchanged in R9.

## Verdict
**REQUEST CHANGES** (0 Critical, 0 High, 3 Medium).

The R9 code is correct on the points you listed:
- `forceReleaseMilestone` is properly guarded.
- The `RevertReason` union and the shared classifier are sound and fail closed.
- `milestone-revert.ts` returns `released` and `paid_leg` correctly.

Two things are not done:
1. The two halves of the R9-M1 fix interact badly. The completion pass closes the agreement in the same call that logs the release exit, so on a last-milestone plan the exit leaves an orphaned milestone.
2. Several claimed behaviours are not covered by any test that reaches the real code path.

## Critical
None.

## High
None.

## Medium

### R10-M1 — Completion pass defeats the release exit (new deadlock-in-waiting)
- **Where:** `review-postcommit.ts` (`completionPass` on every verdict) combined with `milestone-release.ts`.
- **Setup:** a single-milestone plan, or the last pending milestone, has a standing `rsv_`/`ops_` APPROVED under a REJECTED submission.
- **What happens:**
  1. The `!releasable` branch logs `exit: POST …/release`.
  2. The same call then runs `completionPass`. `pendingMilestoneCount` excludes APPROVED, so the count is 0 and the agreement becomes COMPLETED. The task becomes COMPLETED too if it was the last agreement.
  3. The operator follows the log and calls release. The milestone goes to PENDING, the intent is CANCELLED and `FORCE_RELEASE_MILESTONE` is audited.
- **Result:** the milestone is orphaned.
  - `submission-service.ts:103-120` requires agreement ACTIVE and task IN_PROGRESS to submit.
  - Review requires agreement ACTIVE (`submission-review.ts`, `review-settlement.ts`).
  - The plan stays ACTIVE forever, with PENDING work under a COMPLETED agreement.
  - So the R9-M1 deadlock reappears one step later, and the log message sends the operator into it.
- **Why the release exit is not defeated everywhere:** it still works when the agreement is still ACTIVE, that is, when other milestones are pending.
- **Partial recovery:** a provider could call settlement `submitForReview` directly and the operator could then force-approve. That is accidental and undocumented.
- **Another exit:** raising a dispute with a FOR_BUYER resolution (APPROVED→DISPUTED→CANCELLED) is a clean exit after completion, but nothing tells the operator about it.
- **Fix, any one of:**
  - `forceReleaseMilestone` refuses (INVALID_STATE) when the commerce agreement for `plan.agreementRef` is not ACTIVE. `ctx.db.commerce` is reachable, as the bridge shows.
  - The `exit` log field is conditional on the completion pass not firing.
  - A documented post-completion exit (dispute FOR_BUYER) is added for last-milestone plans.
- **Test gap:** no test calls release after the R8-M1 completion.

### R10-M2 — Revert reasons and refusal paths are not exercised through the real service
- **Classifier tests are synthetic.** `review-revert.test.ts` feeds hand-built `{reverted:false, reason}` objects to `logRevertOutcome`. That proves the classification table only.
- **Real-service reasons never asserted.** No test asserts `reason: "released"`, `"paid_leg"` or `"intent_state"` from the real `revertApproval`. The only reason assertion in the repo is `epoch_mismatch` (`settlement-lifecycle-revert.test.ts:217`). The R9-M2 fix (RELEASED no longer reads as `not_approved`) can regress silently.
- **R9-M2 RELEASED spec does not reach the `released` branch.** `commerce-settlement-r4.test.ts:436` goes through the `bound.status === RELEASED` forensic-info branch in `postCommitSettlementSync`. It never reaches `revertApproval`'s RELEASED branch or `logRevertOutcome`.
- **Wiring is untested.** Nothing checks `revertGateApproval` → classifier, or the reject-release call site passing `label: "reject-release"`.
- **R9 nit-2 branch is untested.** `revertGateApproval` with `approvedByUs` and no `approvalToken` is not covered by any test (grep for the log string found nothing).
- **`forceReleaseMilestone` refusals are untested.** `settlement-lifecycle-force.test.ts:498` is titled "refuses when a leg already paid", but it pays the only leg, so the milestone is RELEASED. That tests the pre-atomic non-APPROVED guard, not the in-atomic `paid_leg` or `intent_state` refusals (partial payout, FROZEN intent). The "no audit row on `reverted:false`" claim is therefore unproven. Reading the code, it holds (`milestone-release.ts:43-51` returns before the audit).
- **Fix:** add the following.
  - A multi-leg partial-pay test, a FROZEN-intent test and a `released` test calling `revertApproval` directly.
  - A release test asserting `released:false`, `auditRecorded:false` and no new `FORCE_RELEASE_MILESTONE` row.
  - A spy-based integration test through `reviewSubmission`.
  - A test for the missing-token path.

### R10-M3 — In-atomic refusals return HTTP 200 `{released:false}` with no reason; route docs promise 409
- **Where:** `milestone-release.ts:43-51` and the route description (409 "Not APPROVED / paid leg / frozen intent").
- **Behaviour:** `paid_leg`, `intent_state` and a lost race (`not_approved` between the pre-read and the atomic) all return ok 200 with `{released:false, auditRecorded:false}`. Only the pre-atomic non-APPROVED guard returns 409.
- **Impact:** the exit's refusal reason (the one thing the operator needs to choose the next action) is only in the server error log. Any script that checks `status === 200` treats a refused release as success.
- **Fix:** map refusals to `fail("INVALID_STATE", …)` carrying `reason`. At minimum, return `reason` in the body and correct the route's response docs. Add a test.

## Nits / Suggestions
1. **Release is unpinned and unrestricted.** It accepts any epoch, including an `appr_` epoch bound to an ACCEPTED submission. That would cancel the payout for buyer-accepted work and leave the commerce side ACCEPTED/COMPLETED. It is admin-only and audited.
   - Suggested: accept an optional `expectedEpoch`, or require the operator to name the epoch kind.
   - Audit evidence (`boundSubmissionRef`, `approvalEpoch`) comes from the pre-atomic read, so it can be stale under a race. Return the actually-reverted epoch from `revertApproval`.
2. **Operator events are mislabelled.** On force-release, `revertApproval` emits `milestone.pending` and `intent.cancelled` with `reason: "verdict_not_committed"` and no `admin:true`, unlike force-approve. Pass an event reason through `RevertOptions`.
3. **Force-approve refusal wording.** A null or legacy epoch is reported as "commerce cycle" (`milestone-force.ts:114`). Say "unknown/legacy epoch".
4. **Stale route text.** The `/approve` description still says "Idempotent on APPROVED only while the intent is OPEN". Now it is idempotent on `ops_` only.
5. **`intent_mismatch` is effectively unreachable.**
   - The intent is unique per milestone and an epoch-matched approval implies that intent. Classifying it benign is harmless today.
   - If it ever fires with a matching epoch, it means an inconsistent row and should be an error. Consider moving it out of the whitelist.
6. **Inconsistent signal for standing rulings.**
   - A reject-release that hits `epoch_mismatch` (resolver re-stamped between read and CAS) logs only a warn.
   - The same standing `rsv_` ruling under a rejected submission via the `!releasable` branch logs error + `repair` + `exit`.
   - Both end in the same state.
7. **Nit-2 fail-closed trade-off.**
   - No token means no revert, so a failed-verdict approval stays payable (error+repair logged).
   - That is deliberate and correct versus an unpinned revert. It now relies on the release exit, so it is subject to R10-M1.
8. **Semantics of completing on REJECT.**
   - Completing the agreement and task while the only submission is REJECTED is safe for payment: settlement services never read commerce state, so `markLegPaid` is unaffected.
   - Downstream consumers that treat "agreement COMPLETED" as success will see it, though. The R8-M1 spec asserts only the agreement, not the task.
   - `completeAgreementIfClear` moving the task IN_PROGRESS→COMPLETED depends on a commerce transition I did not see. If it were illegal, `transitionRow` would roll back the agreement and the pass would only warn. The spec's passing assertion suggests it is legal.
9. **Deferred nits acknowledged, no action required this round:** untyped `epochPrefix`; ABA with `escrowRef` outside the CAS predicate; legacy null-epoch backfill; a dedicated epoch column; (entity, prevHash) uniqueness; outbox/replay.
10. **Admin action vocabulary.** `FORCE_RELEASE_MILESTONE` is added only to the server-side `KNOWN_ACTIONS` set. If the store column or enum is validated in `@agentbadge/database`, the first append would fail. Confirm the store accepts it (the other 227 kinds use the same pattern).

## Verified-good

### 1. `forceReleaseMilestone` — service
- **Pin only when a token is given.** `milestone-revert.ts:107-112` only checks `approvalToken` when `!== undefined`. `forceRelease` passes none, so it is an unpinned operator override, as intended.
- **Cannot undo a paid leg or a FROZEN intent.**
  - The intent must be OPEN or CANCELLED. FROZEN or COMPLETED returns `intent_state` with `reverted:false`.
  - An OPEN intent with any COMPLETED/FAILED leg returns `paid_leg`. The post-CAS re-list throws and rolls back if a leg pays mid-revert.
  - A partially paid intent also returns `paid_leg`.
- **Non-APPROVED refused before the atomic.** `milestone-release.ts:33-38` returns INVALID_STATE for any non-APPROVED milestone.
- **No audit row on a refusal.** `reverted:false` returns before `recordPostEffectAudit`. Audit uses the post-effect helper with a degraded fallback, and a lost audit row is surfaced as `auditRecorded:false`.
- **Input and not-found handling.** `checkForceInput` and `normalizeOperator` are shared with reopen. NOT_FOUND is returned for a missing row.

### 1. `forceReleaseMilestone` — route
- **Auth and body.** `adminAuth` is applied. The body is validated with the same shape as reopen (operator and reason, with the label guard first). The new action is in `KNOWN_ACTIONS`.
- **Error mapping.** INVALID_STATE→409, NOT_FOUND→404, BAD_INPUT→400. `auditRecorded` is surfaced in the response.
- **Mounting.** The route is mounted via `settlement-admin.ts:195`.

### 2. Completion pass on every verdict
- **Counts.** `pendingMilestoneCount` counts PENDING, READY and DISPUTED, so a disputed milestone keeps the agreement ACTIVE.
- **Null plan.** A null plan returns null; the pass treats it as `pending !== 0` and does nothing.
- **Foreign-binding READY.** A foreign-bound READY milestone stays READY, because release is compare-and-release on `expectedSubmissionRef`. It counts as pending, so nothing completes.
- **Release failures.** A failed or soft-failed release leaves READY and nothing completes.
- **Standing rulings and payment.** Completing over a standing `rsv_`/`ops_` APPROVED does not block payment, because payout and rollup are independent of commerce. The remaining problem is the exit (R10-M1).
- **Unbound submissions.** An unbound REJECTED submission returns before the pass, as before.

### 3. Classifier
- **Whitelist.** It is a closed `ReadonlySet`; unknown or missing reasons hit the fail-closed default (error + `repair` + `reason ?? "unknown"`).
- **Shared by both callers.** The gate revert (`"approval revert"`) and the reject-release (`"reject-release"`) both call `logRevertOutcome`. A null abort errors.
- **`epoch_mismatch` cannot hide a strand.** The row belongs to a newer approval cycle, and intent reuse is by CANCELLED→OPEN on the same row.

### 4. `released` and `paid_leg`
- **`released`.** `milestone-revert.ts:97-103` returns `reason: "released"` for RELEASED and `not_approved` otherwise.
- **`paid_leg`.** It is returned for any COMPLETED/FAILED leg.
- **Single-leg paid case.** That milestone is RELEASED (rollup), so it returns `released`, which the classifier treats as error. It does not degrade to warn.

### 5. `ops_`-only idempotent force-approve
- **Behaviour.** An `ops_` replay returns the same intent with `alreadyApproved`. An `rsv_` or `appr_` replay returns INVALID_STATE with a message pointing to force-release or the dispute path. The epoch is untouched (`milestone-force.ts:99-129`).
- **Test.** The `appr_` refusal is asserted in `settlement-lifecycle-force.test.ts:443` (INVALID_STATE, `appr_` epoch intact).
- **Not covered by the new tests.** An `rsv_` replay and the "no audit row on refusal" claim are not tested. The refusal returns before any audit call, so the claim holds.

### 6. R9 diffs
- **Module split.** `milestone-release.ts` imports only `checkForceInput` and `sha256Hex` from `milestone-force.ts`; there is no circular import.
- **Export wiring.** `index.ts` exports `forceReleaseMilestone` and the `RevertReason` / `RevertResult` types.
- **Bridge typing.** The bridge's `reason?: RevertReason` matches `RevertResult`. `BridgeRevertResult` is consistent.
- **Bridge call.** The bridge's `revertApproval` passes `opts` through unchanged.
- **Not verified by running.** `tsc` was not run, and the unseen test stubs were not checked against the narrowed `RevertReason` type. The visible tests construct valid reasons.

### 7. Coverage that does hold
- **Release service.** The test asserts APPROVED→PENDING, `escrowRef` null, intent CANCELLED, the `FORCE_RELEASE_MILESTONE` row and `auditRecorded`. A second call returns INVALID_STATE.
- **Release route.** The route test asserts 200, `released:true`, `auditRecorded:true`, exactly one new audit row, 400 without an operator, and 409 INVALID_STATE on replay.
- **Completion on REJECT.** R8-M1 (standing `rsv_`) and R9-M2 (RELEASED) both assert the agreement is COMPLETED.
- **`ops_` epoch.** The `ops_` epoch and the idempotent `ops_` retry are asserted.

## Round-9 status
- **R9-M1 — PARTIAL.**
  - The audited release service and route are correct and guarded.
  - The completion pass runs on every verdict and reconciles agreement+task for RELEASED and standing rulings.
  - The two combine into R10-M1: on a last-milestone plan the agreement is closed before the logged exit can be used.
- **R9-M2 — CONFIRMED-FIXED in code.**
  - The closed `RevertReason` union, `released` split from `not_approved`, a shared classifier and a fail-closed default are all present.
  - Regression coverage through the real service is missing (R10-M2).
- **R9-M3 — PARTIAL.**
  - Present: `ops_` epoch, idempotent `ops_` retry, `appr_` refusal, release service and route tests, and the classifier table.
  - Missing: in-atomic release refusals, real `released`/`paid_leg`/`intent_state` reasons, gate and classifier wiring, and the no-token path (R10-M2).
- **Deferred nits 1, 4, 5, 6, 7, 8 — acknowledged.**

## Remediation status (post-fix)

- **R10-M1 (completion pass defeats the release exit)** — FIXED.
  `forceReleaseMilestone` now refuses (INVALID_STATE) when the plan's
  commerce agreement exists and is not ACTIVE: releasing would orphan
  the milestone (PENDING work under a COMPLETED agreement — submit and
  review both require ACTIVE). The refusal message names the real
  exits: pay the OPEN intent, or resolve a dispute FOR_BUYER. Plans
  without a commerce row (pure settlement) proceed unchanged.
  Regression: R8-M1 spec extended — after the agreement completes the
  release call refuses and APPROVED + OPEN intent stand.
- **R10-M2 (reasons unproven through the real service)** — FIXED.
  `settlement-lifecycle-revert.test.ts` now asserts the real codes:
  `released` (paid milestone), `paid_leg` (partial multi-leg payout
  with milestone still APPROVED), `intent_state` (FROZEN intent),
  plus the force-release mapping, no-audit-on-refusal, and
  operator-labelled events. The missing-token fail-closed path is
  covered in `review-revert.test.ts` (revert never called).
- **R10-M3 (in-atomic refusals returned 200)** — FIXED.
  `forceReleaseMilestone` maps `reverted:false` to
  `fail("INVALID_STATE", …)` carrying the revert reason — the route
  returns a typed 409, matching its documented contract. Route
  regression: FROZEN intent → 409 + `intent_state` in the message,
  no audit row.
- **Nit 2 (operator events mislabelled)** — FIXED: `RevertOptions`
  gains `admin`/`eventReason`; force-release emits
  `reason:"operator_release"`, `admin:true` on `milestone.pending`
  + `intent.cancelled`.
- **Nit 3 (epoch-kind wording)** — FIXED: null/legacy epochs now read
  "unknown/legacy", not "commerce".
- **Nit 4 (stale route docs)** — FIXED: `/approve` description now
  says idempotent on `ops_` only; `/release` 409 list is complete.
- **Nit 5 (`intent_mismatch` benign)** — FIXED: removed from the
  whitelist — under a matching epoch it means an inconsistent row.
- **Nit 6 (inconsistent standing-ruling signal)** — FIXED:
  `epoch_mismatch` moved to the error class — same end-state as the
  `!releasable` branch, same signal.
- **Nit 10 (`FORCE_RELEASE_MILESTONE` store acceptance)** — VERIFIED:
  `AdminAction.action` is a plain `String` column
  (`deploy/database/src/prisma/contract.prisma`) — no enum/validation;
  the new action persists fine.
- **Nit 1 deferred**: optional `expectedEpoch` pin on force-release
  (documented; the admin is already authority-bound by reason+audit).
- 256 tests green (19 files):
  `vitest run --run tests/settlement tests/commerce`.
