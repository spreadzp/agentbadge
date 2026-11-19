# Review Findings — a2a-settlement R7 (EPIC-227)

## Scope

Round-7 adversarial re-verification of the Round-6 fixes, plus new probing of the changed code. All paths are under `context/hackathon/server/`.

- **Settlement services:** `milestone-approve.ts`, `milestone-revert.ts`, `milestone-force.ts`, `milestone-service.ts`, `resolve-apply.ts`, `dispute-service.ts`, `dispute-resolve.ts`, `rollup.ts`, `payout-service.ts`, `events.ts`, `state-machines.ts`, `index.ts`.
- **Commerce layer:** `submission-review.ts`, `review-settlement.ts`, `review-postcommit.ts`, `settlement-bridge.ts`.
- **Routes and guards:** `settlement-admin-milestones.ts`, `finops/guards.ts`, `finops/admin-actions.ts`.
- **Tests:** `settlement-lifecycle-revert.test.ts`, `settlement-lifecycle-force.test.ts`, `commerce-settlement-r4.test.ts`.

Not verifiable from the supplied files:
- The Postgres store implementations. This covers `applyStatus` patch semantics, any uniqueness constraints on legs, and row-lock ordering. The specs use the memory bundle only.
- The value of `EVIDENCE_MAX_BYTES`. I assumed 4096, as the code comments state.

I computed the M3 byte budget with a script, using `JSON.stringify(...).length` exactly as `checkEvidence` does. Results are in Verified-good.

## Verdict

**REQUEST CHANGES** (narrow: 0 Critical, 0 High, 4 Medium).

The Round-6 fixes mostly land:
- M1, M3, M6 and nits 1-6 and 9 are real.
- The approval-epoch pin works for the paths it covers.
- Reopened intents no longer revive legs.

Four residual problems remain, and two of them sit in the new code:
1. The approval-epoch stamp misses the `FOR_PROVIDER` restore.
2. The fail-closed "skip revert" branch creates a payable-but-rejected state that nothing ever clears.
3. The emitter's stale wait is unbounded and sits inside the process-wide queue.
4. The revert/heal failure paths are nearly invisible.

None of these needs an adversary beyond the buyer racing themselves or an operator acting inside a narrow window. All four have small, local fixes.

## Critical

None.

## High

None.

## Medium

**R7-M1: Approval-epoch token is not re-stamped on a `FOR_PROVIDER` restore to APPROVED, so a stale gate revert still matches.**

**Status: DISPUTED — false positive, proven by test.** The stamp condition is `to === "APPROVED"`; for `FOR_PROVIDER`, `to = prev`, and `prev === "APPROVED"` (the disputed milestone was APPROVED at freeze) → `to === "APPROVED"` → stamped. The audit's own step 2-3 acknowledges `prev` is APPROVED, then incorrectly claims the `undefined`-patch branch fires. Regression tests now lock the behavior: 'FOR_PROVIDER restore re-stamps the epoch — stale revert refused' (fresh `appr_*` token, stale-token revert returns `reverted:false`, intent stays OPEN) and 'SPLIT restore re-stamps the epoch too' (`settlement-lifecycle-revert.test.ts`).
- `resolve-apply.ts` (restore branch) stamps `appr_<uuid>` only when `to === "APPROVED"`.
- `to` is `"APPROVED"` for `SPLIT`. For `FOR_PROVIDER`, `to = prev`, and `prev` is `"APPROVED"` whenever the dispute froze an APPROVED milestone.
- That case falls into the `undefined`-patch branch. It restores APPROVED carrying the ORIGINAL gate token `T`. Freezing never clears `escrowRef`.
- Interleaving:
  1. Gate G approves and gets token `T`.
  2. A dispute freezes the milestone, and the operator resolves it `FOR_PROVIDER`. The milestone returns to APPROVED with `T`, and the intent is OPEN again.
  3. G's verdict atomic then fails slowly, for example on a store timeout. G's revert passes `approvalToken: T`, which matches, so it cancels the intent and legs the resolver just restored.
- The window is wide: the revert runs after the atomic's failure, which can be seconds to minutes later.
- The code comment says "a dispute-restore re-stamps the token". Only `SPLIT` does.
- Fix: re-stamp whenever the target status is APPROVED, regardless of resolution.
- Add a test: gate approve, raise dispute, resolve `FOR_PROVIDER`, stale-token revert must return `reverted:false`.

**R7-M2: The fail-closed "skip revert" branch leaves a live authorization that a later REJECT never releases.**

**Status: REMEDIATED** — the reject release is no longer READY-only: `postCommitSettlementSync` now calls `revertApproval(..., release:true)` when the bound milestone reads APPROVED — APPROVED→PENDING + OPEN intent cancelled in the same atomic. Regression: 'REJECT on an APPROVED milestone releases the intent too' (`commerce-settlement-r4.test.ts`).
- `submission-review.ts` (catch, `!sub` branch): when the re-read fails, the revert is skipped and the milestone stays APPROVED with an OPEN intent. The comment says this is the documented resume state because "a retried review completes it".
- That assumes the buyer retries with ACCEPT. If the buyer instead REJECTS the submission, `postCommitSettlementSync` only releases a milestone that reads `READY`.
- The result is APPROVED + OPEN intent + REJECTED submission:
  - The operator console shows a payable intent for rejected work.
  - The provider cannot resubmit. `submitForReview` needs PENDING, and the submit-heal only fires on PENDING.
  - A later submission bound to the same ref finds APPROVED and treats it as a resume state with `approvedByUs=false`, so it inherits the stale approval.
- Nothing sweeps this state.
- The trade is acceptable for the ACCEPT retry but unsafe for REJECT/REVISION. It requires a store read failure that coincides with a failed verdict commit.
- Fix, either of:
  - On a committed REJECT/REVISION, if the bound milestone is APPROVED with an OPEN, unpaid intent, call `revertApproval({release:true})`. It already refuses on a paid leg.
  - Give the operator console a "stranded APPROVED + non-ACCEPTED submission" exception row.

**R7-M3: The stale-poison wait is unbounded and runs inside the shared queue, so one hung append blocks every emit in the process.**

**Status: REMEDIATED** — the stale-append wait is now bounded by the same 15s window; on timeout the entity stream is permanently `poisoned` (emits return null immediately + one error log at poison time), so a hung store call can never stall the shared emit queue again. Regression: 'a hung append poisons the stream after one grace window' with fake timers.
- `events.ts`, `emit()` (lines 83-88): `await pendingStale.catch(...)` runs inside `this.tail.then(...)`, and `this.tail = run`.
- If the timed-out store call never settles (a hung socket with no driver-level timeout, which is the exact scenario the timeout was added for), then:
  - the next emit on that entity never completes;
  - every later emit on any entity queues behind it forever;
  - callers awaiting `buf.flush()` hang AFTER their atomic committed. Approve, revert, mark-paid and resolve all return no response although state changed.
- This undoes the R5 timeout guarantee. The stale wait needs its own bound, for example 15s again.
- On expiry, choose a policy: emit with a fresh `listByEntity` and log the fork risk, or drop the event and log at error level.
- The task description names this as "head-of-line per entity". It is worse: it is global, because the wait sits on the single `tail` chain.
- Minor: `stale` entries are only deleted by a later emit on the same stream, so streams that time out and never emit again hold their promise forever.

**R7-M4: A failed revert or a failed heal is nearly invisible, so the ACCEPTED + READY + CANCELLED residual has no operator signal.**

**Status: REMEDIATED** — every refused/aborted/ambiguous revert path and the heal-failure path now log at error level with a stable `repair` key (`review milestone approval` / `re-approve milestone`) so operators can alert on it; heal success stays warn.
- Bridge `revertApproval` returns `res.ok ? res.value : null`.
- The nit-1 and nit-2 aborts (leg paid during revert, intent CAS lost) surface as `fail(...)`, so the bridge returns `null`. They are logged only by `settled()` at `warn`.
- The review catch does `if (res && !res.reverted)`, so `null` produces no error log.
- The state left behind in that case is the dangerous one: APPROVED with a paid leg, or a moving intent.
- The reconciler heal is `approveMilestone(...).catch(() => null)`:
  - A thrown error is completely silent.
  - An `{ok:false}` result gets a `warn` from `settled()`.
- If the heal fails, the committed ACCEPTED verdict sits on a READY milestone with a CANCELLED intent. If the sibling's post-commit resync already ran before the revert, nothing retries. The agreement may be COMPLETED with the provider unpaid.
- Recovery exists (force-approve reopens via `doApprove`), but nothing tells an operator to use it.
- Fix:
  - Log `null` and heal failures at error level with the milestone and submission ids.
  - Raise `milestone.revert_blocked` or a similar event for the abort paths.

## Nits / Suggestions

1. **Stale `createdAtMs` on a reopened intent.** `doApprove` reopens the existing intent row without refreshing `createdAtMs`. `markLegPaid` passes `notBeforeMs: intent.createdAtMs` to the tx verifier. A payment made in the revoked window between the first approval and the reopen still satisfies "not before" for the fresh legs. Refresh the timestamp on reopen, or set `notBeforeMs` to the leg's creation time.
2. **No guard against a FROZEN leg under a reopened or OPEN intent.**
   - Not reachable today. The plan-level ACTIVE→DISPUTED CAS allows one OPEN dispute per plan, and only that dispute's `frozenLegIds` are restored.
   - Both `doApprove`'s reopen check and `revertApproval` only reason about COMPLETED/FAILED and OPEN legs.
   - A stray FROZEN leg would count as payable in `rollupIntent` and wedge the intent forever.
   - Cheap defense: on reopen, require every old leg to be CANCELLED (or cancel FROZEN ones), and fail CONFLICT otherwise.
3. **Gate token is optional and the pin fails open.** `revertApproval` skips the pin when `approvalToken === undefined`. The gate should fail closed: if `approvedByUs` and `approvalToken` is missing (a bridge stub, a refactor), skip the revert and log rather than revert unpinned.
4. **`escrowRef` is overloaded.** It currently has no other reader or writer. A future escrow integration that uses the same column name will be clobbered by `doApprove` and nulled by revert. A dedicated `approvalEpoch` column or payload key would be safer.
5. **`approvalToken` leaks to the admin and buyer-facing JSON.** `respond()` spreads the effect value. It is harmless today, because revert is not a route, but it is unnecessary surface.
6. **Lock ordering between revert and mark-paid.** Revert locks milestone, then intent, then legs. `markLegPaid` locks leg, then intent, then milestone, and takes an in-process `withLock` that revert does not. Under Postgres a deadlock is possible. One side aborts with a driver error, which is not a `SettlementConflictError`, so it surfaces as a 500 or a "revert failed" log. State stays consistent, but consider taking the same per-intent lock in revert.
7. **`checkSerialized` counts UTF-16 code units, not bytes.** `EVIDENCE_MAX_BYTES` is measured the same way, so the guards are mutually consistent. If a downstream store enforces real UTF-8 bytes, 2000 CJK characters is about 6 KB. Rename to `…Units`, or measure with `TextEncoder`.
8. **`reopenBody` is not `.strict()`.** An extra `submissionRef` is silently dropped rather than rejected.
9. **Whitespace-only `submissionRef` passes `checkForceInput`.** It also has no `typeof` check in the core. A `null` from a non-TS caller would pass `JSON.stringify` and then throw in the degraded-payload spread.
10. **APPROVED siblings count as "accepted" in `pendingMilestoneCount`.** That is by design (D-227-4/R2-H4). But a gate-approved sibling whose verdict has not committed counts as done. In a two-submission, same-buyer race, the agreement can COMPLETE and the other milestone's revert then strands it READY on a closed agreement. It is buyer-self-inflicted and low impact. Worth a comment.
11. **Revert's `release:true` path has no `expectedSubmissionRef` pin.** Nit 9 only applied it to `reopenMilestone`. It is safe today because APPROVED blocks rebinding, but the two paths are asymmetric.
12. **`forceApproveMilestone`'s idempotent branch returns `approvalToken: ""` for a pre-R6 APPROVED row (null `escrowRef`).** Harmless, but a `string | undefined` type would be more honest.
13. **Emit timeouts stack.** Four events at 15s each is 60s of post-commit latency under a store outage. This is pre-existing. With more than one process the hash chain can still fork, because there is no DB uniqueness on `(entityType, entityId, prevHash)`.

### Test-coverage gaps

New specs that exist and pass their intent:
- Stale token refused, matching token reverts and clears the epoch.
- FROZEN intent is refused.
- Reason, submissionRef and zero-width input are bounded.
- Force-reopen is refused when an OPEN intent exists.
- Compare-and-release in `reopenMilestone`.
- Re-approval mints fresh legs.
- A RELEASED milestone lets the verdict commit.

Missing assertions and edges:
- **The "stale token" test** asserts only the milestone status. It does not assert that the intent is still OPEN and its legs untouched, nor that the matching-token revert cancels the intent and legs.
- **No test for the SPLIT epoch re-stamp,** nor for the `FOR_PROVIDER` gap in R7-M1.
- **The M1 "never revives legs" test** uses a hand-inserted CANCELLED residue leg. There is no end-to-end flow: freeze, SPLIT, revert (without a token), re-approve.
- **No review-catch tests at all** for these paths:
  - re-read failure skips the revert;
  - the sibling-ACCEPT branch;
  - the `reverted:false` error log;
  - the reconciler heal;
  - the bridge returning `{reverted}`.
  The R4 commerce spec has no `approvalToken` usage.
- **No test that a failed heal is observable.**
- **No nit-1/nit-2 tests.** Both need a store hook that completes a leg or moves the intent mid-revert.
- **No revert test for a COMPLETED intent,** only FROZEN.
- **The R6-M3 force spec** only tests rejection above the cap. There is no boundary test, with `reason` of exactly 2000 serialized units plus 128-char ids and max `submissionRef`, asserting `auditRecorded` is true and the evidence is not `degraded`. Nothing checks that the cap actually keeps the full evidence under 4 KB.
- **The R6-M6 spec** uses a single-milestone plan and forces the status with raw store writes (no intent, no COMPLETED leg). It does not cover a multi-milestone plan, where another PENDING milestone must keep the agreement ACTIVE. It does not assert that no approve is attempted and no intent is minted.
- **No emitter tests:** timeout poisoning, stale ordering, the late-failing stale append, the unbounded wait.

## Verified-good

1. **R6-M1.** Reopen only flips the intent CANCELLED→OPEN and mints fresh legs from `payload.payoutTemplate`.
   - The default leg is `milestone.amountUsd`.
   - `checkLegTemplate` at plan create and at SPLIT both enforce `sum == milestone amount`, so template sums can't diverge from `amountUsd`.
   - Old legs stay CANCELLED, and `rollupIntent` ignores CANCELLED legs, so the payable set is only the fresh legs.
   - Any COMPLETED/FAILED old leg fails CONFLICT before the milestone CAS.
   - A lost intent CAS and a leg insert conflict both throw, so the atomic rolls back.
2. **No non-OPEN, non-CANCELLED leg under an OPEN intent is reachable today.**
   - A CANCELLED intent comes only from revert (OPEN legs are cancelled) or FOR_BUYER (the milestone is CANCELLED and terminal, so re-approve is impossible).
   - The plan CAS limits it to one dispute per plan.
   - A SPLIT followed by a no-token revert replaces the SPLIT legs with the original template. That is semantically a lost ruling, but it is blocked from the gate by the token.
3. **Epoch stamp coverage.** The only writers of APPROVED are `doApprove` (READY→APPROVED, stamped) and `resolve-apply` (DISPUTED→APPROVED).
   - The SPLIT restore is stamped.
   - `FOR_PROVIDER` is not stamped (R7-M1).
   - Rollup writes RELEASED only.
   - `transitionMilestone` is not used for APPROVED.
   - Nothing reads `escrowRef` except the revert pin and force-approve's idempotent return.
   - A pre-R6 APPROVED row with null `escrowRef` can never be a gate's own approval, so failing the pin for it is acceptable.
4. **R6-M2 (1), the re-read.** `.catch(() => null)` maps failure to skip, and the log is at error level.
5. **R6-M2 (3), the heal's concurrency.** Reopen reuses the unique per-milestone intent row, so the heal cannot mint a second intent.
   - It races the post-commit resync only through the READY→APPROVED CAS, which has a single winner; the loser returns INVALID_STATE with no writes.
   - A REJECT/REVISION re-read stays terminal, so the heal never fires after a release-to-PENDING.
6. **R6-M3 budget, computed with `JSON.stringify(...).length`.**
   - Full force-approve evidence with a 2000-unit reason, 256-unit `submissionRef` and 128-char ids is 3110, under 4096.
   - Adversarial control-char ids (128 raw characters each for `milestoneId`, `agreementRef`, `boundSubmissionRef`) reach 5030. That overflows to the degraded payload, which is 3241 at worst. The degraded row still carries both refs, the reason prefix and the SHA-256, so the audit row is never lost.
   - Force-reopen evidence is 2483 plain and 3763 worst-case.
7. **R6-M4 emitter.**
   - The stale promise is deleted before it is awaited, so there is no retry storm.
   - A late failure is caught and the next emit proceeds with a fresh `listByEntity`.
   - A late success is awaited before re-reading `prevHash`, so the chain does not fork in-process.
   - `clearTimeout` always runs, and failures log at error level.
   - Contexts are cached per `Database`, so the queue and `stale` map are genuinely shared across the bridge and routes.
8. **R6-M5.** `{reverted}` crosses the bridge and the catch logs when `reverted === false`. `revertApproval` logs error on `paid_leg_present` and on a FROZEN/COMPLETED intent. See R7-M4 for the null path.
9. **R6-M6.** `RELEASED` is accepted in both the initial and the recheck status sets, and a RELEASED milestone produces `approvedByUs=false`, so the catch never reverts it.
   - `pendingCount` excludes only the row itself plus RELEASED/CANCELLED/APPROVED, so other PENDING/READY/DISPUTED milestones keep a multi-milestone agreement ACTIVE.
   - Counting other APPROVED siblings as accepted is the pre-existing D-227-4 design.
10. **Nit 1, post-CAS re-list.** A paid leg is already guarded by the leg CAS row lock, because OPEN→CANCELLED returns null on a COMPLETED leg and throws. The re-list also covers FAILED.
11. **Nit 3.** Revert refuses a FROZEN/COMPLETED intent (tested for FROZEN).
12. **Nit 4.** `forceReopenMilestone` refuses an OPEN/FROZEN intent. The check-then-CAS is safe because READY→PENDING and READY→APPROVED are mutually exclusive CASes.
13. **Nits 5, 6, 8 and 9.** Reason must contain a letter or digit, `submissionRef` is bounded in the core, `reopenBody` is a dedicated schema, and `reopenMilestone` is compare-and-release.
14. **Routes.** The route caps (`reason.max(2000)`, `submissionRef.max(128)`) are looser than or equal to the core bound, and the core is authoritative.

## Round-6 status

- **R6-M1: CONFIRMED-FIXED.** `doApprove` reopens only the intent row, mints fresh template legs, and fails CONFLICT on any COMPLETED/FAILED old leg. Nits 1 and 2 above (stale `createdAtMs`, no FROZEN-leg guard) are not blockers.
- **R6-M2: PARTIAL.**
  - (1) Re-read failure skips the revert: implemented, but see R7-M2.
  - (2) Epoch pin: `doApprove` and the SPLIT restore stamp the token, but the `FOR_PROVIDER` restore to APPROVED does not (R7-M1).
  - (3) Reconciler heal: logic is sound and race-safe, but a failure is silent (R7-M4).
- **R6-M3: CONFIRMED-FIXED.** The reason is capped at 2000 serialized units. `submissionRef` is bounded in the core. Both refs are in the degraded payload. Worst-case evidence stays under 4096, or degrades safely.
- **R6-M4: PARTIAL.** Chain-fork poisoning, the error log and the timer clear are all correct. The new stale wait is unbounded and global (R7-M3).
- **R6-M5: CONFIRMED-FIXED.** `{reverted}` crosses the bridge, the catch logs, and the revert logs the refusals. The remaining gap is the abort (`null`) path, tracked in R7-M4.
- **R6-M6: CONFIRMED-FIXED.** RELEASED is an accepted resume state in both checks, and no approve or revert is attempted for it. Test coverage is thin (see gaps).
- **Nits 1-6 and 9: CONFIRMED-FIXED.**
- **Nit 8: CONFIRMED-FIXED** (schema is not `.strict()`, see nit 8 above).
- **Nits 7 and 10-16:** acknowledged and not fixed, per the task description. Not re-audited.

### Round-7 dispositions on test-coverage gaps

- SPLIT + FOR_PROVIDER epoch re-stamps: covered (`settlement-lifecycle-revert.test.ts` R7 block).
- R6-M1 end-to-end (freeze → SPLIT → revert → re-approve): covered at unit level by the residue-leg test + the new restore tests; a full e2e variant remains a nit.
- R6-M3 boundary test (2000-byte reason + max ids → non-degraded evidence): not added — the budget was independently verified by the auditor's own computation (3110 of 4096 worst case; degraded payload still carries both refs).
- Postgres parity: patch semantics verified in `packages/database/src/repositories/settlement-repository.ts` (escrowRef patch applies when `!== undefined`; `null` clears) — matches the in-memory store.
