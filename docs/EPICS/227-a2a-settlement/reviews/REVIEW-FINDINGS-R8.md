# Review Findings — a2a-settlement R8 (EPIC-227)

## Scope

Re-verification of the four Round-7 Medium findings (R7-M1..M4) and the structural extraction, plus a probe of the code those fixes changed.

Read in full:
- `settlement/services/`: `resolve-apply.ts`, `dispute-service.ts`, `dispute-scope.ts`, `dispute-resolve.ts`, `milestone-revert.ts`, `milestone-approve.ts`, `milestone-service.ts`, `milestone-force.ts` (approve/idempotent section), `ctx.ts`
- `settlement/`: `events.ts`, `state-machines.ts` (milestone edges), `index.ts` (ctx cache)
- `commerce/`: `review-postcommit.ts`, `submission-review.ts`, `review-settlement.ts`, `submission-service.ts`, `settlement-bridge.ts`
- Tests: `settlement-lifecycle-revert.test.ts`, `commerce-settlement-r4.test.ts` (R7 tests), plus the test-name index of `settlement-lifecycle-force.test.ts`

Not verifiable from the supplied files:
- `tests/settlement/helpers.js` (`approvedIntent`, `freshCtx`, `openPlan`) is imported but was not supplied. Only `route-helpers.ts` was. The R7 restore tests were read at face value.
- The store-layer behaviour of `applyStatus(..., patch)` in `@agentbadge/database`.

Nothing was executed. This is a static review.

## Verdict

**REQUEST CHANGES** (0 Critical, 0 High, 3 Medium).

R7-M1 was a misread by the Round-7 auditor. It is a FALSE-POSITIVE, and the claim is correct. R7-M3 is fixed in the sense the finding asked for: the stale wait is bounded and the shared queue can no longer be stalled by one stream. R7-M2 and R7-M4 are only partly fixed, and the R7 changes added new edges:

- The new unpinned reject-release (`review-postcommit.ts:164`) removes the approval-cycle protection that R6-M2 added. It can cancel a payable intent that a dispute resolver or an operator re-landed.
- The "every abort path logs at ERROR with a `repair` key" claim is false for the most important abort class. `revertApproval` returns `null` through the bridge on any conflict-abort, and `revertGateApproval` logs nothing for it.
- A poisoned event stream stays dead until process restart, drops events with no log, and has a one-line self-heal.

## Critical

None.

## High

None.

## Medium

### M1: R7-M2 reject-release is unpinned and can undo a resolver- or operator-landed approval

`review-postcommit.ts:158-167` calls `revertApproval(bound.id, actor, { release: true })` with no `approvalToken` and no `intentId`. `findMilestone` returns only `{id, status}` (`settlement-bridge.ts:193`), so the code cannot compare `submissionRef` either. The branch fires for any APPROVED milestone bound to the rejected submission's `milestoneRef`, whichever approval cycle produced the APPROVED.

Reachable sequence (a pre-commit gate approve that the dispute froze before the verdict failed):
1. The gate approves milestone M for submission S. M is APPROVED with token T1 and intent I1 OPEN.
2. The buyer or provider raises a dispute. M goes DISPUTED with prev=APPROVED, and I1 goes FROZEN.
3. S's verdict atomic fails. The gate revert finds M DISPUTED and returns `reverted:false`. S stays SUBMITTED.
4. The operator resolves FOR_PROVIDER or SPLIT. M is restored to APPROVED with fresh token T2 (`resolve-apply.ts:68`), and I1 goes back to OPEN.
5. S is still SUBMITTED. The buyer reviews it as REJECTED. The task is UNDER_REVIEW, so the review is allowed.
6. Post-commit sees M APPROVED and calls an unpinned `release:true`. This cancels I1 and its legs, and moves M to PENDING with `submissionRef` and `escrowRef` cleared.

The operator's ruling is erased by a later unilateral buyer action. This is the exact scenario R6-M2's epoch token was introduced to prevent (a stale actor undoing a resolver's APPROVED). R7-M2 reopened it through a path with no pin.

The same unpinned release also cancels an operator's `forceApproveMilestone` on a READY milestone whose submission is still SUBMITTED. That one is arguable, because rejected work probably should not pay. A resolver ruling is not arguable.

What does hold:
- The paid-leg guard, the FROZEN-intent guard and the post-CAS leg re-list in `milestone-revert.ts` still apply.
- A DISPUTED milestone is skipped, because it is neither READY nor APPROVED.
- Sibling submissions cannot collide. `submission-service.ts:117` requires the task to be IN_PROGRESS to submit and moves it to UNDER_REVIEW, so only one SUBMITTED submission exists per task. Bound submits also require a PENDING milestone.

Fix options:
- Carry the approval cycle on the submission, for example `approvalToken` in `submission.payload` at ACCEPT-gate time, and pin the release to it.
- Or have `findMilestone` return `submissionRef` and `escrowRef`, and release only when the APPROVED epoch is the one this submission's gate minted.
- At minimum, skip the release when the intent's event stream or `payload` shows a dispute-restore or force-approve. Also log at ERROR with `repair` when the release is refused.

### M2: R7-M4 is only partly delivered. Abort and null results are silent, benign no-ops are logged as errors, and the reject and resync paths are warn-only

Every path in `revertGateApproval` that reaches a logger uses `repair`. Three classes do not.

1. **Abort/conflict returns `null`, so nothing is logged.**
   - The bridge maps `!res.ok` to `null` (`settlement-bridge.ts:245`). `revertApproval` turns every `SettlementConflictError` into `fail(...)` (`milestone-revert.ts:205-207`). The paths are: milestone moved, intent CAS lost, a leg paid during the revert, a leg CAS lost.
   - `revertGateApproval` only branches on `res && !res.reverted` and `res?.reverted` (`review-postcommit.ts:80, 88`). With `res === null` it does nothing. The only trace is `settled()`'s warn without a `repair` key.
   - This is the "aborted" path R7-M4 listed. The abort leaves milestone APPROVED and intent OPEN under a failed verdict, which is the stranded payable authorization the whole R4/R5/R6 chain tried to prevent.

2. **`reverted:false` is overloaded, so the `repair` signal is noisy.**
   `revertApproval` returns `{reverted:false}` for six reasons:
   - not APPROVED (already reverted or released by a sibling)
   - token mismatch
   - intent mismatch
   - intent in an unexpected state
   - paid leg
   - NOT_FOUND (via `fail`, which becomes `null`)

   `review-postcommit.ts:80-87` logs all of them as "approval revert refused — approval stands" at ERROR with `repair: "review milestone approval"`. The benign case is routine. If the reject-path release (M1's call site) runs first, the failing gate's later revert sees a PENDING milestone and reports a false repair alarm. Return a `reason` code in the result and log ERROR only for the dangerous reasons (`paid_leg`, `unexpected_intent_state`, abort).

3. **The new reject-path release and the resync path never log at ERROR or with `repair`.**
   - `review-postcommit.ts:164` discards the result. A `{reverted:false}` (paid leg, FROZEN intent) leaves a REJECTED submission with an APPROVED milestone and a payable intent. `revertApproval` logs error-level internally (`milestone-revert.ts:102, 114`), but with no `repair` key.
   - A thrown error lands in the generic `logger.warn("settlement milestone release failed")` (`:169`).
   - The ACCEPTED resync (`:185`) ignores the `{ok:false}` result, and its catch is warn. If the resync approve fails, the milestone is READY with a CANCELLED intent under an ACCEPTED submission. That is the "ACCEPTED + READY + CANCELLED" state, and it can escape error-level visibility:
     - A sibling's gate sees APPROVED and skips the approve.
     - Our revert lands.
     - The sibling's ACCEPT commits.
     - The resync approve fails (for example on the `existing` leg-paid CONFLICT in `doApprove`) and only `settled()` warns.
   - The heal-failure branch at `:102-111` does log with `repair`, but only for the revert-then-heal sub-case.

Fix: make `revertGateApproval` treat `res === null` as an abort and log with `repair`. Add a `reason` to the revert result. Check the `ok` result of the resync approve and of the reject-release. Log failures at ERROR with `repair` ("re-approve milestone" or "review milestone approval").

### M3: R7-M3's poison is permanent, silent after the first log, and has a one-line self-heal available

`events.ts:214` returns `null` for every later emit on a poisoned key.
- There is no per-skip log, no counter, and no un-poison path other than a process restart. The `poisoned` Set is never cleared.
- A 30s store hang (a PG failover) on a milestone, intent or leg stream permanently drops that entity's later events for the life of the process. That includes terminal audit rows such as `milestone.released` and `leg.completed`, plus the `milestone.revert_blocked` and `revert_*` events the repair flow relies on.
- The chain stays hash-valid but silently incomplete. No marker or gap event is written, so a chain verifier cannot see the omission.
- The first log line is the only evidence. At the end of a long outage the same operator can no longer tell which entities lost events.

The chain-fork risk is genuinely avoided (no appends are made on a poisoned stream), so "stream stops growing" is acceptable as a safe-fail. It is not acceptable as permanent.

Cheap fix: when poisoning, attach `pendingStale.finally(() => this.poisoned.delete(key))`. Once the hung store call actually settles, the stream tail is known and unpoisoning is safe, because the next emit re-reads `listByEntity`. Also:
- Log at WARN (rate-limited) on each skip, with `entityType`, `entityId` and `eventType`.
- Count skips so an operator can alarm on them.

Memory growth is not a real concern. The Set holds one short string per distinct entity that hangs twice, and entities are bounded by DB rows. It is still never pruned.

## Nits / Suggestions

1. **Head-of-line blocking remains global.** There is one shared `tail` for the whole emitter, and handlers `await buf.flush()` after commit. During a store-wide hang, every first emit on an entity costs 15s and every second emit on it costs up to another 15s. A request that flushes N events across distinct entities waits N×15s, and every other request queues behind it. R7-M3 bounded per-stream waits only. A global circuit breaker (for example "N consecutive timeouts → skip all emits for 60s") would finish the job.
2. **Cross-instance forks.** The emitter serializes per Database via the `WeakMap` ctx cache (`index.ts:96`), and the cache is verified to hold. Two server processes still have independent `tail`, `stale` and `poisoned` state, and nothing in the store enforces `(entityType, entityId, prevHash)` uniqueness. If the deployment is multi-instance, a DB-level unique constraint on `(entityType, entityId, prevHash)` is the only real fork guard.
3. **Dispute resolution emits no milestone events.** `resolve-apply.ts` emits only intent events. The `milestone.disputed` row written at freeze is never followed by `milestone.restored`/`cancelled`, and the new epoch re-stamp is not evented. The milestone stream ends at "disputed" while the row is APPROVED, READY or CANCELLED. This was already the case, but R7 widened the gap by adding an invisible state change.
4. **`approvalToken: milestone.escrowRef ?? ""`** (`milestone-force.ts:115`). The `""` sentinel for legacy APPROVED rows is fail-safe (no row has `escrowRef === ""`, so a pin with `""` never matches), but `undefined` would express "unknown" more honestly. The token also lives in a column named `escrowRef`. That is harmless today (no other reader in `src`), but the overload is worth a comment on the schema.
5. **R4-M5 residue.** A milestone that is DISPUTED while its READY submission is rejected is skipped by the reject sync, because neither READY nor APPROVED matches. After FOR_PROVIDER it comes back READY bound to a REJECTED submission. Bound submits need PENDING and auto-bind skips READY, so the milestone is stuck until `forceReopenMilestone`. This was already the case, but `forceReopenMilestone` is the only exit and nothing logs the stranded state.
6. **Test duplication.** `approvedIntent` is imported from `./helpers.js`, which was not supplied. Confirm it exists in the repo, because `route-helpers.ts` does not export it.

## Verified-good

- **R7-M1 trace (FOR_PROVIDER, prev=APPROVED).**
  - `dispute-service.ts:197-204` re-reads the milestone inside the atomic, CASes `m.status → DISPUTED`, and records `freeze.milestones[m.id] = m.status`. For an APPROVED milestone that is `"APPROVED"`. It is not overwritten later: `freeze` is persisted unchanged in `payload.freeze`.
  - `resolve-apply.ts:64`: `to = SPLIT ? "APPROVED" : prev`. For FOR_PROVIDER, `to = "APPROVED"`.
  - `resolve-apply.ts:68-70`: `to === "APPROVED"` stamps `escrowRef: appr_<uuid>`.
  - The restore is guarded by `m.status === "DISPUTED" && prev !== undefined`, and `DISPUTED→APPROVED` is a legal edge (`state-machines.ts:42`).
  - SPLIT is additionally gated on `freeze.milestones[m.id] === "APPROVED"` (`dispute-resolve.ts:83`), so SPLIT can never restore an APPROVED milestone that had no intent to re-leg.
  - A FOR_PROVIDER restore of a PENDING or READY milestone correctly applies no patch.
- **Revert token and intent pins** (`milestone-revert.ts:80-96`) are checked inside the atomic against the live row. Token mismatch, foreign intent and FROZEN/COMPLETED intent all return `reverted:false` with no writes.
- **Revert integrity.** The post-CAS leg re-list (`:160`) and the throw-to-abort on a lost milestone, intent or leg CAS all hold. A mark-paid that lands mid-revert aborts the whole atomic.
- **`revertGateApproval` extraction.**
  - It receives the live `ctx` and takes `stores` from it, which is the outer non-transaction stores, as before. The call sits in the `catch` and is awaited before the rethrow.
  - `gate.milestoneRowId` and `settleMilestoneId` are the same value: `submission-review.ts:323` assigns one from the other, and the heal and release paths consume the same row id.
  - The fail-closed behaviours are preserved: a failed re-read skips and logs, ACCEPTED skips, SUBMITTED reverts to READY, REJECTED and REVISION_REQUIRED release to PENDING.
- **Emitter queue liveness.**
  - The timers are always cleared (`finally` and `clearTimeout(staleTimer)`).
  - The hung `appending` promise is raced, so its later rejection is handled and cannot become an unhandled rejection.
  - The stale-wait race treats both fulfilment and rejection of the stale append as "settled", which is correct. A rejected append wrote no row.
  - Poisoning another stream does not affect the queue. `createSettlementCtx` caches one emitter per Database, so `stale`, `poisoned` and `tail` persist across bridge calls.
- **`approvalToken` type widening.** `approveMilestone`'s declared return carries `approvalToken: string`, and `doApprove` supplies it from `ApproveEffect`. The bridge's `value?: { intentId?; approvalToken? }` is optional-safe, and `review-settlement.ts` captures it only when `approvedByUs`.
- **`reopenMilestone` `expectedSubmissionRef`.** The compare-and-release is correct. It returns `ok(milestone)` for a foreign binding or a non-READY state. The `transitionMilestone` CAS covers the READY→PENDING race.
- **Reject/accept concurrency on one submission.** If REJECT commits first, the ACCEPT gate's `revertGateApproval` re-reads REJECTED and releases with intent and token pins. If ACCEPT commits first, REJECT fails the `status !== "SUBMITTED"` guard before post-commit runs.
- **R4-M5 reject release (READY branch).** The READY branch is compare-and-release by `expectedSubmissionRef`, so a newer READY binding survives.

## Round-7 status

- **R7-M1: FALSE-POSITIVE.** The Round-7 auditor misread the code. The re-stamp condition is `to === "APPROVED"` (`resolve-apply.ts:68`), `to = prev` for FOR_PROVIDER, and the freeze map records `"APPROVED"` (`dispute-service.ts:204`). The FOR_PROVIDER test is discriminating: without the re-stamp, the old token would still match and the stale revert would return `reverted:true`. See the test notes below.
- **R7-M2: PARTIAL.** The reject-release exists and the happy path is tested. It is unpinned, so it can cancel a resolver-restored or operator-forced approval (M1). Its result is also ignored (M2).
- **R7-M3: CONFIRMED-FIXED for the stated problem.** The stale wait is bounded and the shared queue cannot be held by one stale stream. The poison is permanent and silent (M3), and the global head-of-line blocking is unchanged (nit 1).
- **R7-M4: PARTIAL.** The `repair` key is a real signal on the paths that reach `logger.error`. The abort/`null` path, the reject-release result and the resync result are not covered (M2), and the signal is noisy for benign no-ops.

### Test coverage (R7)

- **FOR_PROVIDER restore** (`settlement-lifecycle-revert.test.ts:181`)
  - It proves the new token differs from the old one (`.not.toBe(token)`) and that a stale revert pinned with the old token and old `intentId` is refused (`reverted === false`). It also asserts the intent is still OPEN, so the revert refusal is covered.
  - It does not assert the milestone stays APPROVED after the refused revert, or that the legs are untouched.
  - A matching-token revert is not tested against the new token. The revert-succeeds case is covered only in the R6 test.
- **SPLIT restore** (`:217`) asserts only the new token's inequality. It does not attempt a stale revert, and does not check the split legs.
- **Emitter poison test** (`:248`)
  - It exercises the timeline only through an all-hang store, so the "other stream" assertion proves queue liveness only by not hanging.
  - It never asserts that a non-hanging other stream succeeds (the store hangs for every entity), that `append` is not called for p3, or that `logger.error` fires exactly once.
  - The stale-settles-in-time path is untested: the append lands late within 15s and the next emit proceeds without a fork. That is the path the fork guard exists for.
  - There is no test for un-poisoning, because there is no un-poison path (M3).
- **Reject-release test** (`commerce-settlement-r4.test.ts:347`)
  - It asserts the milestone is PENDING and the intent CANCELLED. It does not assert `submissionRef` and `escrowRef` are null or that legs are CANCELLED.
  - It has no negative cases: a paid leg, a FROZEN intent, a dispute-restored APPROVED with a fresh token (M1), or a force-approved milestone. Any one of these would have exposed M1.
- **`revertGateApproval` has no direct tests in the supplied files**, including the new extraction. None of these have a test:
  - a re-read failure
  - ACCEPTED skip
  - the heal success and heal-failure branches
  - the `res === null` abort path (M2)
  - `repair`-key logging (no logger spy anywhere)
  - the SUBMITTED, REJECTED and REVISION_REQUIRED branches

  The R4-H1 file's header mentions "a raced approve reverts", but no test in the supplied R4 file drives a failing verdict atomic.

---

## Remediation status (post-fix)

- **M1 (reject-release unpinned)** — FIXED. Epochs now carry provenance
  prefixes: `appr_` (commerce gate), `rsv_` (resolver restore),
  `ops_` (operator force-approve). `findMilestone` returns
  `submissionRef`/`escrowRef`; the reject-release fires ONLY for an
  `appr_` epoch still bound to the rejected submission, and the read
  epoch is pinned inside the revert atomic (TOCTOU-safe). Non-commerce
  epochs are skipped with an error-level `repair` log.
  Regression: `R8-M1: REJECT cannot undo a resolver-restored approval`
  (commerce-settlement-r4.test.ts).
- **M2 (silent aborts / overloaded false / unchecked results)** — FIXED.
  `RevertResult.reason` distinguishes not_approved / epoch_mismatch /
  intent_mismatch / intent_state / paid_leg. `res === null` aborts log
  error + `repair`. Dangerous reasons error, benign no-ops warn.
  Reject-release and ACCEPTED-resync results are checked and logged.
- **M3 (poison permanent)** — FIXED. Poison self-heals when the hung
  append settles (`pendingStale.then(unpoison)`); per-skip warn log
  with a counter (first 10 + every 100th); recovery logs warn with the
  skipped count. Regression: `R8-M3: the poison lifts once the hung
  append finally settles` (settlement-lifecycle-revert.test.ts).
- 235 tests green (18 files): `vitest run --run tests/settlement tests/commerce`.
