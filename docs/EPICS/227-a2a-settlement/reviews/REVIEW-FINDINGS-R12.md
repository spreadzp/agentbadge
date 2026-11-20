# Review Findings — Settlement R12 (EPIC-227)
## Scope
Confirmation of R10/R11 remediation (cd430a81, 7467c4f7): `agreement-guard.ts`, `milestone-release.ts`, `milestone-force.ts` (reopen), `milestone-revert.ts` (epoch/admin/eventReason), `types.ts` (`details`), `review-postcommit.ts`, `settlement-admin-milestones.ts`, `helpers.ts` (`respond`), and the three specs. Static read only. `tests/settlement/helpers.ts`, the commerce review/settlement-gate co…
## Verdict
**REQUEST CHANGES.** The R10/R11 fixes hold as written: fail-closed reads, typed 409s, epoch from the atomic, and the `verdict_rejected` and `admin` labelling. The guard has two design holes, though.
- The `gate_in_flight` check trusts a provider-writable `milestone.submissionRef` without checking who owns it.
- The guard now blocks the exact operator exit (`/release`, `/reopen`) that the R9-M1 repair logs point operators to.

The cross-store TOCTOU itself is low severity: the worst outcome is an orphaned PENDING row plus a log line, and no funds are at risk. The issues below are about the guard's decisions, not its race window.

## Critical
None.

## High
**H-1. `gate_in_flight` is keyed on an unverified, epoch-blind pointer. Operators can be locked out of both exits, including by the provider.**
Where: `agreement-guard.ts:62-86`, used by `milestone-release.ts:138` and `milestone-force.ts:258`.

The guard reads `submissions.getById(milestone.submissionRef)` and refuses on `SUBMITTED`. It never checks three things:
- that the submission belongs to `plan.agreementRef`;
- that the submission's `milestoneRef` equals `milestone.milestoneId`;
- which epoch holds the approval.

Two consequences:
1. **Provider-forged lock (code path confirmed).** `submitForReview` (`milestone-service.ts:92-98`) binds any string up to `MAX_ID_FIELD` as `submissionRef`. It does not check that the ref is a commerce submission of this agreement. A provider who has any perpetually-SUBMITTED submission anywhere (their own, on another agreement) can bind that id.
   - If the milestone later reaches APPROVED, `forceRelease` returns `gate_in_flight` for as long as that foreign submission stays SUBMITTED. This applies to `appr_`, `rsv_` and `ops_` approvals alike. I could not read the route to confirm the participant submit endpoint forwards a free-form `submissionRef`.
   - If the milestone sits READY, `forceReopen` is blocked the same way.
   - A foreign binding also defeats the reject-release. `review-postcommit.ts:386` requires `bound.submissionRef === result.submission.id`, so the reject-release never fires. The milestone stays standing, and the repair log points at the exit the guard now refuses.
2. **Natural case, no attacker.** After `forceApproveMilestone` (`ops_`), the premise is that the buyer is unreachable. The commerce submission therefore stays SUBMITTED forever, and the operator cannot undo their own force-approve (`gate_in_flight`). The same applies to an `rsv_` SPLIT restore on a still-SUBMITTED submission. For `ops_` and `rsv_` no gate is in flight at all, because the gate onl…

Fix:
- Treat SUBMITTED as in-flight only when `submission.agreementId === plan.agreementRef`, `submission.milestoneRef === milestone.milestoneId`, and the epoch is `appr_`.
- Otherwise ignore it, or require an explicit `acknowledgeInFlight` flag for `ops_`/`rsv_`. If the verdict ACCEPTs mid-release, you then get ACCEPTED + PENDING, which is why the flag is better than silently ignoring.
- Reject non-commerce `submissionRef` values at the settlement submit seam, or add a mismatch test.

## Medium
**M-1. The R9-M1 operator exit is unreachable in the one scenario it was built for (single or last milestone).** Confirmed by the existing test.
- `review-postcommit.ts:386-400` logs `exit: POST /admin/settlement/milestones/:id/release`.
- `review-postcommit.ts:443` then runs `completionPass`. `pendingMilestoneCount` excludes APPROVED (`settlement-bridge.ts:427-431`), so a lone standing APPROVED milestone gives pending=0 and the agreement becomes COMPLETED.
- `agreement-guard.ts:53` then refuses with `agreement_not_active`.
- `commerce-settlement-r4.test.ts` ("R8-M1 … rsv_ epoch") asserts exactly this sequence.
- The same applies when the reject-release aborts and leaves an `appr_` milestone standing: the log points at `/release`, the agreement completes, and `/release` refuses. The route description and repair log never mention that the exit self-destructs.
- Rejected work then can only be paid, or undone through a participant-raised FOR_BUYER dispute. The operator has no unilateral undo.

Fix, any one of:
- (a) When the agreement is closed, let `/release` go APPROVED→CANCELLED (intent cancelled) instead of PENDING. That is terminal, not an orphan, so the guard's own rationale does not apply.
- (b) Do not run `completionPass` while a non-commerce APPROVED stands under a REJECTED verdict.
- (c) At minimum, correct the log `exit` text and the route docs.

**M-2. `forceReopenMilestone` is not pinned to the state the guard evaluated, and its audit claims an effect that may not have landed.** Code path confirmed: `milestone-force.ts:258-295`.
- The guard decides on the pre-read `milestone.submissionRef`. `reopenMilestone` then re-reads the row and the call passes no `expectedSubmissionRef`. If the row moved in between (reject-release, provider resubmits S2, READY/S2), reopen unbinds S2 while its verdict is pending. A later ACCEPT then finds a PENDING milestone, and the ACCEPT resync (`review-postcommit.ts:456`) only acts on READY. The …
- If the row left READY in the gap (for example the buyer approved it), `reopenMilestone` returns `ok(milestone)` unchanged (`milestone-service.ts:122-124`). `forceReopen` ignores the returned status, writes a `REOPEN_MILESTONE` AdminAction (`fromStatus:"READY"`, `toStatus:"PENDING"`), and returns `reopened:true`. The audit row and the response are false.
- This is the same defect class R11 nit 5 fixed for release, left open on reopen.

Fix: pass `expectedSubmissionRef: milestone.submissionRef ?? undefined`. Only audit and answer `reopened:true` when `res.value.status === "PENDING"`.

**M-3. The orphan repair log's documented exits may not exist, and the operator gets a clean 200.** `milestone-release.ts:161-176`.
- The log says "dispute resolved FOR_BUYER (or a new plan supersedes)". `createPlan` is unique on `agreementRef` (`settlement-bridge.ts`, `ensurePlan` CONFLICT semantics), so a superseding plan for the same agreement is not possible.
- A dispute FOR_BUYER on a PENDING milestone needs `PENDING→DISPUTED` and a freeze scope. `resolve-apply.ts:244` only cancels `DISPUTED` rows that carry a freeze snapshot. I could not read `state-machines.ts` or `dispute-scope.ts` to confirm that edge, so I am not asserting it is missing. Please prove it in a test.
- The response is `{released:true,auditRecorded:true}` and the AdminAction evidence has no orphan marker. Only a log line carries the signal. Surface it as `orphaned:true` in both the response and the evidence.
- The `catch {}` on the post-check swallows read failures silently. Log at warn.

## Nits / Suggestions
1. **Pin the release.** `forceRelease` passes no `approvalToken`. Passing the pre-read `escrowRef` when non-null would tie the guard's decision to the epoch the operator saw, and the audit-vs-atomic epoch would then match by construction. Today `approvalEpoch` is correct (from the atomic) but `boundSubmissionRef` in the same evidence row is still the pre-read value, so the two can disagree under a…
2. **Guard keys on `milestone.submissionRef` only.** If the commerce gate approves via `submission.milestoneRef` while the row's `submissionRef` is null (unbound submit), the guard skips the submission check entirely. I could not read `review-settlement.ts` to prove the gate can approve an unbound row, so this is unconfirmed. If it can, key the in-flight check on "any SUBMITTED submission with thi…
3. **DISPUTED agreement allowed.** The file header (`agreement-guard.ts:2-6`) says submission and review "both require an ACTIVE agreement", yet the body allows DISPUTED on the stated premise that it still accepts them. The two statements contradict each other. Commerce's state machine decides which is right, and I could not read it. If DISPUTED agreements refuse submit/review, DISPUTED must be re…
4. **Participant routes may keep an "orphan" alive.** `submitForReview` and `approveMilestone` gate only on `plan.status === "ACTIVE"`, not on agreement status. A PENDING row under a COMPLETED agreement can therefore still be submitted and approved at the settlement layer. This is not a hole, but it weakens the guard's "dead forever" rationale, and the guard ignores `plan.status` (it receives `pla…
5. **CONFLICT path drops `details`.** In-atomic throws are caught in `revertApproval` and returned as `fail(err.code, err.message)`. A script keyed on `details.reason` sees `CONFLICT` with no reason. Add `{reason:"conflict"}` or similar.
6. **Missing OpenAPI responses.** `/reopen` documents only 400/401/404 but can now return 409 and 503. `/approve`'s description tells operators to "use force-release" for `appr_`/`rsv_` epochs, which M-1 can refuse.
7. **Error precedence.** The guard runs before the in-atomic checks, so a paid-leg milestone under a closed agreement reports `agreement_not_active`, not `paid_leg`. Both are 409; low value.
8. **Layering exception.** Settlement reads `db.commerce.*` directly. This is documented in the bridge, but it hard-wires the two stores together if they are ever split. Prefer an injected `AgreementStateReader` on `SettlementCtx`. Also use the state-machine constants instead of the literal `["COMPLETED","CANCELLED"]`, which is duplicated in the guard and the post-check.
9. **Cross-store TOCTOU, answer to Q3.** I found no interleaving beyond orphan + log.
   - The guard reads the agreement first, then the submission. A completion landing between the two reads can pass (agreement ACTIVE, submission ACCEPTED, agreement now COMPLETED). Reading the submission first makes that window harmless, because a SUBMITTED read refuses.
   - The revert's own CAS and intent/leg re-list still protect against paid legs.
   - M-2's reopen race is the only variant that strands real value (an ACCEPTED submission with no payable intent), and it is a one-line fix.

## Verified-good
- **Fail-closed reads.** A thrown agreement read and a thrown submission read each return `PROVIDER_ERROR` (503), with no mutation. The missing-row case is the only fail-open branch, and it is intentional (pure-settlement plan).
- **Missing plan.** `forceRelease` and `forceReopen` both return `NOT_FOUND` before any mutation.
- **`gate_in_flight` window (Q2).** For a bound `appr_` milestone the window is closed in the safe direction: if the guard reads SUBMITTED it refuses. If it reads a committed verdict, the release acts on a committed verdict, so no new race arises. I found no slip for bound submissions apart from H-1's pointer problem. Release-vs-gate-revert races resolve benignly: `not_approved` or `epoch_mismatch…
- **`RevertResult.epoch` (Q4).** It is read inside the atomic (`milestone-revert.ts:464`) from the same row the CAS moves. `forceRelease` evidence uses it (`milestone-release.ts:192`). No caller trusts the pre-read `escrowRef` for audit. The bridge's `revertApproval` forwards `res.value`, which carries the extra `epoch` field at runtime and is harmless.
- **Atomic refusals map to 409 + `details.reason`.** `reverted:false` becomes `INVALID_STATE` with the closed `RevertReason`, and no audit row is minted (the `intent_state` test asserts the audit-count delta is zero). The `respond()` mapping is correct: INVALID_STATE 409, PROVIDER_ERROR 503, NOT_FOUND 404.
- **No info leak (Q5).** `details` carries only the closed-union reason, the agreement status, and `gate_in_flight`. The routes are behind `adminAuth`, and DB error text is logged, never returned.
- **Event labelling.** `leg.cancelled`, `intent.cancelled` and `milestone.pending` carry `reason` and `admin:true`. `revert_blocked` carries `admin`. Reject-release emits `verdict_rejected`, which is asserted in the r4 test.
- **R8-M1 provenance rules.** Only `appr_` epochs bound to the rejected submission are released by a verdict, and `rsv_`/`ops_` rulings stand. The R9-M2 benign whitelist is fail-closed. The R10-M3 refusal classes and the no-audit-on-refusal rule hold.
- **Tests (Q6, partial).** The guard specs are not vacuous for the branches they target.
  - Covered: COMPLETED refusal, DISPUTED allowed, thrown agreement read with the milestone unchanged, SUBMITTED binding, thrown submission read, `paid_leg` `details.reason`, and the reopen COMPLETED mirror.
  - The SUBMITTED and thrown-submission cases only fail correctly if `approvedIntent` binds a `submissionRef`. The helper was not supplied, so confirm it does.
  - Not exercised: `approvalEpoch` in the audit evidence (R11 nit 5 is untested), the orphan post-check log branch, reopen with SUBMITTED or thrown reads, missing-plan `NOT_FOUND`, `revert_blocked` `admin`, and the foreign or forged `submissionRef` case. The SUBMITTED stub returns a bare `{status}` for any id, so H-1 cannot show up. The "missing row" case relies on the fixture having no commerce r…

---

## Remediation status (2026-11-20, post-R12)

- **H-1 (gate_in_flight trusted provider-writable submissionRef) — FIXED.**
  `checkReleasableAgreement` now refuses only when the submission is
  SUBMITTED **and** `agreementId === plan.agreementRef` **and**
  `milestoneRef === milestone.milestoneId` **and** the epoch is `appr_`.
  Foreign bindings and `ops_`/`rsv_` epochs no longer lock the exit;
  the release unbinds them. Regression tests: owned-SUBMITTED refuses,
  foreign-SUBMITTED lands, ops_+SUBMITTED lands.
- **M-1 (operator exit dead under closed agreement) — FIXED via (a).**
  Guard verdict `cancel` → forceRelease lands APPROVED→CANCELLED
  (intent+legs cancelled via the same atomic guards: paid_leg and
  FROZEN still refuse). forceReopen mirrors: READY→CANCELLED.
  R8-M1 commerce test updated to assert the CANCELLED cleanup.
- **M-2 (reopen unpinned + false audit) — FIXED.**
  `expectedSubmissionRef` now passed from the pre-read row; the audit
  row and `reopened:true` are minted only when the row actually
  reached the target status. Race test via second-read getById flip.
- **M-3 (orphan signal invisible in response) — FIXED.**
  `orphaned:true` now surfaces in the response AND the audit evidence;
  the post-check catch logs at warn instead of swallowing; the exit
  text no longer claims a superseding plan can exist.
- Nits folded: **1** (release pinned via `approvalToken` = pre-read
  escrowRef — epoch_mismatch then refuses a re-landed approval),
  **5** (`details.reason:"conflict"` on the CONFLICT path),
  **6** (`/reopen` documents 409+503; `/release` description rewritten
  for cancel semantics + orphaned flag),
  **9** (submission read before agreement read — but the
  gate_in_flight refusal is APPLIED only after the agreement read:
  under a terminal agreement `cancel` wins over a stale owned
  SUBMITTED row, otherwise the exit deadlocks on a verdict that can
  never land. Self-review catch, covered by a dedicated test).
- Nits documented, not implemented: **2** (unbound-submit
  milestoneRef gate — unconfirmed by the auditor too), **4**
  (participant routes under closed agreement — noted as rationale
  weakening, not a hole), **7** (error precedence — cosmetic),
  **8** (injected AgreementStateReader — accepted; layering exception
  already documented in the bridge header).
- Result: 267 tests green (20 files), typecheck + lint clean.
  `milestone-reopen.ts` extracted from milestone-force.ts (cap).
