# Review Findings — a2a-settlement R5 (EPIC-227)

## Scope

Round-5 adversarial re-verification of the Round-4 fixes in the A2A milestone settlement layer. Files read in full: `review-settlement.ts`, `review-postcommit.ts`, `submission-review.ts`, `submission-service.ts`, `milestone-revert.ts`, `milestone-approve.ts`, `milestone-service.ts`, `settlement-bridge.ts`, `state-machines.ts`, `dispute-service.ts`, `dispute-resolve.ts`, `resolve-apply.ts`, `rollup.ts`, `payout-service.ts`, `verify-payout-tx.ts`, `verify-payout-tx-viem.ts`, `register.ts`, `settlement-admin.ts`, `events.ts`, `index.ts`, `ctx.ts`, `invariants.ts`, `guards.ts`, `admin-actions.ts`, `offer-accept.ts`, `dispute-scope.ts`.

Limits of this review:
- The database package (`@agentbadge/database`) is not in the tree. Store semantics are inferred from call sites: unique intent per milestone, `applyStatus` as a CAS returning null on a lost race, and `atomic` rolling back on throw but committing on `return fail(...)`. Findings H-1 and H-2 depend on the unique-intent assumption, which the code itself states (`payout intent insert conflicted for milestone`).
- Nothing was compiled or run. The type note in Nits is from reading.

## Verdict

**REQUEST CHANGES** (0 Critical, 2 High, 6 Medium).

Most of the Round-4 fixes are real and correct. They are the chain-id observation, the token rail, the dispute-freeze rollback, the plan-null handling, the shared emitter, and the force-approve hardening, all with caveats listed below.

The headline fix, R4-H1, is only partly closed:
- The precondition mirror is nearly exact.
- The safety net it relies on (`revertApproval`) is itself unsafe. It permanently bricks the milestone, and it reverts approvals whose verdict a sibling review has already committed.
- That reintroduces unpaid completion, the same class as R4-H1, through a double-click or retry race.

## Critical

None.

## High

### H-1. `revertApproval` permanently bricks the milestone: re-approval is impossible by every path
- **Where:** `milestone-revert.ts:38-69`, `milestone-approve.ts:63-68` and `91-106`.
- **What happens:**
  - The revert sets the milestone APPROVED→READY and the intent OPEN→CANCELLED, but the intent row stays.
  - `doApprove` rejects any existing intent for the milestone (`getByMilestone` returns CONFLICT). Even if that lookup were status-filtered, the insert would hit the unique milestone key and throw.
  - So a reverted milestone sits at READY with a CANCELLED intent. Buyer approve fails with a 409 CONFLICT forever.
  - `forceApproveMilestone` goes through the same `doApprove`, so the operator fallback fails too.
  - The post-commit resync (`review-postcommit.ts:60`) also fails the same way.
- **Impact:**
  - Any single revert, including one caused by a transient error, makes that milestone unpayable.
  - The "failed request stays retryable" property is false after a revert.
  - A retried ACCEPT now returns 409 forever, and the only exits are a database repair or a dispute.
  - It is also deterministic and buyer-triggerable. The mirror skips the `reviewNote` check (see M-2), so an oversized note makes the approve land and the atomic then 400.
- **Fix, any one of:**
  - (a) Have the revert delete the never-paid OPEN intent and legs, freeing the unique slot.
  - (b) Let `doApprove` re-open an intent that was cancelled for `verdict_not_committed` (CANCELLED→OPEN, legs back to OPEN, restricted to that payload reason).
  - (c) Do not create a payable OPEN intent before the verdict commits. Use a hold state, or move the approve post-commit behind a durable retry.

### H-2. `revertApproval` is unconditional on verdict state: a sibling's committed ACCEPT can be reverted, which produces ACCEPTED + COMPLETED with an unpaid, unapprovable milestone
- **Where:** `submission-review.ts:178-196`, `review-settlement.ts:151-166`, `milestone-revert.ts:35`.
- **Interleaving (two ACCEPTs on one submission, for example a double-click or a client retry on timeout):**
  1. R1 and R2 both pass the mirror, because the submission is still SUBMITTED.
  2. R1 wins the approve CAS, so `approvedByUs = true` and the intent is OPEN.
  3. R2 reads the milestone as APPROVED, skips the approve (`approvedByUs = false`) and goes to its atomic.
  4. R2's atomic commits first. The submission is ACCEPTED and, with `pendingAfter === 0`, the agreement is COMPLETED.
  5. R1's atomic now fails with "already reviewed". R1 owns the approval, so it calls `revertApproval`. The milestone goes to READY and the intent to CANCELLED.
  6. R2's resync either runs before the revert and skips because the milestone is APPROVED, or runs after and fails on the CANCELLED intent (H-1).
- **Final state:** submission ACCEPTED, agreement COMPLETED, milestone READY, intent CANCELLED, nobody paid, and no recovery path.
- **Why `approvedByUs` does not help:** it protects the loser of the approve CAS. Here the approve winner is the one that reverts, and a verdict that depends on its approval has already committed.
- **Same shape, ACCEPT vs REJECT:**
  - If a REJECT commits during an ACCEPT's approve-to-commit window, the REJECT's post-commit release sees APPROVED and skips.
  - The ACCEPT then fails and reverts to READY. The result is a stuck READY milestone with a REJECTED submission and a CANCELLED intent.
  - So the R4-M5 liveness fix is reintroduced by the R4-H1 safety net.
- **Fix:**
  - In the catch block, re-read the submission before reverting. If it is ACCEPTED, skip the revert and let the post-commit sync heal.
  - Pass the approve's `intentId` into `revertApproval` and revert only that intent.
  - With H-1 fixed, the remaining interleaving is self-healing: R1 reverts, R2 commits ACCEPT, and R2's resync re-approves the READY milestone.

## Medium

### M-1. The gate can throw after its approve lands, outside the revert scope
- **Where:** `review-settlement.ts:155-173` and `submission-review.ts:59-63`.
- **What happens:** `pendingCount` runs after the approve and can throw a typed 409 (store failure, or null plan). The gate call is outside the `try` that owns the revert, so a milestone APPROVED with an OPEN intent is left behind on a 409 with the submission still SUBMITTED.
- **Why it is avoidable:** `pendingAfter` is computed with `found.id` excluded and APPROVED not counted, so it does not depend on the approve.
- **Fix:** Compute it before the approve. Alternatively, wrap everything after `approvedByUs = true` in the revert handler.

### M-2. The precondition mirror is not exactly the atomic's check set: `reviewNote` is missing
- **Where:** `submission-review.ts:94-96` (atomic) versus `review-settlement.ts:34-89` (mirror).
- **What happens:** The atomic runs `assertSummary(reviewNote)`. The mirror does not, so an invalid or oversized note on an ACCEPT approves, mints an OPEN intent, then 4xxs and reverts. Under H-1 that bricks the milestone.
- **Fix:** Validate `reviewNote` in `reviewSubmission` before the gate. Better, hoist the shared pre-checks into one function used by both the mirror and the atomic, so the sets cannot drift.
- **Everything else matches:** the buyer, SUBMITTED, task UNDER_REVIEW|SUBMITTED and agreement ACTIVE checks are present and in the same order.
- **Interleaving risk is closed:** there is no evidence-attach operation in this tree, so the only things that can move a SUBMITTED submission or its task or agreement between the mirror and the atomic are another review or an agreement or task cancel.

### M-3. A reject verdict plus a lost release can leave the milestone stuck READY, with no safe operator exit
- **Where:** `review-postcommit.ts:34-50`, `settlement-bridge.ts:233-238`.
- **What happens:**
  - The release runs post-commit with no retry, and the bridge only logs (`settled` warns) on a failed result.
  - A READY milestone with a rejected submission cannot be rebound. Bound submits need PENDING, and auto-bind skips READY.
  - Resubmissions become unbound. The unbound ACCEPT path counts the READY milestone as pending forever, so the agreement never completes and nobody is paid.
  - A dispute on READY then resolved FOR_PROVIDER restores READY the same way.
- **Why it is not just a liveness note:** the only operator tool is `forceApproveMilestone`, which pays the provider for work the buyer rejected. There is no operator "reopen".
- **Fix, either or both:**
  - Heal lazily. `submitMilestone` and `openMilestones` treat a READY milestone whose `submissionRef` points to a REJECTED or REVISION_REQUIRED submission as PENDING, using the `submissionRef` the submit path already stores.
  - Add an audited admin reopen.
- **Small race:** the provider can resubmit between the verdict commit and the release, because the task is IN_PROGRESS as soon as the verdict commits. That submission binds to nothing, and the release then PENDINGs the milestone.

### M-4. Force-approve audit is post-effect, and the evidence can be made to degrade by the operator
- **Where:** `milestone-approve.ts:250-274`, `admin-actions.ts:100-121`, `guards.ts:64-74`.
- **What happens:**
  - The approval commits first, and the AdminAction is written afterwards. If the audit fails, the approval stands. There is no server-side error log, only `auditRecorded: false`.
  - `reason` is capped by raw length (`checkTextField`, 4000), not serialized length. Evidence is capped at 4 KB. A reason of about 4000 quotes or control characters expands past the cap.
  - `recordPostEffectAudit` then retries with the minimal evidence (`{milestoneId, outcome, degraded:true}`), which drops reason, submissionRef, planId, agreementRef and intentId. That retry returns ok, so the response says `auditRecorded: true` while the justification is gone from the audit row. The operator controls the input that triggers this.
- **Is "audit failed" a usable excuse?** Largely no. The operator who sees `false` knows it, and the event stream carries `admin:true` plus the reason. But both the event emit and the audit are best-effort and in separate stores, so a window exists where neither is recorded. The intent row itself (`payload: {planId, milestoneId}`) carries no admin marker.
- **Evidence gaps:**
  - Missing: buyer and provider wallets, milestone amount, payee legs, prior status, the milestone's current `submissionRef` (the supplied `submissionRef` is never checked against it), and any caller identity beyond the self-declared label.
  - `reason` has no minimum meaning (`"."` passes).
- **Fix:**
  - Use `checkSerialized` for `reason`.
  - Make the minimal evidence keep a bounded reason prefix plus a hash.
  - Write the audit row before the effect, or fail closed when the audit store is down, since this action is payout-authorizing.
  - Log an error whenever `audit.ok` is false.
  - Return a distinct `alreadyApproved` flag instead of `auditRecorded:false` on the idempotent branch.

### M-5. Pre-commit approve exposes a payable OPEN intent, and the revert has no completed-leg guard
- **Where:** `milestone-revert.ts:48-68`, `payout-service.ts:106` and `190-199`.
- **What happens:**
  - From the approve until the verdict commits, or the revert completes, the intent is OPEN and visible to `markLegPaid`. A revert that fails or throws is only logged, so the OPEN intent can persist indefinitely against a REJECTED or SUBMITTED submission.
  - If an operator marks a leg paid in the window, a single-leg intent goes to RELEASED and the revert returns `reverted:false`, so a payment is made for an uncommitted verdict.
  - A multi-leg intent can end as milestone READY, intent CANCELLED, and one COMPLETED leg that is never touched. That is money moved under a cancelled intent.
- **Fix:**
  - The revert should refuse, or flag for operator attention, when any leg is not OPEN.
  - Add a durable compensation record (outbox or retry) for a failed revert.
  - Better, remove the window by creating the intent in a non-payable hold state until the verdict commits.

### M-6. A missing `token` fact bypasses the pinned-token check
- **Where:** `verify-payout-tx.ts:120-151` and `219-232`.
- **What happens:**
  - The R4-M2 logic is right for adapter-reported tokens: "native" is accepted, an ERC-20 without a pin is TX_UNVERIFIED, and a pin must match.
  - But `token` is not in the mandatory-fact list. An adapter that attests `asset:"USDC"` and omits `token` passes even when a pin is configured, so the M-6 invariant "an ERC-20 from any other contract cannot satisfy the leg" depends on adapter honesty.
  - The shipped adapter always reports `token`, so this is exposed to custom or stubbed adapters only.
- **Fix:** When `expected.token` is defined, or `asset !== native`, require `check.token` and add it to the `missing` list.

## Nits / Suggestions

- **Type narrowing:** `submission-review.ts:186` passes `settleMilestoneId` (type `string | undefined`) to `revertApproval(string, …)`. `gate.approvedByUs === true` does not narrow it. This probably fails `tsc` strict, so run `bun run check`. Fix by returning a discriminated gate type, or by guarding on `settleMilestoneId !== undefined`.
- **Intent freeze CAS (dispute freeze, R4-M3 symmetry):** `dispute-service.ts:213-235` still silently skips a lost intent CAS (`f` null) and a lost leg CAS (`fl` null), unlike the milestone CAS now. Throw `SettlementConflictError` there too.
- **Shared emitter head-of-line blocking:** the singleton queue (`events.ts:65-71`) has no append timeout. One hung `listByEntity` or `append` stalls every later emit and every `await flush()` or `await emit()` in every request for the process.
- **Hash-chain scope:** the chain is serialized per process only (the WeakMap). A multi-instance deployment can still fork a stream, since there is no store-level uniqueness on `(entity, prevHash)`. Document or enforce it.
- **Event ordering:** post-commit flushes from two concurrent atomics can emit in a different order than they committed (for example approve vs revert vs dispute on one milestone stream).
- **Missing revert events:** `revertApproval` emits intent and milestone events but no `leg.cancelled`.
- **Hard-coded decimals:** `verify-payout-tx-viem.ts:120` and `140` use literal 18 and 6. Use `gasTokenDecimalsFor` and `usdcDecimalsFor` from `@/onchain-money`, per the platform rule.
- **One rail per transaction, availability only:** the adapter returns the native branch whenever `tx.to && tx.value > 0n`. A tx with incidental native value plus a valid pinned ERC-20 payout reports `payee = tx.to` and fails closed (safe, not a double-count).
- **Gate heal for null plan:** the unbound path calls `pendingCount` without a plan heal. An unbound submission on an agreement whose plan creation failed gets a 409 until the next heal path runs.
- **Dispute resolve with a completed leg:** FOR_BUYER and SPLIT both fail INVALID_STATE once any leg of the frozen intent is COMPLETED. After a partial payout of a multi-leg intent, only FOR_PROVIDER can ever resolve it. Consider allowing SPLIT over the remaining legs.
- **Dispute resolve OPEN-list cap:** `disputes.list({status:"OPEN", limit:1000})` with a payload filter is fragile past 1000 open disputes. Use a plan-scoped query.
- **WeakMap ctx cache:** if a test swaps `db.commerce.events` on the same Database object after first use, the cached emitter is stale.
- **Completion pass premise:** the M-1 "concurrent sibling review" comment is mostly moot, because submit requires task IN_PROGRESS and review of one submission is the only thing in flight per task. The pass remains harmless and handles stranded ACTIVE agreements.
- **Operator label:** the label is self-declared, and the force-approve audit trail is only as strong as the shared admin key.

## Verified-good

- **Gate precondition order and error types:** the mirror matches the atomic for buyer, submission SUBMITTED, task status and agreement ACTIVE (only the `reviewNote` check is missing, see M-2). Its failures are typed (403/409/422-class) and happen with zero settlement writes. A REJECT-then-ACCEPT retry now stops at the mirror.
- **Revert race protection against siblings:** `approvedByUs` correctly prevents reverting an approval the gate did not make (the loser of the approve CAS gets a 409 and never reverts). Only the winner-reverts case in H-2 is wrong.
- **Revert CAS mechanics:** APPROVED→READY is gated by `applyStatus`. A milestone that has moved to DISPUTED or RELEASED returns `reverted:false`. A lost CAS throws, so the atomic rolls back. The state-machine edges are exactly as claimed. Events are buffered and flushed only on success.
- **Post-commit completion still reached:** `submission-review.ts:202-204` calls `postCommitSettlementSync` after commit. The ACCEPT branch resyncs a READY milestone and then runs the completion pass. A null pending count skips completion (R4-M6 verified on that path). Extraction did not drop the completion pass.
- **Release on reject (happy path):** READY→PENDING with the `submissionRef` cleared, idempotent, and released only if the milestone is still READY.
- **R4-M6 in the gate:** `pendingMilestoneCount` returns null for a missing plan, and the gate maps it to a typed 409 (modulo M-1 ordering).
- **Dispute freeze (R4-M3):**
  - The loop order is milestone CAS first, then intent. A lost milestone CAS throws `SettlementConflictError`, the whole atomic rolls back, and `buf.flush()` only runs on `res.ok`, so there are no post-atomic side effects.
  - An intent freezes only if `freeze.milestones[m.id]` was set by this dispute.
  - `return fail(...)` paths commit nothing, because no writes precede them.
  - The duplicate re-read after a lost plan CAS is correct under READ COMMITTED: the loser blocks on the plan row, the CAS returns null after the winner commits, and the re-read sees the committed dispute.
- **Replay and double-count (Q7):** one leg per `(network, txHash)`, enforced by `getByTxHash` and the in-process lock, with the unique index as backstop. One tx cannot satisfy two legs, and the adapter picks exactly one rail per tx (native first, otherwise ERC-20), so a transaction cannot be double-counted across rails.
- **Native vs pinned token (R4-M2):** a native leg always works, even when the pin is configured. An ERC-20 fact without a pin fails closed. A pin must match exactly.
- **Nits verified:**
  - ERC-20 log requires exactly 3 topics and `from == tx.from`, and empty or zero-length `data` is skipped.
  - The `notBeforeMs` check is typeof-guarded.
  - `decimalToMicro(expected.amount)` is inside the try.
  - `checkMilestoneInputs` rejects non-object entries.
  - A malformed `ARC_SETTLEMENT_USDC_TOKEN` with `REQUIRE_VERIFY=1` throws at startup, and a missing chain id warns.
  - Heal reuses the fetched agreement row.
  - FOR_BUYER with a COMPLETED leg returns INVALID_STATE before any writes.
- **Emitter buffers:** each `buffer()` returns its own queue, so concurrent atomics do not cross-contaminate events. Only the serialized append is shared.

## Round-4 status

- **R4-H1: PARTIAL.** The read-only mirror is close to exact (missing `reviewNote`, M-2). But the safety net is unsound: the revert bricks the milestone (H-1), reverts a sibling-committed approval (H-2), the gate throws after approve outside the revert scope (M-1), and there is an OPEN-intent exposure window (M-5).
- **R4-M1: CONFIRMED-FIXED.** `getChainId()` (falling back to `client.chain.id`, then undefined, which fails closed on the missing fact) replaces the echo.
  - It detects misconfiguration, such as a wrong-network RPC, but it is no stronger than the configured pin against a malicious RPC. That RPC controls the tx, receipt, block number and chain id together.
  - The real mitigation there is a trusted or pinned endpoint, or multi-RPC quorum.
  - The boot probe is warn-only and fire-and-forget. A fatal boot error under `REQUIRE_VERIFY=1` is optional hardening, since per-call comparison already fails closed. Prefer a readiness gate over a crash-loop on transient RPC failure.
- **R4-M2: CONFIRMED-FIXED** with the missing-`token` gap in M-6.
- **R4-M3: CONFIRMED-FIXED** for the milestone CAS. The intent and leg CAS asymmetry is in Nits.
- **R4-M4: PARTIAL.** `requireOperator`, a mandatory reason, the AdminAction, a closed idempotent branch and the route schema are all present. But the audit is post-effect, the evidence can be degraded by operator-chosen input while still reporting `auditRecorded:true`, and the evidence is thin (M-4).
- **R4-M5: PARTIAL.** The edge, `reopenMilestone` and the post-commit release work on the happy path. A failed or raced release, or the revert race in H-2, leaves READY stuck with no safe operator recovery (M-3).
- **R4-M6: CONFIRMED-FIXED.** `number | null` end to end, the gate maps null to 409, and the completion pass skips on null. (Ordering issue is M-1.)
- **R4-M7: CONFIRMED-FIXED** for a single process. The WeakMap does not leak and is not stale across distinct Database objects. Residuals are the multi-instance fork and head-of-line blocking (Nits).
- **Round-4 nits:** CONFIRMED-FIXED, except the symmetric intent and leg CAS silent skips noted above.

---

## Remediation status (devin, commit pending)

### H-1 — FIXED (revert no longer bricks the milestone)
- `state-machines.ts`: intent + leg `CANCELLED→OPEN` edges (revert-reopen only).
- `milestone-approve.ts` doApprove: an existing CANCELLED intent is RE-OPENED
  (CANCELLED→OPEN intent + legs, `intent.reopened`/`leg.reopened` events,
  same intentId) instead of conflicting on the unique milestone slot.
  An intent carrying a COMPLETED/FAILED leg still fails CONFLICT —
  operator repair, not silent reopen.
- Regression: `re-approve after revert re-opens the cancelled intent`.

### H-2 — FIXED (revert is verdict-aware + intent-pinned)
- `submission-review.ts` catch: re-reads the submission before reverting.
  - ACCEPTED (sibling verdict committed) → revert skipped entirely.
  - REJECTED/REVISION_REQUIRED → `revertApproval(..., release:true)`:
    APPROVED→PENDING + submissionRef cleared in one CAS (new machine
    edge), so the resubmission round can rebind — no stuck READY.
  - still SUBMITTED → revert to READY as before.
- `milestone-revert.ts`: `opts.intentId` pins the cancel to the intent
  the gate itself created (`gate.intentId` now captured from the
  approve result); a foreign intent row ends the revert as a no-op.
- Regression: foreign-intentId guard + release-to-PENDING tests.

### M-1 — FIXED (nothing after the approve can throw)
- `review-settlement.ts`: `pendingCount` computed BEFORE the approve
  call — the post-approve section cannot throw, so no stray
  APPROVED+OPEN outside the revert's scope.

### M-2 — FIXED (mirror complete)
- `submission-review.ts`: `assertSummary(reviewNote)` now runs BEFORE
  the gate — the atomic's check set is fully mirrored (buyer, SUBMITTED,
  task status, agreement ACTIVE, note).

### M-3 — FIXED (safe operator exit exists)
- NEW `forceReopenMilestone` (milestone-force.ts): audited READY→PENDING
  release for stuck milestones — requireOperator + reason + AdminAction
  (REOPEN_MILESTONE, reasonSha256 + prefix in degraded evidence),
  idempotent on non-READY.
- NEW route `POST /admin/settlement/milestones/:id/reopen`
  (settlement-admin-milestones.ts — split under 300-line cap).
- ACKNOWLEDGED: the lazy-heal variant (bind a READY milestone whose
  rejected submissionRef is dead) not implemented — the admin route +
  revert-release cover the realistic cases; submit-side heal deferred.
- Regression: route test (PENDING unbind + audit + guards + idempotent).

### M-4 — FIXED (reason serialized-bound + evidence enriched + logged)
- `milestone-force.ts`: reason via `checkSerialized` (raw 4000-char
  cap could expand past the 4 KB evidence row → degraded audit).
- Evidence: +buyerWallet, providerWallet, amountUsd, fromStatus,
  boundSubmissionRef, reasonSha256; degraded minimal keeps
  reasonPrefix(200) + reasonSha256.
- `logger.error` on audit failure; idempotent branch returns
  `alreadyApproved:true` instead of bare auditRecorded:false.
- NOT changed (documented tradeoff): audit stays post-effect — the
  platform pattern (effect first, auditRecorded flag surfaces failure);
  a pre-write would fabricate an audit for a failed effect.

### M-5 — FIXED (paid-leg guard in revert)
- `milestone-revert.ts`: when the intent carries a COMPLETED/FAILED
  leg, the revert is refused — milestone stays APPROVED, nothing
  cancelled, `milestone.revert_blocked` event flags operator attention.
- Regression: paid-leg block test.

### M-6 — FIXED (token fact mandatory under pin)
- `verify-payout-tx.ts`: `expected.token` set + `check.token` missing →
  "token" joins the missing-facts list → TX_UNVERIFIED.
- Regression: missing-token-fact spec test.

### Nits addressed
- `dispute-service.ts`: lost intent CAS and lost leg CAS in the freeze
  loop now throw SettlementConflictError too (R4-M3 symmetry).
- `events.ts`: 15 s timeout per queued append — a hung store call can
  no longer stall the shared serialized queue (head-of-line).
- `milestone-revert.ts`: emits `leg.cancelled` per cancelled leg.
- `submission-review.ts`: revert guarded on `settleMilestoneId !==
  undefined` (type nit).

### Nits acknowledged / not changed
- Hash-chain multi-instance fork (single-process serialization only).
- Post-commit flush ordering vs commit order across atomics.
- Dispute resolve completed-leg SPLIT-over-remaining + OPEN-list cap.
- WeakMap ctx staleness on swapped store; unbound-path plan heal in the
  gate (heal happens in findMilestone/pendingCount callers); hard-coded
  18/6 decimals in the adapter; native rail = one rail per tx (safe
  direction); operator label self-declared.
