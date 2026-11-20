# Review Findings — Settlement R13 (EPIC-227)

## Scope
Confirmation of R12 remediation (135f8947): `agreement-guard.ts` (GuardVerdict), `milestone-revert.ts` (`cancel`, `conflict` reason), `milestone-release.ts` (epoch pin, `orphaned`), `milestone-reopen.ts` (new), `milestone-service.ts#reopenMilestone` (`to`), the two admin routes, and the specs `settlement-release-guard.test.ts` and `commerce-settlement-r4.test.ts`. The commerce service and bridge, …

## Verdict
**REQUEST CHANGES.** There are no Critical or High findings, and the R12 high is closed. Cancel wins over refuse under a terminal agreement, the foreign and `ops_`/`rsv_` locks are gone, and the epoch pin refuses correctly. R13-M1 is a confirmed false-audit path in the exact M-2 honest-flag surface this round was meant to close. R13-M2 and R13-M3 are safety gaps in the new cancel and refuse semant…

## Critical
None.

## High
None.

## Medium

### R13-M1: `forceReopenMilestone` still mints a false audit row and `reopened:true` when the row already sits at the target status
`milestone-reopen.ts:82` decides "did we transition" with `res.value.status !== to`. `reopenMilestone` (`milestone-service.ts:122-124`) returns `ok(milestone)` unchanged for any non-READY row. If a concurrent actor lands the row on the target between `forceReopen`'s pre-read and `reopenMilestone`'s own read, the unchanged row's status equals `to`, so the check passes. The result is:
- an append-only `REOPEN_MILESTONE` AdminAction attributed to this operator for a transition they did not make;
- `reopened:true` in the response.

Confirmed trigger: the raced reject-release (READY→PENDING+unbind), which is the exact scenario `/reopen` exists to recover. The same hole exists for `to=CANCELLED` if the row was cancelled concurrently, for example by two operators.

The R12-M2 test cannot catch this. It flips the second read to `APPROVED`, which is never equal to `to`. Nothing handles it: there is no `transitioned` signal and no CAS result visible to the caller.

Fix: have `reopenMilestone` return `{ row, transitioned }`, or expose the `transitionMilestone` outcome. Mint the audit row only when `transitioned` is true. Add a spec whose second read flips to `PENDING` and then to `CANCELLED`, and assert there is no audit row and `reopened:false`.

### R13-M2: `cancel` under a COMPLETED agreement irreversibly cancels an owed payout, with no operator opt-in
`agreement-guard.ts:108-113` treats COMPLETED and CANCELLED identically. For COMPLETED, an APPROVED milestone with an OPEN intent and zero paid legs is the normal state of an owed payout:
- the R8-M1 test (`commerce-settlement-r4.test.ts:438-443`) documents that the completion pass counts APPROVED as payable-work-done and completes the agreement;
- ops then pays the legs.

Force-release on that state now takes the cancel path (`milestone-release.ts:61-71`):
- the milestone goes terminal CANCELLED;
- the intent and all its OPEN legs are cancelled;
- `approveMilestone` cannot revive them. CANCELLED is terminal, and `doApprove`'s `isLegalTransition` check fails.

This applies equally to an `appr_` buyer-accepted payout or a resolver FOR_PROVIDER ruling. The same request body that on a live agreement yields a recoverable PENDING now yields an unrecoverable CANCELLED. The operator learns this only from `cancelled:true` after the fact. The test at line 444-461 asserts exactly this outcome, but only for a REJECTED submission, where cancelling is clearly right.

Answer to probe 1: CANCELLED is wrong whenever the commerce outcome was an acceptance and the money is still owed. Under an agreement that is COMPLETED but not CANCELLED, the guard cannot tell the two apart.

Fix: take the cancel path automatically only for an agreement that is CANCELLED. For COMPLETED, either require an explicit `confirmCancel:true` in the body (otherwise 409 `details.reason:"would_cancel_approved_payout"` with the intent id and amount), or auto-cancel only when the bound submission is REJECTED/REVISION_REQUIRED. Add a spec for COMPLETED + accepted `appr_` + OPEN intent.

### R13-M3: `gate_in_flight` cannot tell an in-flight verdict from a dormant SUBMITTED row on a live agreement, so the exit can lock indefinitely
The predicate (`agreement-guard.ts:78-83`) is SUBMITTED, owned by this agreement and milestone, and an `appr_` epoch. That state is reachable with no verdict in flight:
1. The provider creates a real commerce submission S for this agreement and milestone. S auto-binds and stays SUBMITTED.
2. The buyer calls `approveMilestone` directly. It has no commerce coupling (`milestone-service.ts:150-204`) and mints an `appr_` epoch. The r4 specs at lines 357 and 395 build exactly this state.
3. S stays SUBMITTED until the buyer reviews it. A dormant buyer, or a buyer colluding with the provider, can leave it that way indefinitely.

Force-release then returns 409 `gate_in_flight` ("let it commit first") forever. The agreement is live, so the R12 self-review fix (cancel wins) does not apply. The operator's undo of an `appr_` approval is therefore neutralisable. R12-H1 removed the provider-forged lock but left this buyer-driven one. It is not a regression, because the R11 guard locked the same way.

Fix: the real in-flight window is one request long. Bound the refusal by age, for example refuse only when the approval was minted less than N seconds ago. This needs a timestamp encoded in the epoch or a read of the row's `updatedAt`. Alternatively, give the operator an audited override. Add a dormant-SUBMITTED spec on a live agreement.

## Nits / Suggestions

Unverified items:
1. **Verdict-capable statuses other than SUBMITTED (promote to Medium if confirmed).** The r4 test header says the verdict atomic accepts `SUBMITTED/UNDER_REVIEW`, but the guard refuses only `=== "SUBMITTED"`. A verdict in flight on an `UNDER_REVIEW` submission with a gate-minted `appr_` epoch would pass the guard. This reopens the R11 race for that status. Confirm the commerce status set and use …
2. **Auto-bound submissions look foreign.** `submission.milestoneRef === milestone.milestoneId` assumes the row stores the caller key. The service header refers to auto-bind of submissions without a `milestoneRef`. If the stored `milestoneRef` is null for those, a legitimately bound in-flight submission is classed foreign and the guard is silently off for that population. The specs never exercise …
3. **Unreachable `gate_in_flight` on `/reopen`.** `forceReopen` only runs on READY rows. In the provided code every path into READY leaves `escrowRef` null (`revertApproval` clears it, `submitForReview` never sets it), so `escrowRef?.startsWith("appr_")` is false for those rows. Only the 503 read-failure refusal can fire there. The `/reopen` route's 409 "verdict in flight" description is therefore…
4. **No post-reopen orphan re-read.** `forceRelease` has one and `forceReopen` does not. A READY→PENDING reopen that races an agreement cancel is silent. The window is very narrow.
5. **`orphaned:false` means "not observed".** The post-check is a third non-atomic read. A closed agreement can still land after it. A self-healing PENDING→CANCELLED CAS on `orphaned` would beat flagging it. The only documented exit is a dispute, and whether a dispute can be raised on a PENDING milestone under a closed agreement is unverified.
6. **Epoch pin skipped for a null epoch.** `approvalToken: milestone.escrowRef ?? undefined` makes a null pre-read epoch mean "no pin". A legacy null-epoch row that was re-restored (`rsv_`) between the read and the atomic would be undone. This is practically unreachable, because it needs a dispute cycle in the gap. Pass an explicit `null` sentinel.
7. **APPROVED→CANCELLED goes through `applyStatus` directly,** bypassing `isLegalTransition`, like the existing APPROVED→READY/PENDING edges. Confirm `state-machines.ts` declares the edge and that the PG store does not reject it. The memory store accepted it in the specs.
8. **`RevertReason` omits the new `"conflict"` reason** carried in `details.reason`. This is fail-closed for callers, but the closed-union comment is now untrue.
9. **Possible missing audit row on a post-commit throw.** If `buf.flush()` (`milestone-revert.ts:267`) or `ctx.emit.emit` (`milestone-service.ts:49`) throws after the CAS committed, no audit row is minted for a landed transition. Whether those throw is unverified, because `ctx.emit` is not in the bundle.
10. **Paid legs on a CANCELLED intent.** The paid-leg guard applies only to OPEN intents, so `APPROVED` with a CANCELLED intent that holds COMPLETED legs would cancel the milestone. Whether that state exists depends on the dispute SPLIT path, which is not in the bundle.
11. **Unverified downstream effects of CANCELLED milestones.** These depend on files not in the bundle:
    - a dispute resolved FOR_PROVIDER or SPLIT against a CANCELLED milestone;
    - whether the plan rollup treats CANCELLED as terminal;
    - whether a dispute can be raised on a CANCELLED milestone.

    Within the bundle, a FROZEN intent can never be cancelled (`intent_state`), so probe 1's FROZEN case cannot arise from these paths. Add a regression spec once the resolver is in scope.
12. **Event-shape asymmetry.** `reopen→CANCELLED` emits `milestone.cancelled` via `transitionMilestone`, with no `admin:true` and no reason. The `revertApproval` path emits both. The audit row carries the operator and reason, so this is only an event-stream consistency issue.
13. **Stale audit evidence.** `boundSubmissionRef` in release and reopen evidence comes from the pre-read row, while `approvalEpoch` was already fixed to the atomic value.

Test coverage gaps (probe 6):
- The foreign-binding spec flips both axes at once (`agreementId` and `milestoneRef`). A mutation to `||` between the two comparisons passes it. Add separate cases for agreement-only mismatch and milestone-only mismatch.
- There is no `rsv_` case. Only `ops_` is covered.
- There is no spec for a null submission row, or for the `escrowRef` null path.
- Cancel-path branches are untested:
  - paid leg under cancel;
  - FROZEN intent under cancel;
  - `epoch_mismatch` (inject a changed `escrowRef` between the read and the atomic);
  - the `orphaned:true` response and evidence flag;
  - the CANCELLED agreement status;
  - the `operator_cancel` and `admin:true` event payloads;
  - the `toStatus:"CANCELLED"` audit evidence.
- There is no reopen spec for a stale SUBMITTED row under a terminal agreement.

## Verified-good
- **Precedence (probe 3).** The submission is read first and the refusal is applied after the agreement read, so terminal `cancel` beats `gate_in_flight`. Traced interleavings:
  - SUBMITTED read, then completion, then a COMPLETED read: cancel, correct.
  - SUBMITTED read, then verdict commits but the agreement stays live: spurious but safe refuse.
  - ACCEPTED read, then anything: proceed or cancel, both correct.

  The terminal state is absorbing, so the cancel verdict is stable. The only residual is proceed→PENDING followed by a late closure, covered by the log and flag (Nit 5).
- **R12-H1 closed for provider forgery.** A foreign agreement, a foreign milestone, or an `ops_`/`rsv_` epoch cannot lock the exit. Binding a submission to a milestone it doesn't belong to fails the `milestoneRef` equality. A real submission of this agreement for the same milestone is the legitimate in-flight case. Residual lock: R13-M3.
- **Epoch pin (probe 4).** `approvalToken` is the pre-read `escrowRef`. If a resolver re-restore (`rsv_`) lands between the operator's read and the atomic, the 409 `epoch_mismatch` is the right answer. The operator ruled on a different ruling, and a retry re-reads the new epoch and re-runs the guard. Because the pre-read feeds both the guard and the pin, they are consistent.
- **Fail-closed reads.** Both the submission read and the agreement read refuse with `PROVIDER_ERROR` on a throw. A missing agreement row is the only intended fail-open (pure-settlement plan).
- **Cancel-path in-atomic guards.** The cancel path reuses every guard:
  - `paid_leg` is checked before the CAS and re-listed after it;
  - a FROZEN or COMPLETED intent returns `intent_state`;
  - `intent_mismatch` and the epoch pin apply;
  - a lost intent or leg CAS rolls the whole revert back;
  - `cancel` takes precedence over `release`;
  - `CONFLICT` now carries `details.reason:"conflict"`.
- **Audit honesty on release (probe 5).** `forceRelease` mints audit only when `reverted:true`, meaning the CAS landed inside the atomic. Every refusal returns a typed 409 with no audit. Both PENDING and CANCELLED targets are audited with `toStatus`. The one confirmed deviation is R13-M1, on reopen.
- **Reopen mirrors the guard** (fail-closed reads, `READY→CANCELLED` via the legal-edge check, the `expectedSubmissionRef` pin) and refuses a live OPEN/FROZEN intent.
- **Non-vacuous specs.** These would fail on a regression:
  - the owned SUBMITTED + `appr_` refusal;
  - the foreign lock-attempt landing;
  - the owned SUBMITTED + `ops_` landing;
  - cancel-over-stale-SUBMITTED (the ordering regression);
  - both throwing reads;
  - `paid_leg` surfacing as `details.reason`;
  - the R8-M1 integration cancel through the real commerce routes.

---

## Remediation status (2026-11-20, post-R13)

- **R13-M1 (false audit when row already at target) — FIXED.**
  `reopenMilestone` now returns `{row, transitioned}` — the honest
  signal comes from the transition itself, not status equality. A row
  raced to PENDING/CANCELLED by another actor mints no audit and
  reports `reopened:false`. Spec: second read flips to the TARGET
  status (the case R12's test could not catch).
- **R13-M2 (cancel destroys owed payout under COMPLETED) — FIXED.**
  `kind:"cancel"` carries `agreementStatus`. CANCELLED agreements
  auto-cancel (nothing owed under a torn-down agreement); COMPLETED
  requires `confirmCancel:true`, else 409 with
  `details.reason:"would_cancel_approved_payout"` + the intent id.
  Both flags land in the audit evidence.
- **R13-M3 (dormant owned SUBMITTED locks forever) — FIXED.**
  `acknowledgeInFlight:true` on the release body is the audited
  operator override for the in-flight gate (epoch pin still protects
  against a verdict that actually lands — epoch_mismatch refuses).
  Spec covers locked→unlocked on a live agreement.
- The R8-M1 commerce test now passes `confirmCancel:true` (documents
  the owed-payout opt-in on resolver rulings under COMPLETED).
- Self-review additions beyond the auditor's list: reopen mints no
  audit on the target-status race EITHER direction (APPROVED flip
  test kept as the non-READY case).
- Result: 272 tests green (20 files), typecheck + lint clean.
