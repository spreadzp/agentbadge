# Review Findings — Settlement R14 (EPIC-227)
## Scope
R13 remediation (6b577048) on the supplied files only: `reopenMilestone` `{row, transitioned}`, `forceReleaseMilestone` confirmCancel / acknowledgeInFlight, `agreement-guard.ts`, the `/release` and `/reopen` schemas, `milestone-revert.ts` and `review-revert.ts` classifier interaction, and `settlement-release-guard.test.ts`. Not in the supplied set, so not reviewed: `forceApproveMilestone`, the dis…
## Verdict
**REQUEST CHANGES** (0C / 0H / 2M, small and local fixes). The three R13 fixes work as described. `transitioned` is honest, the COMPLETED gate holds for APPROVED rows, and acknowledgeInFlight skips only the in-flight refusal. Two gaps remain. The reopen path still has the irreversible-cancel hazard R13-M2 closed for release. The epoch pin does not protect against the one verdict outcome that matte…
## Critical
None.
## High
None.
## Medium
**M1. `acknowledgeInFlight` is not backstopped by the epoch pin for an ACCEPT verdict.**
- The brief and the code comments say the pin "still refuses a verdict that actually lands (epoch_mismatch)".
- `revertApproval` only compares `milestone.escrowRef` with `approvalToken` (`milestone-revert.ts:125-130`). `milestone-release.ts:239` pins the pre-read epoch.
- An in-flight verdict that lands as ACCEPT does not re-stamp the milestone. It stays APPROVED with the same `appr_` epoch. Only a re-approval or a resolver restore changes the epoch.
- So with `acknowledgeInFlight:true`, the release/cancel commits, the intent is CANCELLED, and the row goes to PENDING or CANCELLED.
- If the buyer's ACCEPT then commits, the submission is ACCEPTED with no payable intent and a PENDING/CANCELLED milestone.
- `revertGateApproval`'s heal path (`review-revert.ts:408-431`) only runs after a revert that path itself performed. `approveMilestone` needs READY (`milestone-service.ts:472`), so a PENDING row would not heal either.
- Nothing post-checks this the way the `orphaned` re-read does for agreement closure (`milestone-release.ts:261-289`).
- The override is opt-in and audited, so this is Medium rather than High. The flag is also recorded even when no gate was in flight.
- Fix, either of:
  - After a landed ack-release, re-read the bound submission. If it is ACCEPTED, set `verdictLanded:true` in the response and evidence, and log a `repair` error. This mirrors the `orphaned` pattern.
  - Have the guard return `{kind:"proceed", overrode:true}` only when the ack actually bypassed a refusal, and record the submission status and age in evidence.
- Also correct the "epoch pin refuses a landed verdict" claim wherever it is written.

**M2. `forceReopenMilestone` cancels a READY row under a COMPLETED agreement with no `confirmCancel`, which is the same irreversible-loss class as R13-M2.**
- `milestone-reopen.ts:404-408` sends any terminal agreement to CANCELLED, and the `/reopen` schema (`reopenBody`) has no confirm flag.
- The code comment says "under a closed agreement READY can never be paid". The R3-H3 stranded-READY scenario contradicts this. The commerce verdict commits ACCEPT, the agreement completes, and the post-commit settlement approve misses. The result is a READY row with an ACCEPTED submission and a COMPLETED agreement.
- `approveMilestone`, the entry point of the documented force-approve recovery, checks `plan.status` and the READY status. It does not check agreement status (`milestone-service.ts:472-483`). So force-approve can recover that row, but only while it is READY. CANCELLED is terminal, so a reopen under COMPLETED destroys the owed payout.
- Answer to your question 2: the READY row cannot have a payable *intent*, because `milestone-reopen.ts:392` refuses OPEN/FROZEN and a CANCELLED intent is inert. It can have a payable *entitlement* with no intent yet.
- Confidence note: `forceApproveMilestone` was not supplied, so I could not rule out its own agreement guard. Please confirm it does not refuse under a closed agreement. If it does refuse, this drops to a Nit.
- Fix, either of:
  - Add `confirmCancel` to `reopenBody` and gate COMPLETED the same way as release, with a message pointing at force-approve.
  - Cheaper: when the guard says COMPLETED and the bound submission is ACCEPTED, refuse with `details.reason: "would_cancel_accepted_work"` and point to force-approve. The guard already reads the submission.

## Nits / Suggestions
1. **Intent-detail read can throw (`milestone-release.ts:218-220`).** `getByMilestone` runs outside any try/catch, only to decorate the message. A throw escapes as an unhandled exception (500) instead of the 409. It is fail-closed because nothing mutates, but it breaks the guard's own `PROVIDER_ERROR` convention. Wrap it and omit `intentId` on failure.
2. **Misleading message when no intent exists or it is already CANCELLED.** The text says "would irreversibly cancel the approved payout intent" with no id, and no test covers it. Add `intentStatus` to `details`, and say "no intent found" for the missing case. Requiring confirm there is still the right conservative choice.
3. **Audit evidence records requested flags, not effective ones (`milestone-release.ts:304-307`).** `confirmCancel:true` is logged on a live agreement and `acknowledgeInFlight:true` is logged when nothing was in flight. A reviewer reading the audit row would believe an override happened. See the M1 `overrode` suggestion.
4. **CAS-loss in `forceReopen` is a 409, not idempotent.** `transitionMilestone` returns `fail("INVALID_STATE", "moved concurrently")`, and `forceReopen` returns `res` as-is. This contradicts the route text "Idempotent on non-READY (reopened:false)". It is safe. Either map that failure to `{reopened:false}` or change the doc.
5. **`transitioned` is correct but CAS is status-only.**
   - `applyStatus(id, from, to, patch)` has no `submissionRef` predicate. A READY→PENDING→READY(Y) ABA between `reopenMilestone`'s re-read and the CAS defeats the R12-M2 `expectedSubmissionRef` pin and unbinds Y.
   - The audit evidence then names the pre-read ref X. The window is tiny and I could not see the store, so this is unproven.
   - If the store allows it, add `submissionRef` to the CAS predicate. Otherwise record the post-CAS facts.
6. **No `orphaned` post-check on reopen.** Release re-reads the agreement after landing PENDING (R11-M2). Reopen to PENDING does not, so an agreement that closes in the gap goes unreported. This is a pre-existing asymmetry.
7. **If `ctx.emit.emit` throws after the CAS (`milestone-service.ts:333`),** the transition has landed but the call errors, with no `transitioned` result and no audit row. I did not see `emit`, so this is unverified. Please confirm it swallows or buffers.
8. **`/reopen` can still gate-lock if a resolver-restored READY row keeps an `appr_` epoch.** The "READY rows carry no epoch" claim holds for `submitForReview` and `revertApproval` (which nulls `escrowRef`). It was not verified for the DISPUTED→READY restore, which was not supplied. If that restore keeps `appr_`, reopen could return `gate_in_flight` with no ack path.
9. **Doc drift in the route (`settlement-admin-milestones.ts`).**
   - The 200 description says "released to PENDING", but CANCELLED is possible.
   - The 409 description still says "agreement not ACTIVE".
   - The header comment lists `/release {operator, reason}` without the two flags.
10. **Typing.** `would_cancel_approved_payout`, `gate_in_flight` and `conflict` are ad-hoc strings. A shared `ReleaseRefusalReason` union would make the contract typed. See Verified-good 5.
11. **Other callers of `reopenMilestone`.** The return shape changed from `MilestoneRow` to `{row, transitioned}`. The commerce bridge and any other consumers were not supplied, so a repo-wide grep or typecheck is needed to confirm none still read `.status` off the result.

### Test coverage (your question 5)
- **Target-status race (R13-M1):** non-vacuous. The second read returns `status:"PENDING"`, which exits at `milestone-service.ts:410`. The old status-equality check would have faked a transition, so this test would have failed on it. It does not exercise:
  - the `expectedSubmissionRef` mismatch branch (`:416-421`);
  - a real CAS loss (`applyStatus` returning null), which returns a 409.
- **confirmCancel both ways:** covered, with refusal and success. Gaps:
  - the refusal test never asserts the intent is still OPEN or that no audit row was written;
  - there is no no-intent case and no intent-read-throws case;
  - there is no `confirmCancel` check on a live or CANCELLED agreement.
- **CANCELLED auto-cancel:** covered. The test does not assert the intent is CANCELLED or that the audit row exists.
- **acknowledgeInFlight:** the lock-then-unlock test is non-vacuous. It does not cover:
  - ack plus a terminal agreement, which would prove cancel precedence under ack;
  - ack with an epoch moved on, which would pin the `epoch_mismatch` claim (see M1);
  - any assertion that `acknowledgeInFlight` or `confirmCancel` land in `adminActions` evidence. This is an explicit R13 claim with no test.
- **Route layer:** no test for `releaseBody` plumbing, for example a string `"true"` returning 400, or flags reaching the service.
- **Reopen under CANCELLED agreement:** untested. Only COMPLETED is.
- **Hygiene:** `store.getById = orig` is restored after the awaits and not in `finally`. This is harmless because each test gets a fresh db.

## Verified-good
1. **`{row, transitioned}` is honest in `forceReopen`.** `transitioned:true` is returned only after `transitionMilestone`'s CAS succeeds (`milestone-service.ts:424-432`). Non-READY and binding-mismatch rows return `false`. `forceReopen` mints the audit row and `reopened:true` only on `true` (`milestone-reopen.ts:420`), and the returned `row` is the CAS result and is not used for the decision. Call…
2. **The COMPLETED gate cannot be bypassed on the release path.**
   - `COMPLETED` without `confirmCancel` returns before `revertApproval`, so nothing mutates.
   - `CANCELLED` agreements auto-cancel.
   - A FROZEN or COMPLETED intent still refuses inside the atomic (`intent_state`), even with `confirmCancel`.
   - A paid leg still refuses (`paid_leg`).
   - The intent read is not trusted for anything but the message.
3. **`acknowledgeInFlight` skips only the in-flight refusal** (`agreement-guard.ts:126`).
   - Cancel precedence (`:118`) sits before it, so a terminal agreement still wins.
   - Submission and agreement read failures still fail closed (`PROVIDER_ERROR`) under ack.
   - The ack cannot defeat R12-H1 ownership scoping. `inFlight` is computed only for an owned binding with an `appr_` epoch, and the ack can only turn that single refusal off. Foreign or `ops_`/`rsv_` rows were never refused.
   - The request-body flag is a strict `boolean` and cannot be spoofed through coercion.
4. **Epoch pin and reason plumbing.** `approvalToken` still pins the pre-read epoch, and `eventReason` / `cancel` wiring is consistent. The unpinned case (an epoch that changes after a re-approval) is handled, and refusals map to `details.reason`.
5. **`would_cancel_approved_payout` cannot misfire a fail-closed classifier.**
   - It is returned by `forceReleaseMilestone` as a `SettlementResult` failure, before `revertApproval`, and never as a `RevertResult.reason`.
   - `logRevertOutcome`, `BENIGN_REVERT_REASONS` and `BridgeRevertResult` (`review-revert.ts`) consume only `revertApproval` outcomes, and those are the only callers on the verdict path.
   - `gate_in_flight` (R12) and `conflict` already sit outside the union under the same arrangement.
   - The union's other members are unchanged, so the fail-closed default for a new `RevertReason` still holds.
6. **Schemas.** `releaseBody` extends `reopenBody` and strips unknown keys. `/reopen` does not accept the new flags. The route passes only validated fields.
7. **R13-M1 regression test is meaningful.** It would fail against the pre-fix status-equality implementation.

---

## Remediation status (2026-11-20, post-R14)

- **R14-M1 (ack-release blind to a landing ACCEPT) — FIXED.**
  acknowledgeInFlight releases now re-read the bound submission; an
  ACCEPTED row reports `verdictLanded:true` in the response AND the
  audit evidence plus an error-level `repair` log (mirrors the
  `orphaned` pattern). The misleading "epoch pin backstops a landed
  verdict" claim is corrected in the docstring + route description —
  an ACCEPT commits without re-stamping the epoch.
- **R14-M2 (reopen under COMPLETED destroys stranded-READY
  entitlement) — FIXED (cheaper variant).** The cancel verdict now
  carries `submissionStatus`; reopen under COMPLETED + ACCEPTED
  bound submission refuses `would_cancel_accepted_work` with a
  pointer to force-approve (the payable-entitlement exit). REJECTED /
  missing submissions still auto-cancel — dead work.
- Result: 275 tests green (20 files), typecheck + lint clean.
