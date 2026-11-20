# Review Findings — Settlement R15 (EPIC-227)
## Scope
R14 remediation only: the `verdictLanded` post-check in `forceReleaseMilestone`, and the `submissionStatus` carry in `GuardVerdict` plus the `would_cancel_accepted_work` refusal in `forceReopenMilestone`. I also read the new tests. `forceApproveMilestone` was not supplied, so I judged it only from `approveMilestone`/`doApprove` and the route description.

## Verdict
**APPROVE WITH NITS.** Both R14 Mediums are closed.
- **R14-M1:** an acknowledged release that beats an ACCEPT now surfaces `verdictLanded` in the response, the audit evidence and an error-level log. The read happens after the revert commits, so it samples the right state.
- **R14-M2:** the stranded-READY entitlement is no longer destroyed by reopen. REJECTED, missing and foreign bindings still auto-cancel, so the exit is not over-locked on dead work.

No Critical, High or Medium findings. The items below are small hardening and signal-accuracy fixes. N1 is a one-line fix that I recommend taking in this round.

## Critical
None.

## High
None.

## Medium
None.

## Nits / Suggestions
1. **N1 — `submissionStatus` is scoped by `agreementId` only, but `inFlight` also requires `milestoneRef`.** This is the asymmetry you asked about in probe 2.
   - **Code:** `agreement-guard.ts` sets `submissionStatus` when `submission.agreementId === plan.agreementRef`. `inFlight` additionally requires `submission.milestoneRef === milestone.milestoneId`.
   - **Reachability:** `submitForReview` accepts any provider-supplied `submissionRef` after a length check only. The guard's own R12-H1 comments already treat foreign bindings as reachable.
   - **Effect:** a READY row under a COMPLETED agreement can be bound to another milestone's ACCEPTED submission from the same agreement. `forceReopen` then refuses with `would_cancel_accepted_work`, and it points the operator at force-approve to pay m2 on m1's work.
   - **Direction and impact:** this fails safe, since it refuses a destructive action. Money moves only on operator judgment, and a force-approve then force-release with `confirmCancel` is still a way out. Hence a nit, not a Medium.
   - **Fix:** apply the same ownership test (`agreementId` and `milestoneRef`) when setting `submissionStatus`. Legitimate bindings always satisfy both. Add a test with an ACCEPTED submission whose `milestoneRef` differs: reopen should auto-cancel.
2. **N2 — `verdictLanded` can be a false positive when the ack flag is passed but nothing was in flight.**
   - **Trigger:** the post-check runs whenever `acknowledgeInFlight === true` and a `submissionRef` is bound. The normal accepted state is `appr_` plus an ACCEPTED submission. An operator who passes `acknowledgeInFlight:true` on that deliberate un-accept gets `verdictLanded:true` and an error log claiming the verdict "landed after" the release.
   - **Why it's harmless:** the underlying fact (accepted work with no payable intent) is true, and nothing moves.
   - **Fix:** have the guard's `proceed` result carry whether the ack actually overrode an in-flight gate. Flag only on a pre-state of SUBMITTED and a post-state of ACCEPTED.
3. **N3 — foreign binding in the post-check (probe 1).**
   - The post-check reads whatever is bound. A foreign ACCEPTED submission (another agreement or milestone) flags `verdictLanded`, although it carries no entitlement for this milestone.
   - The fix for N2 covers this. If you prefer a separate fix, reuse the guard's ownership predicate.
   - Impact is operator-visible noise only.
4. **N4 — a failed post-read is a silent false negative.**
   - On a throw the code logs `warn`, and the response is identical to "no verdict landed".
   - For an ack-override release the operator specifically wants to know the check was not performed.
   - Suggest a `verdictCheck: "unverified"` field, or at least an `error` log.
5. **N5 — the documented residual needs rewording (probe 1 timing).**
   - The post-check is a single point-in-time sample after the revert commits. A verdict whose commit lands after that read is missed.
   - That window is roughly the verdict's remaining commit latency. The gate approves immediately before commit, so it is short, and the ACCEPTED row stays queryable afterwards. Acceptable as a documented residual.
   - The route text says "a verdict landing ACCEPTED afterwards reports `verdictLanded:true`". That overclaims. Reword to "a verdict observed ACCEPTED immediately after the release…".
6. **N6 — the repair hint on the post-check log is not directly actionable.**
   - **PENDING path:** the milestone is now PENDING and unbound. `approveMilestone` requires READY, and the supplied code gives no way to force-approve a PENDING row. The route does take a `submissionRef` in the force-approve body, but I could not confirm it binds from PENDING.
   - **Likely sequence:** the provider rebinds with `submitForReview`, then the operator force-approves.
   - **Cancel path:** the post-check also runs when the release lands CANCELLED. This is acceptable, and the signal is correct (it is the last chance to tell the operator they cancelled accepted work). But CANCELLED is terminal, so force-approve cannot apply.
   - **Fix:** make the `exit` text path-specific.
7. **N7 — release and reopen differ on overrides (probe 3).**
   - Uniform `confirmCancel` for release is the right call. APPROVED plus an OPEN intent already encodes "owed", and the operator opt-in is explicit.
   - Reopen has no override, only the force-approve then release-with-`confirmCancel` route. That is coherent but worth one line in the reopen route description.
   - The reopen route's 409 description and body text do not mention `would_cancel_accepted_work`.
   - Optional: put `submissionStatus` into the release `would_cancel_approved_payout` refusal details and into the audit evidence, so the operator sees ACCEPTED at decision time.
8. **N8 — `submissionStatus === "ACCEPTED"` is a string literal.** If commerce has later states that mean accepted-and-settled or accepted-then-superseded, those would auto-cancel. I could not verify the commerce enum from the supplied files. Confirm it, or import a shared constant.
9. **N9 — test gaps.** The new tests are non-vacuous but thin.
   - **Call counting:** the `verdictLanded` stub flips on call count. It is correct today, with one guard read and one post-check read, and it will stay valid unless the guard starts reading twice.
   - **Missing assertions and cases:**
     - audit evidence contains `verdictLanded`
     - milestone status is PENDING after release
     - negative case: the stub stays SUBMITTED, so `verdictLanded` is absent
     - negative case: no ack means no post-read
     - the post-read throws, so the release still returns ok
     - the cancel path with ack
     - reopen: the ACCEPTED refusal does not write an audit row
     - reopen: the REJECTED test asserts `cancelled` but not the CANCELLED row status
     - reopen: CANCELLED agreement plus ACCEPTED submission auto-cancels
     - reopen: missing submission row auto-cancels
     - the foreign or cross-milestone case from N1

## Verified-good
- **Post-check ordering (probe 1):** it runs after `revertApproval` returns `reverted:true`, so a verdict that committed in the guard-to-CAS window is caught. That was the actual R14-M1 gap, since the epoch pin does not re-stamp on ACCEPT. Release itself is correctly not rolled back.
- **Post-check failure mode:** a read error cannot undo or fail the release. It is non-fatal and logged. The only gap is N4.
- **Cancel path (probe 1):** running the check there is acceptable and correct, because cancelling accepted work is the worst outcome to miss.
- **Audit evidence:** `verdictLanded` is spread conditionally like `orphaned`, so the response and the audit row agree.
- **Reopen refusal (probe 2):** it fires before `reopenMilestone`, so nothing is mutated, and no audit row is written for a refusal. `milestone.status === "READY"` and the OPEN/FROZEN intent refusal run first, so the new branch is reached only for a genuinely stranded READY row.
- **`submissionStatus` handling:** a thrown submission read still fails closed (`PROVIDER_ERROR`) before it. A missing row yields `undefined`, which auto-cancels and is the documented dead-work case.
- **Terminal agreement order:** the R12 rule that `cancel` wins over a stale SUBMITTED row is unchanged, and reopen under a stale SUBMITTED row still cancels. A verdict cannot land under a terminal agreement, so nothing is stranded.
- **CANCELLED agreement:** it still auto-cancels even with an ACCEPTED submission. That is consistent with R13-M2, since nothing is owed under a torn-down agreement.
- **Force-approve exit (probe 2):** judged only from supplied code. `approveMilestone` requires READY and plan ACTIVE, and has no agreement check. The stranded-READY row satisfies both, because the plan stays ACTIVE under a COMPLETED agreement. This is the orphan scenario the guard exists for. So the pointed-at exit works for the READY, ACCEPTED, COMPLETED case, subject to the no-OPEN-dispute check the route documents. `forceApproveMilestone` itself is unseen.
- **Reopen state transition:** the only change is the extra refusal branch. `to` is still derived from `gate.kind`, and `expectedSubmissionRef` pinning is intact.
- **Reopen tests:** both branches exist and the ACCEPTED test asserts the row stays READY. The patch and restore helpers are balanced.

---

## Remediation status (2026-11-20, post-R15 nits batch)

**CONVERGED — APPROVE WITH NITS, 0C/0H/0M.** Nits folded in one batch
(per convergence bar: no confirmation round needed for nits):

- **N1 — FIXED.** `submissionStatus` now uses the same ownership
  predicate as `inFlight` (agreementId AND milestoneRef) — a foreign
  ACCEPTED row no longer over-refuses reopen. Regression test added.
- **N2 — FIXED.** Guard `proceed` carries `ackOverrode` (true only
  when the ack flag actually overrode a live gate = pre-state
  SUBMITTED). The post-check keys on it — a bound ACCEPTED row with
  no gate (deliberate un-accept) no longer flags. This also fixes
  N3 (ackOverrode is only set for owned submissions).
- **N3 — FIXED by N2.**
- **N4 — FIXED.** Failed post-check re-read now logs at error level
  ("verdict state unverified"), not warn.
- **N5 — FIXED.** Route description reworded to "a verdict observed
  ACCEPTED immediately after the release" + documented residual.
- **N6 — FIXED.** Exit text is now path-specific (post-check only
  runs on the PENDING path → rebind + force-approve).
- **N7 — FIXED.** Reopen 409 description names
  `would_cancel_accepted_work` and the force-approve→release route.
- **N8 — VERIFIED.** Commerce `SubmissionStatus` has exactly four
  states; ACCEPTED is the only terminal-accepted state. Literal is
  correct.
- **N9 — DONE (subset).** Added: evidence assertion
  (verdictLanded in AdminAction), milestone-status assertions,
  N2 negative case (call-count + absent flag), N4 failure case,
  N1 foreign-milestone case, CANCELLED row-status assertion.
  Reopen spec split into settlement-reopen-guard.test.ts under
  the token cap.

Result: 278 tests green (21 files), typecheck + lint clean.
