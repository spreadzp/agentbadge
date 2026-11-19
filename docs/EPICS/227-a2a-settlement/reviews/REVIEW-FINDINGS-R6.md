# Review Findings — a2a-settlement R6 (EPIC-227)

## Scope

Re-verification of the eight Round-5 fixes and their nits, plus a probe of the code those fixes changed. Files read in full:

- `milestone-approve.ts`, `milestone-revert.ts`, `milestone-force.ts`, `milestone-service.ts`
- `submission-review.ts`, `review-settlement.ts`, `review-postcommit.ts`, `submission-service.ts`
- `settlement-bridge.ts`
- `dispute-service.ts`, `dispute-resolve.ts` (resolve guards), `resolve-apply.ts`, `dispute-scope.ts`
- `payout-service.ts`, `rollup.ts`
- `state-machines.ts`, `events.ts`, `ctx.ts`, `index.ts` (WeakMap ctx cache)
- `verify-payout-tx.ts`, `verify-payout-tx-viem.ts`
- `settlement-admin.ts`, `settlement-admin-milestones.ts`, `register.ts`, `helpers.ts`
- `admin-actions.ts`, `guards.ts`, `invariants.ts` (constants)

Not available, so not verified:

- `route-helpers.ts` and any test files. Neither was in the provided set (the route `helpers.ts` is reviewed). Coverage of the new edges is unconfirmed.
- `finops/types.ts` (`EVIDENCE_MAX_BYTES`). The audit row cap is taken as 4 KB from the `guards.ts` and `admin-actions.ts` docs.
- Store implementations (CAS and isolation semantics are inferred from usage).

## Verdict

**REQUEST CHANGES** (narrow). 0 Critical, 0 High, 6 Medium.

All eight Round-5 items landed in code and the primary scenarios they target are fixed. R5-H1 (approve reopen), R5-M1, R5-M2, R5-M3, R5-M5 and R5-M6 are confirmed. R5-H2 and R5-M4 are only partly closed.

The remaining Mediums sit on money paths:

- **M1:** the new reopen path can revive legs that a dispute SPLIT cancelled, which would double-allocate a milestone. The trigger is narrow, but the invariant is broken in code.
- **M2:** the verdict-aware revert still decides on a non-atomic read and fails open on a lookup error. The same Round-5 outcome (ACCEPTED, COMPLETED agreement, READY milestone, CANCELLED intent) is reachable through a narrow window and is silent.
- **M3 to M6:** an audit-degrade bound that does not bind, a hash-chain fork under the new emitter timeout, an invisible `revert_blocked` signal, and a RELEASED dead-end in the review gate.

None is a one-request exploit by a stranger. Each is a small, local patch. A Round-7 pass on M1, M2 and M6 should be enough to converge.

## Critical

None.

## High

None.

## Medium

### M1. Reopen revives every CANCELLED leg, including legs a dispute SPLIT cancelled (double-allocation)

**Status: REMEDIATED — the reopen path no longer revives ANY cancelled leg. `doApprove` now re-opens the intent row but mints fresh legs from the milestone template (`milestone-approve.ts`); old CANCELLED legs stay as the audit trail, so OPEN legs can never sum past the milestone amount. Mixed/foreign leg states can't join the payable set by construction. Regression: `settlement-lifecycle-force.test.ts` 're-approve never revives cancelled legs (R6-M1 double-allocation)'.**

`milestone-approve.ts:103-116` flips every leg that is `CANCELLED` back to `OPEN`. It does not check why the leg was cancelled. The same intent row is reused by SPLIT (`resolve-apply.ts:367-404`), which does the following:

- cancels the old FROZEN legs,
- inserts the new split legs on the same intent,
- sets the intent back to `OPEN`,
- sets the milestone to `APPROVED`.

Sequence that reaches the bug:

1. A request's gate approves milestone M. This creates or reopens intent X, and the gate captures `approvedByUs` and `intentId`.
2. A dispute is raised and resolved SPLIT. Milestone M is APPROVED again, and X is OPEN with the old legs CANCELLED and the split legs OPEN.
3. The first request's verdict atomic fails and its catch calls `revertApproval`.
   - The pin `intentId === X` passes (see M2).
   - No leg is paid, so the revert goes through. It sets the milestone to READY, X to CANCELLED, and the split legs to CANCELLED.
4. The next approve calls `doApprove`. `existing` is X and no leg is COMPLETED or FAILED. The reopen loop then flips both the old full-amount legs and the split legs to OPEN.

Result: intent X is OPEN with the old allocation (for example 100) plus the split allocation (for example 40 and 60). `markLegPaid` and `rollupIntent` have no sum invariant against `milestone.amountUsd`. An operator who pays each OPEN leg pays the milestone twice.

Trigger likelihood is low. A dispute plus an operator resolve must fall inside one request's gate-to-catch window. Impact is overpayment, and the invariant "reopen only restores what the revert cancelled" is not enforced anywhere. A future caller of `revertApproval`, such as a sweeper, would hit it far more easily.

Related gaps in the same loop:

- **Mixed leg states.** A leg that is `FROZEN` or `OPEN` under a CANCELLED intent is not reopened but still joins `legIds` (lines 103-116). That produces an OPEN intent with a FROZEN leg. Mark-paid refuses non-OPEN legs and unfreeze only acts on FROZEN intents, so the leg is stuck.
  - I found no path that creates this state. FOR_BUYER cancels the intent and its frozen legs together, and the revert only cancels OPEN legs.
  - Hard-fail it anyway: abort with CONFLICT if any leg is not CANCELLED.
- **Empty leg list.** A CANCELLED intent with zero legs reopens to an OPEN intent with no legs.

Fix:

- Tag legs cancelled by the revert, for example `payload.cancelledBy = "approval_revert"` plus the intent id.
- Reopen only legs carrying that tag.
- Return CONFLICT if the leg set contains any untagged CANCELLED leg, any `payload.splitOf` leg, or no legs.
- As a backstop, run `checkLegTemplate` or a sum-equals-`amountUsd` check over the legs that will be OPEN before committing.

### M2. Verdict-aware revert still decides on a non-atomic read, and fails open on a read error

**Status: REMEDIATED (3 of 3 fixes landed). (1) A failed re-read is treated as UNKNOWN — the revert is skipped with an error log, leaving the documented resume state. (2) `doApprove` stamps a per-cycle epoch into `milestone.escrowRef` (`appr_<uuid>`); the gate captures it as `approvalToken` and `revertApproval` compares it inside its atomic — a dispute-restored APPROVED (which re-stamps the token in `resolve-apply.ts`) or a foreign cycle is refused. (3) Reconciler: after a landed revert the catch re-reads the submission once; if the sibling verdict committed ACCEPTED in the gap, it heals by re-approving (M1-safe reopen). Residual: the cross-store window can't fully close without a saga; the operator path (force-approve) is documented.**

`submission-review.ts:192-219`.

The re-read of the submission and the `revertApproval` call are two separate operations. They span two stores, `stores` (commerce) and `db.settlement`, so no atomic can cover both.

- **Window not closed.** A sibling ACCEPT can commit after the re-read returns SUBMITTED and before the revert's settlement atomic runs.
  - `revertApproval` only CASes `APPROVED→READY`. A committed verdict does not move the milestone, so the CAS succeeds.
  - Result: ACCEPTED submission, COMPLETED agreement, READY milestone, CANCELLED intent. This is the Round-5 H2 outcome.
- **Partial self-heal.** The post-commit resync (`review-postcommit.ts:264-281`) re-approves a READY milestone, and the reopen path now makes that heal work. It only helps if the revert lands before the resync's `findMilestone` read. The other interleaving is not healed. It is also silent: no event or alert marks it.
- **Realistic trigger.** The first request's verdict atomic fails after winning the submission CAS, for example on a later CAS or a transient store error. Its rollback releases the row lock, and the second concurrent ACCEPT then commits. The first request's re-read can run before that commit.
- **Fail-open on read error.** `stores.submissions.getById(...).catch(() => null)` makes `sub` null.
  - The condition `sub?.status === "ACCEPTED"` is then false, so the code proceeds to revert to READY.
  - The ambiguous case is a commit that landed but whose acknowledgement was lost, where the same outage also fails the re-read. The revert then undoes an approval a committed ACCEPT needs.
  - Post-commit resync does not run in that case, because the request threw.
- **The `intentId` pin is vacuous.** R5-H1 made reopen reuse the same intent row, so every approval cycle on a milestone has the same `intentId`. The check `intent.id !== opts.intentId` (`milestone-revert.ts:292-298`) can now only fire if a second intent row exists. The unique-per-milestone slot prevents that. It cannot tell this request's approval from a sibling's later approval.

Fix, in order of cost:

1. Treat a failed re-read as "unknown" and skip the revert.
   - Log at error level.
   - Leaving APPROVED with an OPEN intent is the documented resume state, and a retried review completes it.
2. Pin the revert to an approval epoch, not an intent id.
   - Return a per-cycle token from `doApprove`: the `milestone.approved` event id, or a counter or timestamp stored on the intent payload.
   - Make `revertApproval` compare it inside its atomic.
3. Add a reconciler for "ACCEPTED submission, milestone READY, intent CANCELLED". It can call `doApprove`, which reopens. Alternatively, rerun the ACCEPT resync once after a short delay.

### M3. R5-M4 bound does not bind: the reason can still push evidence into the degraded payload

**Status: REMEDIATED — force reasons now cap at 2000 SERIALIZED bytes (`MAX_FORCE_REASON`), leaving room for the ~600-900 B of forensic context in the 4 KB row. `submissionRef` is bounded by `checkSerialized` (256) in the core, and both submission refs moved INTO the minimal fallback payload so nothing unique is lost on degrade. Route schemas aligned to `reason.max(2000)`.**

`milestone-force.ts:290` caps `reason` at `checkSerialized(..., MAX_REASON_FIELD)`, and `MAX_REASON_FIELD` is 4000. The route also accepts `reason.max(4000)`.

The full evidence object (`milestone-force.ts:387-400`) adds many other fields next to the reason:

- ids: `milestoneId`, `planId`, `agreementRef`, `intentId`
- `reasonSha256` (64)
- `submissionRef` and `boundSubmissionRef`
- `amountUsd`
- `buyerWallet` and `providerWallet` (42 each)
- `fromStatus` and the key names

Fixed overhead is roughly 600 bytes with normal values. Operator-supplied `submissionRef` (max 128 raw, up to about 770 serialized with control characters) and a 128-character `milestoneId` raise it further.

- Any reason over about 3400 serialized bytes, or about 2600 with a hostile `submissionRef`, exceeds the 4 KB row.
- `recordPostEffectAudit` then writes the degraded minimal payload (`milestoneId`, `outcome`, `intentId`, a 200-character reason prefix and the hash).
- That minimal payload drops both wallets, the amount, `fromStatus`, `boundSubmissionRef`, `agreementRef`, `planId` and the operator-supplied `submissionRef`.
- Most of that can be rejoined through `intentId`. The two submission refs cannot.

So an operator-chosen reason length still decides how much forensic context survives, which is the original finding. The same applies to the reopen audit (`milestone-force.ts:450-465`).

Fix:

- Cap `reason` to a budget that leaves room, for example 2000 serialized bytes.
- Run `checkSerialized` on `submissionRef` too (about 256).
- Or include `submissionRef` and `boundSubmissionRef` in the minimal payload so nothing unique is lost.

### M4. Emitter timeout can fork a stream's hash chain, and the failure is invisible

**Status: REMEDIATED — a timed-out append now poisons the entity stream: its promise is kept in `stale` and the next emit on the same `(entityType,entityId)` awaits it before re-reading prevHash, so the chain can't fork. Timeouts/failures log at error level; the timer is `clearTimeout`ed. Store-level `(entity,prevHash)` uniqueness remains the documented multi-process residual.**

`events.ts:348-364`.

`Promise.race` rejects after 15 s, and `this.tail` then resolves. Nothing cancels the underlying `append()`.

- That append has already read `prevHash` through `listByEntity`. It may still run `events.append` later.
- The next queued emit on the same entity starts immediately. Its `listByEntity` does not see the in-flight row, so it reads the same `prevHash`.
- Both rows are written with the same `prevHash`. That is a chain fork, and the code has no uniqueness or verification to catch it.
- The case that triggers the timeout, a slow store call that eventually completes, is the case that forks.

Related problems:

- `.catch(() => null)` swallows every failure and timeout with no log, so dropped or forked events leave no trace.
- The 15 s `setTimeout` is never cleared. Each emit leaves a live timer for 15 s. This holds the event loop on shutdown and wastes memory under load.

Fix:

- Make a timed-out append poison the entity stream. For example, record the entity id as "needs re-read", or make the next emit re-list and verify the tail hash after a short wait.
- Better, have the store reject a duplicate `(entityType, entityId, prevHash)`.
- Log timeout and failure at error level, and clear the timer.

### M5. `revert_blocked` has no alert path, and the revert outcome never reaches a caller

**Status: REMEDIATED — `revertApproval`'s `{reverted}` now crosses the bridge (`revertApproval` returns `res.value`), the review catch logs at error level when a revert is refused (`approval stands`), and `revertApproval` itself logs `paid_leg_present` / unexpected-intent-state refusals at error level in addition to the event.**

`milestone-revert.ts:303-315`.

The only signal that a revert was refused because a leg is paid is a best-effort `milestone.revert_blocked` event.

- `revertApproval` returns `ok({ reverted: false })`.
- The bridge (`settlement-bridge.ts:233-238`) wraps it in `settled()`, which only logs on failure, and returns `Promise<void>`.
- The review catch (`submission-review.ts:207`) never sees `reverted`.

So the state "approval stands, paid leg present, submission SUBMITTED, verdict failed" produces no log, alert or `AdminAction`. It only produces an event, and M4 explains why that event can be dropped silently. The related "`reverted: false` because the intent is foreign" case is also silent.

Fix:

- Return `reverted` through the bridge.
- Have the catch log at error level, or raise an operator alert, when `reverted === false` and `approvedByUs`.
- Log inside `revertApproval` when it emits `revert_blocked`.

### M6. Review gate dead-ends on a RELEASED milestone (SUBMITTED submission can never be accepted)

**Status: REMEDIATED — `resolveSettlementGate` accepts RELEASED as a resume state alongside READY/APPROVED (initial check + recheck); the verdict commits without re-approving, and `pendingCount` already excludes RELEASED so the agreement completes. Regression: `commerce-settlement-r4.test.ts` 'a RELEASED milestone lets the verdict commit'.**

`review-settlement.ts:121-149`.

Only READY and APPROVED count as resume states.

- If the milestone is already RELEASED when a SUBMITTED submission is reviewed, the gate throws a conflict ("is RELEASED, not READY").
- Only REJECT can commit.
- The state "approval stands, verdict not committed" looks exactly like a legitimate approved milestone to an operator. That includes the cases where the revert failed (M5) or the revert was skipped on re-read failure (M2).
- If the operator pays it, it rolls up to RELEASED. The submission is then permanently un-acceptable and the agreement stays ACTIVE.

Fix:

- Treat `RELEASED` with a COMPLETED intent as a resume state when the submission is SUBMITTED. Skip the approve, commit the verdict, and keep `pendingAfter` from `pendingCount`.
- Alternatively, distinguish "approval pending verdict" for operators by marking the intent or milestone payload.

## Nits / Suggestions

1. **Revert paid-leg guard is not atomic with the cancel** (`milestone-revert.ts:299-361`). The legs are listed once for the guard and listed again for the cancel loop.
   - A mark-paid on a multi-leg intent can commit a leg between those reads. The intent is then CANCELLED with a COMPLETED leg and a READY milestone, which is the operator-repair state.
   - Re-list after the intent CAS and throw `SettlementConflictError` if any leg is COMPLETED or FAILED.
2. **Revert silently skips the intent when the CAS fails** (`milestone-revert.ts:334`, `if (cancelled)` with no else).
   - The milestone moves to READY or PENDING, but the intent stays in its old state. That is the "READY with an OPEN intent" state asked about in item 4.
   - I found no concurrent interleaving that produces it, because the dispute freeze and the rollup both contend on the milestone row first.
   - Make a failed intent CAS throw, so the whole revert rolls back.
3. **Revert only guards OPEN intents.**
   - If the milestone is APPROVED and the intent is COMPLETED or FROZEN (neither is reachable today), the revert still moves the milestone.
   - Refuse unless the intent is OPEN or CANCELLED, or absent.
4. **`forceReopenMilestone` is READY-only with no intent guard** (`milestone-force.ts:438`).
   - READY with an OPEN intent is not reachable under the current invariants. READY with a CANCELLED or absent intent is the normal post-revert state.
   - Add a defensive check that refuses when an OPEN or FROZEN intent exists. Otherwise a future bug would strand an OPEN intent. `markLegPaid` does not check milestone status, but rollup then returns MOVED, so the leg would roll back.
   - Reopening a READY milestone whose bound submission is still SUBMITTED is undone by the next review's PENDING-heal (`review-settlement.ts:126-138`). Say so in the endpoint docs.
5. **`reason` can be invisible.** `checkForceInput` only checks `trim().length > 0`. A reason made of zero-width or combining characters passes as "mandatory evidence". Apply a letter-or-digit test like the operator label has (`requireOperator`).
6. **`submissionRef` on force-approve is unvalidated in the core.** Only the route's zod `max(128)` guards it. A direct caller can pass any string into the event payload and the audit row. It is also never compared to `milestone.submissionRef`. Run `checkField` or `checkSerialized` in `checkForceInput`.
7. **The idempotent force-approve branch is ambiguous.** It returns `auditRecorded: false` with `alreadyApproved: true` and writes no audit row, so consumers that alert on `auditRecorded: false` will misfire. A second operator's attempt leaves no trace. Consider a separate response flag, or audit replays.
8. **Shared `operatorBody` for reopen.** The reopen route accepts `submissionRef` and silently ignores it. Use a stricter schema.
9. **Release on reject is not compare-and-release** (`review-postcommit.ts:253-255`, `reopenMilestone`).
   - It does not check `milestone.submissionRef === rejectedSubmission.id`. A late post-commit release can unbind a newer submission's READY milestone.
   - The gate's PENDING-heal repairs this at the next review, so impact is low.
   - There is no stale re-resolution of the old rejected submission's `milestoneRef`. The gate rejects any non-SUBMITTED submission before any settlement call, and the post-commit sync only runs for the submission being reviewed.
10. **Window between a reject verdict and a delayed release.** After a REJECT commits, the task returns to IN_PROGRESS but the milestone can still be APPROVED (the other request's pending revert) or READY. A provider resubmission in that window cannot bind the milestone and is stored unbound. It is recoverable, but wasteful. Release inside the same flow, or retry the release.
11. **Dispute freeze leg-list read** (`dispute-service.ts:219-233`, item 7).
    - A multi-leg intent can have a leg COMPLETED by a mark-paid that committed between the intent CAS and the list read. That leg is skipped silently. No abort is needed: the onchain payment already happened, and `resolveDispute` already blocks FOR_BUYER and SPLIT when any leg on a frozen intent is COMPLETED (`dispute-resolve.ts:110-127`).
    - For a single-leg intent, the rollup CAS contends on the intent row, returns MOVED, and rolls the leg back.
    - Record `paidLegIds` in the dispute payload at freeze time so the resolver sees it.
12. **CANCELLED→OPEN edges are generic** (`state-machines.ts:430-443`). `isTerminal` now returns false for CANCELLED intents and legs, and `resolve-apply.ts` does not consult `isLegalTransition`. Legality still depends on caller discipline (`doApprove`). A dispute-cancelled intent can only reach `doApprove` through a READY milestone, and FOR_BUYER makes the milestone CANCELLED, which is terminal, so I found no path. Keep the edge, but note the dependency in a comment, and consider the tag from M1.
13. **Event order across buffers.** The shared tail serialises appends, but order between two buffers' flushes follows flush call order, not commit order. Two sequential commits on one entity can land in the chain inverted. The chain is intact but the history can read out of order. Consider a commit sequence number carried in the buffer.
14. **Multi-instance hash chain.** The `ctxCache` WeakMap (`index.ts:96`) fixes per-process forking, but only when `getDb()` returns a stable `Database` object. A fresh wrapper per call would silently bypass it. It does nothing across processes. A store-level uniqueness constraint on `(entityType, entityId, prevHash)` would close this and M4 together.
15. **Audit action enum.** Confirm `REOPEN_MILESTONE` is accepted by the `adminActions` store column or enum, not only by the `KNOWN_ACTIONS` set in `admin-actions.ts`. A store rejection after the effect lands would show up only as `auditRecorded: false`.
16. **`resolve-apply.ts` ignores some CAS results** (milestone `DISPUTED→CANCELLED`, leg cancels, leg reopens). Pre-existing, no regression. Worth checking in a later pass.

## Verified-good

- **R5-M1 ordering.** `resolveSettlementGate` computes `pendingCount` (lines 153-156) before `approveMilestone`. After `approvedByUs = true` (line 174) nothing can throw. The gate itself still runs outside the revert's `try`. A thrown approve call is therefore treated as "no approval landed", and the approve is a single atomic, so an error return means nothing committed.
- **R5-M2 mirror.** `assertSummary(reviewNote)` runs before the gate (`submission-review.ts:54-56`). Together with the buyer, SUBMITTED, task and agreement checks, the mirror now matches the atomic.
- **R5-M5 paid-leg guard.** A COMPLETED or FAILED leg on an OPEN intent makes the revert leave the milestone APPROVED and cancel nothing. The `revert_blocked` event is emitted inside an atomic that returns ok, so it flushes.
- **R5-M6.** `expected.token` set with `check.token` missing adds "token" to the missing-facts list. The viem verifier reports `token` on both rails (`"native"` and the contract address), so this does not break the native rail. A `"native"` report is accepted even when an ERC-20 pin is set. That is deliberate, because Arc gas is USDC (`verify-payout-tx.ts:220-224`).
- **R5-M3 route and audit.** `forceReopenMilestone` is operator-gated and requires a reason. It is READY-only and idempotent otherwise. It writes `REOPEN_MILESTONE`, and the response reports `auditRecorded`. The route mounting is correct: `r.route("/", settlementMilestoneAdminRoutes(deps))` registers absolute paths once, `register.ts` mounts only `createSettlementAdminRoutes`, and `adminAuth` is applied per route.
- **R5-M3 `checkForceInput`.** The extraction in `milestone-force.ts` is behaviour-preserving for both callers: operator check, reason presence, then the serialized cap. The casts are type-safe because the error codes are in `SettlementErrorCode` and `STATUS_BY_CODE`.
- **R5-H1 reopen, plain case.**
  - It runs inside one atomic. The milestone CAS and the intent and leg CASes are all-or-nothing, with a throw on any lost CAS.
  - It refuses when any leg is COMPLETED or FAILED, and it returns the same `intentId`.
  - The `reopened` events are buffered and flushed after commit.
- **Dispute-cancelled intents cannot be reopened by approve.** FOR_BUYER cancels the milestone, which is terminal (`isLegalTransition("milestone", "CANCELLED", "APPROVED")` is false). `doApprove` rejects first, and `forceApproveMilestone` requires READY.
- **SPLIT leg restoration is bounded to the frozen set.** SPLIT requires the milestone to have been APPROVED (`dispute-resolve.ts:78-82`), so a milestone that was never payable cannot be forced to APPROVED. M1 is a reopen problem, not a resolve problem.
- **Release revert.** APPROVED→PENDING with `submissionRef: null` is a single CAS and clears the binding. A rejected submission keeps its `milestoneRef`, but nothing re-resolves it (see nit 9).
- **Dispute freeze nits.** The freeze loop throws `SettlementConflictError` on a lost intent CAS and on a lost leg CAS. The whole atomic rolls back, and `fail` maps the code.
- **Revert `leg.cancelled` events** are emitted per cancelled leg. The revert call is guarded on `settleMilestoneId !== undefined`.
- **`ctxCache`.** One emitter per `Database` is correct for the single-process case, and `createCommerceSettlementBridge` goes through `createSettlementCtx`.

## Round-5 status

- **R5-H1: PARTIAL.** Re-open works for the plain revert case (`milestone-approve.ts:68-144`, same `intentId`, events emitted). It also reopens legs a SPLIT cancelled (M1) and tolerates mixed leg states.
- **R5-H2: PARTIAL.** The ACCEPTED re-read skip and the REJECTED `release:true` revert work (`submission-review.ts:192-219`). The re-read is non-atomic and fails open on error, and the `intentId` pin is vacuous after reopen (M2).
- **R5-M1: CONFIRMED-FIXED.** `pendingCount` runs before the approve (`review-settlement.ts:153`), and nothing after it can throw.
- **R5-M2: CONFIRMED-FIXED.** `assertSummary(reviewNote)` runs before the gate (`submission-review.ts:54-56`), and the mirror is complete.
- **R5-M3: CONFIRMED-FIXED.** `forceReopenMilestone` and the `/reopen` route are audited, reasoned, and idempotent. The READY-only guard has no intent check, so see nit 4.
- **R5-M4: PARTIAL.** The reason is serialized-bounded, evidence carries the new fields, `alreadyApproved` is returned, and loss is logged. The 4000-byte cap exceeds the evidence budget, so the degraded payload is still reachable (M3).
- **R5-M5: CONFIRMED-FIXED.** The paid-leg guard works on OPEN intents with the `revert_blocked` event. See M5 and nits 1 and 3 for gaps around it.
- **R5-M6: CONFIRMED-FIXED.** A missing token fact joins the missing list (`verify-payout-tx.ts:146-150`).
- **R5 nits:**
  - Dispute freeze CAS throws: CONFIRMED-FIXED.
  - Emitter append 15 s timeout: PARTIAL (present, but a timed-out append can still land and fork the chain, M4).
  - `leg.cancelled` per revert leg: CONFIRMED-FIXED.
  - Revert guarded on `settleMilestoneId !== undefined`: CONFIRMED-FIXED.

### Round-6 nit dispositions

- Nit 1 (leg re-list after intent CAS): FIXED — legs re-listed post-CAS; COMPLETED/FAILED → `SettlementConflictError` rollback.
- Nit 2 (silent intent CAS): FIXED — a lost intent CAS now throws; the revert rolls back.
- Nit 3 (OPEN-only guard): FIXED — FROZEN/COMPLETED intent + APPROVED milestone → `reverted:false` + error log.
- Nit 4 (force-reopen intent guard): FIXED — `forceReopenMilestone` refuses when an OPEN/FROZEN intent exists.
- Nit 5 (invisible reason): FIXED — reason must contain a letter/digit (`[\p{L}\p{N}]`).
- Nit 6 (submissionRef unvalidated): FIXED — `checkSerialized(…,256)` in `checkForceInput`.
- Nit 7 (ambiguous idempotent branch): left as-is — `alreadyApproved:true` distinguishes it for consumers.
- Nit 8 (shared reopen schema): FIXED — dedicated `reopenBody` schema without `submissionRef`.
- Nit 9 (compare-and-release): FIXED — `releaseMilestone`/`reopenMilestone` accept `expectedSubmissionRef`; post-commit release passes the rejected submission's id.
- Nit 10 (reject→release window): acknowledged — recoverable via the PENDING-heal; documented.
- Nit 11 (freeze paidLegIds): acknowledged — the resolve path already blocks on COMPLETED legs; recording them in the freeze map is a follow-up.
- Nit 12 (generic CANCELLED→OPEN): kept — legality depends on `doApprove` discipline; noted in the table comment.
- Nit 13 (cross-buffer order): acknowledged — serialised appends keep the chain intact; ordering is flush-order.
- Nit 14 (multi-instance chain): acknowledged — needs store-level `(entity,prevHash)` uniqueness; documented residual.
- Nit 15 (REOPEN_MILESTONE enum): verified — `KNOWN_ACTIONS` includes it and the action column is a free string.
- Nit 16 (resolve-apply CAS results): acknowledged — pre-existing; later pass.
