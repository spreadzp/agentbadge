# Review Findings — a2a-settlement R9 (EPIC-227)

## Scope

Static re-verification of the Round-8 fixes. I did not execute the test suite.

Read in full:
- `settlement/services/`: `milestone-approve.ts`, `milestone-revert.ts`, `milestone-force.ts`, `milestone-service.ts`, `resolve-apply.ts`, `rollup.ts`, `ctx.ts`; excerpts of `dispute-service.ts` and `dispute-resolve.ts`
- `settlement/`: `events.ts`, `state-machines.ts`, `index.ts` (ctx cache)
- `commerce/`: `review-postcommit.ts`, `review-revert.ts`, `review-settlement.ts`, `submission-review.ts`, `settlement-bridge.ts`; the `submitMilestone`/`findMilestone` call sites in `submission-service.ts`
- `routes/settlement/`: `register.ts` and `settlement-admin-milestones.ts`, for caller enumeration
- Tests: `commerce-settlement-r4.test.ts`, `settlement-lifecycle-revert.test.ts`, and the force-approve and revert-blocked cases of `settlement-lifecycle-force.test.ts`

Not provided, so assumptions not verified:
- `settlement/types.ts`. I assume `SettlementConflictError.code === "CONFLICT"`, which `settled()` relies on to log at error level.
- The `@agentbadge/database` store implementations. Whether `atomic()` is serializable and whether `applyStatus` CAS includes anything beyond `status` is unknown. The in-memory test bundle only.
- Any test stub that implements `CommerceSettlementBridge`, because none is in the supplied tests (`grep findMilestone tests` returns nothing).

## Verdict

**REQUEST CHANGES** (0 Critical, 0 High, 3 Medium).

All three Round-8 Mediums are fixed at the code level. I found no bypass of the `appr_`/`rsv_`/`ops_` scheme and no TOCTOU hole that matters in practice. Three residual Mediums remain:
- The "ruling preserved" branch leaves an unrecoverable agreement state with no operator exit.
- The M2 dangerous/benign classification still hides a paid-for-unverified-verdict case, and it is fail-open by construction.
- The load-bearing `ops_` prefix and every `review-revert.ts` branch have no regression test.

None of these opens a new theft or double-pay path. They are operability and assurance gaps in exactly the paths Round 8 was about.

## Critical

None.

## High

None.

## Medium

### M9-1: The "ruling preserved" branch has no operator exit, and the agreement deadlocks
- **Evidence:** `review-postcommit.ts:62-71`. For an `rsv_` or `ops_` epoch, or a foreign binding, the code logs `repair: "review milestone release"` and leaves the milestone APPROVED and bound to the REJECTED submission.
- **No tool matches that repair key.** The admin surface has only force-approve and force-reopen. `forceReopenMilestone` is READY-only (`milestone-force.ts:226-228` is a no-op, `:235-240` refuses on an OPEN intent). No admin APPROVED→PENDING release exists.
- **Resulting state:**
  - The provider cannot resubmit, because `submitForReview` needs PENDING (`milestone-service.ts:80`).
  - The buyer cannot accept the REJECTED submission (`review-settlement.ts:79-84`).
  - `pendingMilestoneCount` excludes APPROVED (`settlement-bridge.ts:236`).
  - The agreement-completion pass runs only on ACCEPTED (`review-postcommit.ts:105-155`).
  - After the operator pays and the milestone reaches RELEASED, the commerce agreement stays ACTIVE and the task IN_PROGRESS forever.
  - The only other exit is a dispute resolved FOR_BUYER, which cancels the milestone and pays nobody.
- **Why it matters:** the ruling is preserved correctly, but the system has no way to reconcile the commerce and settlement views afterwards. The `repair` key is unactionable.
- **Fix, either of:**
  - Add an audited admin release (`reason` required, APPROVED→PENDING with intent cancel, refused when any leg is paid), mirroring `forceReopenMilestone`.
  - Let the review/completion path finish an agreement whose milestones are all RELEASED or CANCELLED, whatever the bound submission's status.
  - At minimum, document the runbook and make the log say what to do.

### M9-2: The M2 classification is fail-open and still hides a paid-for-unverified-verdict case
- **a) `not_approved` lumps RELEASED with benign states.**
  - `milestone-revert.ts:82-84` returns `not_approved` for any non-APPROVED status. `rollup.ts:66-70` moves APPROVED→RELEASED when the last leg completes, so with the default single PROVIDER leg a payment landing between the gate approve and a failed verdict leaves the milestone RELEASED.
  - `review-revert.ts:81-95` then logs WARN with no `repair`. Money moved under a verdict that did not commit.
  - `paid_leg` is only reachable for multi-leg partial payouts (milestone still APPROVED).
  - The reject path (`review-postcommit.ts:44-95`) has no branch at all for a bound milestone that is RELEASED, so it is silent.
- **b) The classification is a denylist over an untyped string.** `reason?: string` (`milestone-revert.ts:62`, `settlement-bridge.ts:94`) is compared with two string literals at `review-revert.ts:81`. A renamed or new reason code falls into the benign WARN branch. This should be a closed union with an exhaustive switch and an error default.
- **c) The two callers are inconsistent.** The reject-release (`review-postcommit.ts:83`) logs error+`repair` for any `!reverted`, including the benign `not_approved` that a sibling gate-revert already released. That is the race the M2 split was meant to quiet, so it adds alert noise and trains operators to ignore `repair`.
- **Fix:** return the observed `status` with `not_approved`, and treat RELEASED/COMPLETED as error+`repair`. Export a `RevertReason` union, whitelist the benign ones, and default to error. Reuse one classifier in both callers.

### M9-3: The load-bearing R8 behaviours have no regression test
- No test asserts `ops_`. `grep ops_ tests/` is empty, so changing `"ops"` back to the default would pass the whole suite. There is also no force-approve→REJECT case.
- Nothing drives `review-revert.ts`: the `null` abort, `paid_leg`, `intent_state`, the benign warn, and the heal path. No test asserts any `repair` log (`grep repair tests/` is empty). R8-M2 is verified by reading only.
- The `!releasable` branch is covered only for `rsv_`. There is no case for a foreign `submissionRef`, `escrowRef: null`, or a re-stamp between `findMilestone` and the pinned revert.
- The R8-M1 test asserts status APPROVED and intent OPEN, but not that `escrowRef` is still the `rsv_` value.
- The R8-M3 test does prove the emit lands (`toEqual(row)`, `settlement-lifecycle-revert.test.ts:328`). But `listByEntity` always returns `[]`, so it does not prove the tail re-read (the safety property of the heal). It also does not cover re-poison or the `poisonSkips` cleanup.

## Nits / Suggestions

1. **`doApprove` epochPrefix is an untyped string** (`milestone-approve.ts:52`). Use `"appr" | "ops"` and export one `isCommerceEpoch()` helper. The prefix contract is currently hand-typed in `resolve-apply.ts:71`, `review-postcommit.ts:61` and `milestone-force.ts:155`.
2. **The gate token pin can silently turn off.** `approvalToken` is optional on the bridge and on `SettlementGate` (`review-settlement.ts:35,184`). If it is undefined, `revertGateApproval` passes `undefined` and `revertApproval` skips the pin (`milestone-revert.ts:88-90`), so it could undo an `rsv_` approval. The real bridge always supplies it, but fail closed: if `approvedByUs` and the token is missing, log error+`repair` and skip.
3. **Force-approve idempotent branch** (`milestone-force.ts:99-119`).
   - On an `rsv_` milestone, keeping `rsv_` is the safer choice. Both `rsv_` and `ops_` are unreleasable, and a re-stamp needs an illegal APPROVED→APPROVED CAS.
   - On an `appr_` milestone, the operator's "force" is a silent no-op with no audit row (`auditRecorded:false`). The epoch stays releasable, so a later REJECT erases the approval the operator believed they had pinned. Refuse it, or say so in the response.
4. **The pin is a read-then-CAS.** `revertApproval` checks `escrowRef` after `getById`, but the CAS in `milestone-revert.ts:139-146` and the intent CAS are status-only. It is correct under a serializable `atomic()`. Under weaker isolation an ABA through dispute-open then resolve-restore (APPROVED→DISPUTED→APPROVED/`rsv_`) inside the window would pass. Add `escrowRef` to the CAS predicate or lock the row.
5. **Legacy rows:** `escrowRef: null` APPROVED rows (pre-R6) are fail-closed correctly. They stay on the error+`repair` path with no automated release. Worth a one-off backfill or a note.
6. **`escrowRef` is semantically an escrow reference** and is now an overloaded provenance channel. A future real escrow ref write would silently disable reject-release. A dedicated `approvalEpoch` column would be cleaner.
7. **Event emitter safety signal:** "append settled" is a client-side signal (`events.ts:131-134`). A connection-reset failure may still commit server-side, so a post-heal `listByEntity` could fork. There is no uniqueness on `(entity, prevHash)` to catch it. `stale` entries for streams that are never emitted on again are never freed (`events.ts:163`, pre-existing, bounded by failing streams).
8. **Skipped events during poison are lost, not queued.** The count is logged once on recovery, which is good. Consider an outbox or replay if audit completeness matters.
9. **Reject path silence:** a bound milestone in RELEASED, DISPUTED or CANCELLED under a rejected submission logs nothing. A single info/warn line would help forensics.

## Verified-good

- **Prefix scheme (Q1):**
  - Exactly three writers touch `escrowRef`: `doApprove` (`milestone-approve.ts:90-95`, `appr_`/`ops_`), `resolve-apply.ts:70-72` (`rsv_`), and `revertApproval` (`:144-145`, clears on leaving APPROVED).
  - `transitionMilestone`'s patch type allows `escrowRef`, but its only caller passes `submissionRef`.
  - Every APPROVED entry is stamped: READY→APPROVED only via `doApprove`, DISPUTED→APPROVED only via the resolver. For `FOR_PROVIDER` it stamps when `prev === "APPROVED"`; `SPLIT` always stamps.
  - Nothing clears `escrowRef` while APPROVED.
  - `epochPrefix` is never user-reachable: the only non-default caller passes the literal `"ops"`.
- **`appr_` means commerce:** `approveMilestone` is called only by the bridge (review gate, accept-resync, heal). No buyer route calls it. No provider route calls `submitForReview`, so `submissionRef` binding is bridge-controlled.
- **Null handling:** `escrowRef: null` gives `releasable === false`, fail-closed, with error+`repair`. `findMilestone`'s widened return uses optional fields, so older stubs still type-check and fail closed (`undefined?.startsWith` is not `true`).
- **TOCTOU (Q2):** `milestone.escrowRef !== opts.approvalToken` runs inside `settlement.atomic`, after `getById` and before any CAS (`milestone-revert.ts:88-93`). A re-stamp between the post-commit read and the revert is refused (`epoch_mismatch`), surfaced as error+`repair` by the reject caller, and not erased. The residual is Nit 4.
- **`res === null` (Q3):**
  - The bridge returns `null` on every `!res.ok` (NOT_FOUND, conflict abort), after `settled()` has already logged it (WARN, or ERROR for CONFLICT).
  - Both callers now add error+`repair`. Thrown errors hit the outer catch with error+`repair`.
  - `intent_mismatch` is effectively unreachable, since there is one intent slot per milestone and reopen reuses the id. `epoch_mismatch` always means a different cycle owns the row and its own compensation path applies.
- **Self-heal (Q4):**
  - `pendingStale` is a local `const` captured before `stale.delete(key)`, so the same promise is registered for the heal (`events.ts:112-113,131`).
  - If the hung append settles between the timer firing and `poisoned.add`, `.then` on an already-settled promise still runs afterwards, so there is no permanent poison.
  - While poisoned, nothing appends, so no fork can come from a new emit.
  - Poison, heal, re-poison cycles work. A second poisoning registers a fresh heal on the new stale promise.
  - `poisonSkips` is created only on a skip and deleted on heal, so it has no leak for never-skipped streams.
- **Extraction (Q5):** `review-revert.ts` correctly imports `CommerceCtx` and `SettlementGate`. `ctx`, `gate`, `submissionId` and `actor` are all preserved, including `gate.approvedByUs`, `milestoneRowId`, `intentId` and `approvalToken`. The `ctx.settlement` guard narrows. `submission-review.ts` imports it at line 34.
- **Tests that do prove their claim:**
  - R8-M1 asserts both the milestone stays APPROVED and the intent stays OPEN. Because the R7-M2 test uses the same fixture and releases, the `rsv_` prefix is the only discriminator, so it is a genuine differential.
  - R8-M3 asserts the post-heal emit returns the row, not just that it does not hang.

## Round-8 status

- **R8-M1:** CONFIRMED-FIXED. Provenance prefixes are written at all three sites, and the reject-release requires `appr_` plus a submission binding match. The pin is inside the revert atomic, and the test proves status and intent are both preserved. Residual: M9-1 (no exit), M9-3 (`ops_` untested).
- **R8-M2:** PARTIAL. Reason codes exist, `null` and `!reverted` are checked at every call site, and the resync result is checked. But `not_approved` still lumps RELEASED, the classification is an untyped denylist, the two callers disagree, and no test covers it (M9-2, M9-3).
- **R8-M3:** CONFIRMED-FIXED. The heal is registered on the captured stale promise and lifts on settle. The skip counter is bounded and cleaned up, and the test proves the emit lands. Residuals are Nits 7-8.

## Remediation status (post-fix)

- **M9-1 (no operator exit / agreement deadlock)** — FIXED, both
  suggested paths implemented.
  - New audited operator exit `forceReleaseMilestone`
    (`settlement/services/milestone-release.ts`): APPROVED→PENDING via
    `revertApproval(release:true)` — shares its guards (paid leg /
    FROZEN intent refuse); clears the submission binding + epoch;
    writes `FORCE_RELEASE_MILESTONE` AdminAction and returns
    `auditRecorded`. Exposed as
    `POST /admin/settlement/milestones/:id/release`, and the `repair`
    log now names this exit (`exit:` field).
  - The completion pass runs on EVERY verdict
    (`completionPass` in `review-postcommit.ts`) — a bound milestone
    that is RELEASED/CANCELLED or standing APPROVED under a
    non-commerce epoch leaves zero pending work and completes the
    agreement (+task).
  - Regression: agreement COMPLETED asserted in the R8-M1 spec;
    `R9-M2: REJECT on an already-RELEASED bound milestone reconciles
    the agreement`; admin route + service tests for force-release
    (success, audit row, non-APPROVED refusal, paid-leg refusal).
- **M9-2 (fail-open classification / RELEASED hidden)** — FIXED.
  - `RevertReason` is a closed union (`milestone-revert.ts`):
    `not_approved` (carries `observedStatus`), `epoch_mismatch`,
    `intent_mismatch`, `intent_state`, `paid_leg`, `released`.
    RELEASED gets its own code — a paid terminal state can no longer
    fall into the benign bucket.
  - One shared classifier `logRevertOutcome` (`review-revert.ts`)
    used by both callers: `null` abort + dangerous reasons
    (`released`, `paid_leg`, `intent_state`, unknown/future codes)
    → error + stable `repair` key; only the whitelisted benign
    reasons (`not_approved`, `epoch_mismatch`, `intent_mismatch`)
    → warn. Fail-closed default, no denylist.
  - Bound non-actionable milestones under a rejected submission get a
    forensic log line (nit 9).
  - Regression: `tests/commerce/review-revert.test.ts` drives every
    classifier branch via logger spies.
- **M9-3 (missing regression coverage)** — FIXED for the
  highest-risk items, residual nits documented.
  - `ops_` epoch asserted after force-approve; `appr_` epochs refuse
    the idempotent force-approve replay (nit 3 — stronger than
    suggested: refused for `rsv_` too, since a silent no-op mints no
    audit row; the operator's real paths are force-release and
    dispute/resolve).
  - Admin route tests for `POST …/release` (auditRecorded + row).
  - Classifier unit tests cover null/benign/dangerous/unknown.
  - R8-M1 extended: agreement COMPLETED (deadlock exit).
  - Still uncovered (documented, next round): bridge-`null` abort at
    service level, heal path, foreign `submissionRef`/`escrowRef:null`
    `!releasable` variants, re-poison, and the emitter tail re-read
    assertion.
- **Nit 2 (token pin can silently turn off)** — FIXED:
  `revertGateApproval` fails closed (error + `repair`, no call) when
  `approvedByUs` has no `approvalToken`.
- **Nits 1, 4–8** — deferred: untyped `epochPrefix` literal, ABA under
  weak isolation (needs `escrowRef` in the CAS predicate), legacy
  null-epoch backfill, dedicated `approvalEpoch` column, event
  `(entity, prevHash)` uniqueness, outbox/replay.
- 250 tests green (19 files):
  `vitest run --run tests/settlement tests/commerce`.
