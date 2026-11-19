# Review Findings — a2a-settlement R11 (EPIC-227)

## Scope

Round-11 adversarial re-verification of the R10 fixes, read from source plus the supplied tests (tests were read, not executed; the database package and `types.ts` were not in the bundle).

- Settlement: `milestone-release.ts` (new agreement guard, `reverted:false` mapped to `INVALID_STATE`), `milestone-revert.ts` (`RevertOptions.admin` / `eventReason`), `milestone-force.ts` (epoch-kind message), `milestone-approve.ts`, `rollup.ts`, `dispute-service.ts`, `dispute-resolve.ts`, `resolve-apply.ts`, `milestone-service.ts`, `events.ts`, `index.ts`.
- Commerce: `review-revert.ts` (BENIGN set narrowed), `review-postcommit.ts` (reject-release, completion pass), `review-settlement.ts` (gate), `submission-review.ts`, `submission-service.ts`, `settlement-bridge.ts`.
- Routes: `settlement-admin-milestones.ts`, `settlement-admin.ts`, `helpers.ts` (`respond` status map), `register.ts`.
- Tests: `settlement-lifecycle-revert.test.ts` (R10 block), `review-revert.test.ts`, `commerce-settlement-r4.test.ts` (R8-M1 spec), `settlement-lifecycle-force.test.ts`, `settlement-admin-routes.test.ts`, `helpers.ts`.

## Verdict

**REQUEST CHANGES** (0 Critical, 0 High, 2 Medium).

All three R10 Mediums are real fixes. `INVALID_STATE` maps to 409, the R10 tests prove their claims, and the `not_approved`-only whitelist is correct. The new agreement guard has two defects of its own. It fails open on any read error, and it is a non-atomic cross-store pre-read. Its stated invariant, "release never lands PENDING under a non-ACTIVE agreement", can still be broken silently. Both fixes are small. No fund-loss path was found. Payout is manual, and the paid-leg and frozen-intent refusals still hold.

## Critical

None.

## High

None.

## Medium

### R11-M1. The agreement guard fails open on errors, and on a missing plan

`milestone-release.ts:45-56`:

```ts
const plan = await ctx.db.settlement.plans.getById(milestone.planId);
if (plan) {
  const agreement = await ctx.db.commerce.agreements
    .getById(plan.agreementRef)
    .catch(() => null);
  if (agreement && agreement.status !== "ACTIVE") { ... }
}
```

- `getById` already returns `null` for a missing row. `register.ts:48`, `settlement-bridge.ts:175` and `submission-review.ts` all rely on that. The pure-settlement case therefore needs no `.catch`. The `.catch` only turns a thrown error (statement timeout, lock, pool exhaustion, replica lag error) into "no agreement, proceed".
- A transient failure on the commerce read, while the settlement reads and the atomic succeed, releases the milestone under a possibly COMPLETED agreement. That is exactly the R10-M1 orphan, with no log line.
- The same thread already chose fail-closed for the same shape. `revertGateApproval` treats a failed re-read as UNKNOWN and skips, and R9 nit 2 refuses an unpinned revert. This guard is the odd one out.
- `plan === null` (milestone exists, plan row missing) also silently skips the guard. `forceApproveMilestone` returns `NOT_FOUND` for the same inconsistency.
- The `.catch` does not cover a synchronous failure either. If `ctx.db.commerce` is undefined, the access throws before `.catch` attaches, and the route returns a 500 instead of a typed refusal.

**Fix.** Drop the `.catch`. Wrap the read in try/catch and return `fail("PROVIDER_ERROR", "cannot verify commerce agreement state — release refused")`, which maps to 503. Return `NOT_FOUND` when `plan` is null. Keep "row is null, so proceed" as the only fail-open branch, and comment it as the pure-settlement case.

### R11-M2. The guard is a non-atomic cross-store pre-read, so the orphan can still happen silently (two interleavings)

The agreement read happens outside `settlement.atomic`, and the commerce store cannot join that atomic. The invariant therefore holds only if nothing moves between the read and the CAS.

1. **Completion pass vs release.** `pendingMilestoneCount` excludes APPROVED, so the completion pass counts the milestone as "done" while it is APPROVED.
   - Sequence: the pass reads count 0 → the operator's release commits `APPROVED→PENDING` (guard read ACTIVE earlier) → `completeAgreementIfClear` commits COMPLETED.
   - The mirror order, where the release's guard read precedes a sibling review's `COMPLETED` commit, gives the same result.
   - Either way you get PENDING under COMPLETED, with the agreement and task terminal.
2. **Gate in flight.** The review gate approves (`appr_`, `submissionRef` = the SUBMITTED submission) before the verdict commits.
   - An operator release landing in that window is accepted. The guard sees ACTIVE, and release is not epoch-pinned to the cycle the operator looked at.
   - The ACCEPT then commits. Post-commit resync only re-approves a READY milestone, and this one is PENDING. `pendingAfter` was computed excluding this milestone, so the agreement can complete.
   - Result: an ACCEPTED submission, a PENDING milestone, a CANCELLED intent and a COMPLETED agreement, with nobody paid and no `repair` log.

The windows are milliseconds and operator-triggered, so this is Medium rather than High. The existing exit is a participant-raised dispute: `raiseDispute` accepts a PENDING milestone, and FOR_BUYER then cancels it. But nothing signals the state, which is the same "silent" defect class as R8-M2 and R9-M2.

**Fix (cheap).**
- After a landed revert, re-read the agreement. If it is non-ACTIVE, `logger.error` with `repair: "orphaned milestone after release"` and the dispute exit. It cannot be rolled back, but it becomes operator-visible.
- Additionally refuse (or require an explicit `force` flag) when the bound submission is still SUBMITTED. That is the in-flight gate window.

## Nits / Suggestions

1. **Layering (Q6): acceptable as a documented exception, not a clean one.**
   - It imports nothing from commerce, so the literal import rule holds. But it is the first read of a commerce domain table from settlement. `events.ts` / `index.ts:106` use `db.commerce.events`, and that table is explicitly generic.
   - It hard-codes the commerce status literal `"ACTIVE"` inside settlement. It also makes settlement unit tests depend on the commerce store, and the `settlement-bridge.ts` header ("settlement never imports commerce") is now only half true.
   - Preferred: an injected predicate on `SettlementCtx` (for example `ctx.guards?.agreementOpen(ref)`), wired in `createSettlementCtx` or the admin route the way `verifyAgreement` is wired in `register.ts`. If you keep the direct read, update the bridge header and D-227-2 to state the exception.
2. **The documented exit is not operator-actionable.** The refusal text says "resolve a dispute FOR_BUYER", but `raiseDispute` is participant-only (buyer or provider). There is no admin raise route in `settlement-admin*.ts`.
   - With the buyer unresponsive, the operator's only unilateral move is to pay the intent. Declining to pay leaves it APPROVED/OPEN indefinitely and the plan ACTIVE forever. This is stuck, not fund-losing, since payout is MANUAL.
   - A mistaken `ops_` force-approve becomes irreversible by the operator alone once any later review or completion pass completes the agreement.
   - Say "the buyer or provider must raise the dispute" in the message and route docs, or add an audited operator-raised dispute.
3. **DISPUTED commerce agreement is over-refused.** The guard is "status must equal ACTIVE", so a transient commerce-level DISPUTED agreement blocks release. The advice "resolve a dispute" is then misleading because one is already open. An orphan only exists for COMPLETED and CANCELLED, so consider refusing only those.
4. **`/reopen` has no mirrored guard.** `forceReopenMilestone` also moves a milestone to PENDING with no agreement check. A READY milestone under a CANCELLED agreement is payable via force-approve, which does not check the agreement. After reopen it is a dead PENDING row. Reachability depends on commerce cancel semantics, which were not in the bundle. Apply the same guard for consistency.
5. **Release is not epoch-pinned.** Audit evidence (`approvalEpoch`, `boundSubmissionRef`) comes from the pre-read, not the atomic, so it can describe a different cycle than the one released. Pin an optional `expectedEpoch` or read it from the atomic result.
6. **Doc and code mismatch on scope.** The route docs and the file header describe release as the undo for `rsv_`/`ops_` rulings. The code does not restrict by epoch, so an operator can also un-accept an `appr_` ACCEPTED milestone while the agreement is ACTIVE.
   - The result is an ACCEPTED submission over a PENDING milestone. Resubmission works, because `submit` needs only PENDING plus a task in IN_PROGRESS.
   - Either document it as intended or restrict to non-`appr_` epochs.
7. **Event labelling is incomplete.**
   - `leg.cancelled` and `milestone.revert_blocked` carry no `admin` or reason.
   - The reject-release path (`release:true`, committed REJECT verdict) still emits `reason: "verdict_not_committed"`, which is wrong because the verdict was committed. Pass `eventReason: "verdict_rejected"` from `postCommitSettlementSync`.
   - The bridge's `revertApproval` opts type correctly does not expose `admin` or `eventReason`.
8. **`epoch_mismatch` can false-positive.** It is correct as error+repair when the new epoch is `rsv_` or `ops_`, but it also fires when a legitimately newer `appr_` cycle owns the row.
   - Example: a release, then a resubmit and re-approve, all inside one revert's read-to-CAS gap. That is practically unreachable, so only a `repair` alarm is mis-raised.
   - Carrying `currentEpoch` kind in `RevertResult` would let the classifier discriminate.
9. **Machine-readable refusal reason.** `release refused inside the atomic (${reason})` encodes the reason only in message text, and tests assert via `toContain`. Add `details: { reason }` so scripts need not parse prose. "see server log" is also unhelpful for `paid_leg`, where the next action is to pay the remaining legs.
10. **Route 409 doc list is still incomplete.** The `409` response entry on `/release` reads "Not APPROVED / paid leg / frozen intent". The agreement-guard refusal appears only in the description paragraph, so the R10 claim "409 list complete" is partial.
11. **Test gaps.**
    - **ACTIVE-agreement path:** there is no test for the guard's allow path on an ACTIVE agreement through the commerce flow, or for resubmission after release (the R10-M1 "holistic" claim).
    - **CANCELLED agreement:** no test for a CANCELLED agreement.
    - **`.catch` branch:** the `.catch` branch is untested. The R11-M1 fix needs a test with a throwing `getById`.
    - **Refusal message:** the R8-M1 regression asserts only `INVALID_STATE` and the unchanged state. It does discriminate, because without the guard the release would succeed, but it does not assert the refusal message.
    - **Route-level 409:** there is no route-level 409 test for the agreement guard.
    - **`paid_leg` via force-release:** the partial multi-leg case is tested only against `revertApproval`, not through `forceReleaseMilestone`.
    - **Reachability of `intent_state`:** the test reaches it via a direct `applyStatus(FROZEN)`, which a real `raiseDispute` cannot produce, because a dispute also moves the milestone to DISPUTED. It is a defensive-only reason.
12. **Unverifiable here.** R10 nit 10 (`AdminAction.action` is a plain String column). The memory bundle writes `FORCE_RELEASE_MILESTONE` rows (force test, line 478), but the PG schema was not supplied, so parity is not confirmed.
13. **Deferred (acknowledged only):** R9 nits 1, 4, 5, 6, 7 and 8 (untyped `epochPrefix`, ABA under weak isolation, legacy null-epoch backfill, dedicated `approvalEpoch` column, `(entity, prevHash)` uniqueness, outbox/replay). R11-M2 shares a root cause with the ABA item, which is a cross-store check-then-act. It is raised separately because its outcome is a terminal-state orphan with no signal.

## Verified-good

- **Store method (Q1).** `ctx.db.commerce.agreements.getById(id)` exists with a single string argument and `row | null`. It is used identically at `register.ts:48` and `settlement-bridge.ts:175`, and `Database` is typed, so it is compile-checked.
- **Different entity type (Q1).** An `agreementRef` that is not an agreement id returns `null` and proceeds. In production, `verifyAgreement` forces a plan's `agreementRef` to name a live matching agreement, so a participant cannot point a plan at a foreign COMPLETED agreement to poison release.
- **`plan === null` (Q1).** Skipping is not exploitable, but it is inconsistent with force-approve (see R11-M1).
- **Status mapping (Q2).** `INVALID_STATE` maps to 409 and `CONFLICT` to 409 in `helpers.ts`, so a lost race still lands as a 409.
  - A leg paid before the in-atomic guard surfaces as `INVALID_STATE` (`paid_leg`).
  - A leg paid after the guard, before the intent CAS, throws `SettlementConflictError` and rolls back with its own code (409 by default; the class default is in the unseen `types.ts`).
  - The agreement guard runs before the atomic, so a refusal mints no audit row and no event.
- **Whitelist (Q3).** BENIGN is `{not_approved}` only. `not_approved` covers a sibling having reverted or released, or a dispute having frozen the row. The sibling-ACCEPT case skips before revert (the `sub.status === "ACCEPTED"` re-read), so `epoch_mismatch` does not fire there.
  - Reachable interleavings for `epoch_mismatch`: a dispute raise and resolve re-stamping `rsv_`, a force-approve `ops_`, or a release then resubmit and approve (`appr_` of a new cycle) inside the read-to-CAS gap.
  - Error+repair is right for `rsv_` and `ops_`, and consistent with the `!releasable` branch. For a newer `appr_` it is a false-positive alarm (nit 8).
  - `intent_mismatch` under a matching epoch is an inconsistent row, so error is right. The classifier test covers all six reasons and the missing-reason fail-closed case.
- **Operator event labels (Q4).** `payload: { reason: eventReason, ...(admin ? { admin } : {}) }` is emitted on both `intent.cancelled` and `milestone.<to>`. Verdict reverts default to `"verdict_not_committed"` with no `admin` key, so there is no regression on that path. The bridge's narrower opts type cannot set `admin`.
- **R10 tests (Q5).**
  - **Event store:** settlement events flow through `db.commerce.events` (`events.ts` header; `index.ts:106`: `createSettlementEmitter(db.commerce.events)`). `freshCtx` uses the same `Database`, so `listByEntity` in the event-label test is valid.
  - **Multi-leg rollup:** the multi-leg partial-pay claim holds. `rollupIntent` requires every non-CANCELLED leg to be COMPLETED, so one of two paid legs leaves the milestone APPROVED and revert returns `paid_leg`. `released` follows from a real single-leg `markLegPaid`.
  - **FROZEN refusal:** the test asserts the typed 409, the `intent_state` message, no `FORCE_RELEASE_MILESTONE` row, and unchanged milestone and intent.
  - **Fail-closed token:** the missing-token test asserts `revertApproval` and the submission re-read are never called.
- **Release guard end state.** For a COMPLETED agreement the R8-M1 spec shows the release refused with the milestone still APPROVED and the intent still OPEN. When the agreement is ACTIVE, the release lands PENDING and the plan stays ACTIVE. `submit` needs the agreement ACTIVE and the task IN_PROGRESS, which a REJECT or a non-last ACCEPT leaves in place, so the resubmission round works.
- **Force-approve epoch message.** `rsv_` gives "resolver", `appr_` gives "commerce", and null or other gives "unknown/legacy".
- **Layering of the bridge.** Commerce reaches settlement only through the bridge. The bridge does not expose `admin` or `eventReason`.

## Round-10 status

- **R10-M1 (completion pass defeats release exit): PARTIAL.**
  - The agreement guard is real, and the R8-M1 regression proves the COMPLETED case.
  - But it fails open on any read error (R11-M1) and is a non-atomic pre-read with two silent-orphan interleavings (R11-M2). The operator-only exit is also conditional on a participant raising the dispute (nit 2).
- **R10-M2 (revert reasons unproven via the real service): CONFIRMED-FIXED.**
  - `released`, `paid_leg` and `intent_state` run through the real `revertApproval`.
  - Force-release maps the refusal to `INVALID_STATE` with the reason in the message and no new audit row.
  - Operator events are asserted as `admin:true` plus `operator_release`.
  - The missing-token fail-closed case is covered.
  - Remaining gap: `paid_leg` is not exercised through `forceReleaseMilestone` (nit 11).
- **R10-M3 (in-atomic refusals returned 200): CONFIRMED-FIXED.**
  - `reverted:false` now returns `INVALID_STATE` (409) with the reason in the message.
  - A route test covers the FROZEN-intent case.
  - A structured `details.reason` is suggested (nit 9).
- **R10 nit 2 (operator event labels): CONFIRMED-FIXED.** Residual labelling gaps are in nit 7.
- **R10 nit 3 (unknown/legacy epoch kind): CONFIRMED-FIXED.**
- **R10 nit 4 (`/approve` doc idempotent on `ops_` only; `/release` 409 list): PARTIAL.** The `/approve` doc is fixed. The `/release` 409 response entry omits the agreement-guard refusal (nit 10).
- **R10 nit 5 (`intent_mismatch` removed from BENIGN): CONFIRMED-FIXED.**
- **R10 nit 6 (`epoch_mismatch` moved to error class): CONFIRMED-FIXED.** Residual false-positive case is in nit 8.
- **R10 nit 10 (`AdminAction.action` is a plain String column): NOT-VERIFIABLE here.** The PG schema was not supplied (nit 12).
- **R9 nits 1, 4, 5, 6, 7, 8: NOT-FIXED, deferred as agreed.**

## Remediation status (post-fix)

- **R11-M1 (guard fails open)** — FIXED. The `.catch(() => null)` is
  gone: a thrown commerce read now fails CLOSED as `PROVIDER_ERROR`
  (503) with a `repair` log; `plan === null` → NOT_FOUND (same as
  force-approve); the null-ROW branch is the only intentional
  fail-open (pure-settlement plan, commented). Regressions: throwing
  `agreements.getById` and throwing `submissions.getById` both refuse
  with PROVIDER_ERROR; milestone stays APPROVED.
- **R11-M2 (non-atomic pre-read → silent orphan)** — FIXED (the cheap
  path, both halves): (a) after a landed release the agreement is
  re-read — a COMPLETED/CANCELLED result logs `error` with
  `repair: "orphaned milestone after release"` + the dispute exit;
  (b) a bound submission still SUBMITTED refuses INVALID_STATE
  (`gate_in_flight`) — the in-flight gate window. Regressions:
  SUBMITTED binding refuses with `details.reason:"gate_in_flight"`;
  COMPLETED/DISPUTED/missing-row branches all covered.
- **Nit 2** — FIXED: the refusal text now says the buyer/provider
  raises the dispute.
- **Nit 3** — FIXED: only COMPLETED/CANCELLED refuse; DISPUTED is a
  live agreement (submission/review still work) — covered by test.
- **Nit 4** — FIXED: `forceReopenMilestone` runs the same guard —
  shared `checkReleasableAgreement` in new `agreement-guard.ts`.
- **Nit 5** — FIXED: `RevertResult.epoch` is the value the atomic
  actually reverted; the audit evidence uses it, not the pre-read.
- **Nit 6** — FIXED: scope documented — release intentionally covers
  `appr_` too (operator's un-accept while ACTIVE); header + route
  description updated.
- **Nit 7** — FIXED: `leg.cancelled`/`revert_blocked` carry
  reason+admin; the bridge exposes `eventReason` (not `admin`);
  reject-release emits `verdict_rejected`. Test asserts it.
- **Nit 9** — FIXED: `SettlementError.details` added; refusals carry
  `details.reason` (`agreement_not_active`/`gate_in_flight`/
  revert-reason codes) — scripts don't parse prose.
- **Nit 10** — FIXED: 409 list completed + 503 documented.
- **Nit 1** — documented exception in the bridge header (read-only
  data access, no commerce import).
- **Nit 8 deferred** (`epoch_mismatch` on newer appr_ — practically
  unreachable, alarm-only); nit 12 re-verified in prod PG parity
  (schema is plain String, confirmed earlier).
- 263 tests green (19 files):
  `vitest run --run tests/settlement tests/commerce`.
