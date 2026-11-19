# Review Findings — a2a-settlement R4 (EPIC-227)

## Scope

Round-4 re-verification of the R3 fixes plus a fresh pass over the changed code. I read every file in the supplied set end to end: the settlement domain (`types`, `invariants`, `state-machines`, `events`, `verify-payout-tx`, `verify-payout-tx-viem`, all `services/*`), the commerce side (`settlement-bridge`, `submission-service`, `submission-review`, `review-settlement`, `offer-accept`, `offer-service`, `state-machines`), `finops/guards`, and the three settlement route files.

Not in the supplied tree, so assumed and not verified: `services/ctx.ts`, `settlement/index.ts`, `receipt.ts`, `routes/settlement/helpers.ts`, `settlement-receipts.ts`, and the store implementations behind `db.settlement.*` and `db.commerce.*`. Several conclusions depend on these:

- `atomic()` is a real database transaction.
- `applyStatus()` is a conditional `UPDATE ... WHERE status = from`.
- The emitter is shared per process, not per request.

Nothing was compiled or run: no typecheck, no tests, no fork run. This is a static review.

The eight probes are answered inline and tagged [P1] to [P8].

## Verdict

**REQUEST CHANGES**

No Critical findings. Nine of the eleven R3 findings hold up (see Round-3 status). The R3-H3 fix (approve before the verdict commits) introduces one new High: the settlement approve now runs before any commerce precondition is checked, and nothing undoes it when the commerce step fails. After a REJECT, a repeat ACCEPT returns an error but leaves the milestone APPROVED with an OPEN payout intent.

The verifier is real and fails closed, but its chain pin is not enforced, and its token pin makes the native rail unusable. There are also five Mediums on freeze races, audit gaps and liveness. None of these lets an outsider take funds. They are correctness and operability defects on the payout-authorization path. Fixing R4-H1 and R4-M1 to R4-M4 should be enough to reach APPROVE WITH NITS.

## Critical

None.

## High

### R4-H1: The review gate approves before it checks the review is valid, and nothing undoes the approve

Files: `review-settlement.ts:21-118`, `submission-review.ts:58-61, 67-109`

`resolveSettlementGate` approves the milestone (a committed payout intent). It never checks that the submission is still `SUBMITTED`, that the agreement is `ACTIVE`, that the task is under review, or that the caller is the task buyer. Those checks run later, inside the commerce atomic section, after the approve has committed.

Deterministic repro, no race needed:
1. The buyer REJECTs submission S1, which is bound to milestone M. Nothing touches M, so it stays `READY`.
2. The buyer (or a stale tab, or a client retry) sends ACCEPTED on S1.
3. The gate reads S1 without looking at its status. It finds M `READY` and calls `approveMilestone`. M becomes `APPROVED` with an OPEN intent.
4. The commerce atomic then throws "submission is REJECTED, already reviewed", so the caller gets an error.

The same happens when the agreement is no longer `ACTIVE`, and in any concurrent ACCEPT versus REJECT race on one submission.

Consequences:
- A failed request leaves a lasting payment authorization. The invariant "payable intent implies accepted submission" is broken.
- There is no compensating path. `APPROVED` has no edge back to `READY`, and the only exit is a dispute resolved FOR_BUYER.
- Nothing in the settlement store records that the verdict never committed, so an operator cannot tell the milestone is "approved but unaccepted".
- Before authorization, any signed wallet can call review on any submission id. The gate then runs `findMilestone`, which can heal or create the plan. It can also run the `submitMilestone` heal, and it returns milestone status in its 409 text.

[P2] The intent is "payable blind". Mark-paid is operator-only and requires a real matching tx, so no outsider can extract funds. But the operator has no signal that the verdict failed, so this is an escalation of an error into a payment authorization, not an acceptable design.

[P3] If review A approves M and its verdict fails, a second submission cannot bind M. Submit requires `PENDING` (`submission-service.ts:172`), so it returns 400, and auto-bind skips APPROVED milestones. That fails closed and double-approve is impossible (milestone CAS plus the unique intent). But M is then permanently unbindable. A later unbound submission can complete the agreement, with M paid on the buyer's earlier, error-returning ACCEPT.

Fix: run the read-only commerce preconditions before the approve, as a pre-read of the same checks the atomic runs. Those are buyer identity, `submission.status === SUBMITTED`, agreement `ACTIVE`, and task `UNDER_REVIEW` or `SUBMITTED`. The gate should also refuse to heal or approve for a non-buyer. Longer term, make "verdict committed" the gate for the intent: either create the intent after the commerce commit with APPROVED as the resume state, or record a `verdictPending` marker on the milestone and add an APPROVED to READY revert edge for the failure path.

## Medium

### R4-M1: The payout verifier's chain pin only echoes configuration

Files: `verify-payout-tx-viem.ts:99`, `register.ts:133-136, 175-181`

The adapter reports `chainId: opts.chainId ?? client.chain?.id`. `register.ts` passes `opts.chainId`, so the reported value always equals the expected value. The cross-check in `verifyLegTx` is a tautology and nothing observes which chain the RPC actually serves.

The chain id and the RPC client come from different sources. The id comes from `arcChainFor(bstock?.arcNetwork ?? net.chain.caip2)` and the client from `publicClient(resolveVenueNetwork())`. If those diverge, a tx from another network that satisfies payer, payee and amount verifies as an Arc payout.

Fix: call `client.getChainId()` once at startup, throw on mismatch, and report the observed id (or compare per call).

### R4-M2: Setting the USDC token pin breaks the native rail

Files: `verify-payout-tx-viem.ts:105-113`, `payout-service.ts:171`, `verify-payout-tx.ts:217-226`

The native rail reports `token: "native"`. `markLegPaid` always passes `token: deps.usdcToken` as the expected token. When `ARC_SETTLEMENT_USDC_TOKEN` is set, every native payout fails with "verifier reports token native, expected 0x...". When it is unset, the ERC-20 rail can never match, because the asset is then the log address and not "USDC".

The two rails therefore cannot coexist, although the code, docs and R3-H1 text say they do. Both outcomes fail closed. The failure is an operational trap on Arc, where native is the main rail.

Fix: make the token check conditional (`check.token === "native"` is acceptable on a leg that allows native), or pass the pin only to the ERC-20 branch.

### R4-M3: The dispute freeze loop ignores a failed CAS

Files: `dispute-service.ts:176-217`, `resolve-apply.ts:44-60`

[P5] The ordering is right. The plan CAS (ACTIVE to DISPUTED) is the authoritative serializer. The earlier same-subject and plan-wide dedupe reads are only a fast path and are safe to run first. A CAS null returns INVALID_STATE correctly. The `freeze.milestones` map records the live `m.status` and its CAS is guarded, so a milestone that was read as `PENDING` but is `READY` at write time is recorded correctly. This holds only if `applyStatus` is a conditional `UPDATE`.

The gap: when the milestone CAS returns null (`d` falsy), the code silently skips recording it. It then still runs the intent-freeze block, which re-reads the intent.

Race: `doApprove` commits between the raise's re-read and its CAS.
- The milestone ends `APPROVED`, not `DISPUTED`.
- Its brand-new intent and legs get frozen.
- The milestone is not in `freeze.milestones`, but its intent is in `freeze.intentIds`.
- On FOR_BUYER, `resolve-apply` cancels the intent and legs but not the milestone, because `prev === undefined`. The milestone is stranded `APPROVED` with a CANCELLED intent, and nothing can move it forward. `forceApproveMilestone` then returns it as "idempotent ok".
- For a MILESTONE-subject dispute whose subject milestone lost the CAS, a FOR_BUYER resolution is a silent no-op.

Fix: if the CAS is null, re-read and retry, or throw `SettlementConflictError` to roll back. Never freeze an intent whose milestone you did not freeze.

### R4-M4: Operator force-approve has weak audit and no linkage to commerce state

File: `milestone-approve.ts:168-225`, route `settlement-admin.ts:200-257`

[P6] Plan `ACTIVE`, milestone `READY` and no OPEN milestone dispute are not sufficient guards on their own.

- **Rejected work.** An operator can force-approve a milestone whose submission was REJECTED. That milestone stays `READY` (see R4-M5), so it passes all three checks. Settlement cannot see commerce state.
- **No operator validation.** There is no `requireOperator`, no `normalizeOperator`, and no reason or evidence. The label goes into the event's `actorWallet` field as a raw string, capped only at 128 characters and non-empty.
- **No AdminAction.** Unlike mark-paid and resolve, a buyer-bypassing, payout-authorizing action writes no append-only AdminAction and returns no `auditRecorded`. Its only trace is a best-effort post-commit event (see R4-M7), which can be lost.
- **Misleading idempotence.** A milestone that is already `APPROVED` returns `ok` with the existing intent id, even when that intent is CANCELLED or COMPLETED.
- **Bypassed policy.** It bypasses `releasePolicy` by design. Plan and offer intake now reject EVALUATOR_VERDICT, so only legacy rows are affected.

Fix: run `requireOperator`/`normalizeOperator`, require a reason, and write `recordPostEffectAudit` with `submissionRef`, `milestoneId` and `planId`. The idempotent branch should verify the intent is OPEN.

### R4-M5: A rejected bound submission can never be resubmitted against its milestone

Files: `submission-service.ts:136-177`, `milestone-service.ts:80`, `settlement-bridge.ts:164-171`

A bound submission moves the milestone `PENDING` to `READY`. A REJECT or REVISION_REQUIRED verdict never reverts it. The resubmission round (D-224-9) then cannot work:
- A new bound submit needs `PENDING`, so it returns 400.
- An unbound resubmit is accepted only for pending count 1, since a READY milestone is excluded from auto-bind. Its review never approves M, so the agreement never completes.
- The only exits are R4-M4's force-approve, or R4-H1's accidental re-ACCEPT.

This predates R3, but R3-H2 and R3-H3 made it load-bearing. Fix: allow `submitForReview` and the submit-time check to rebind a `READY` milestone whose current submission is no longer `SUBMITTED`, or add a `READY` to `PENDING` reset edge on a REJECT/REVISION_REQUIRED verdict.

### R4-M6: The R3-H2 "unpaid completion" still reopens when plan creation fails

Files: `settlement-bridge.ts:100-125, 177-180`, `review-settlement.ts:35-41`

- `pendingMilestoneCount` returns 0 when no plan exists (`if (!plan) return 0`). The unbound review path calls it without healing.
- `ensurePlan` goes through `settled()`, which swallows typed failures. Examples are a `BAD_INPUT` from a price that fails `assertAmount`, or any non-throwing `createPlan` failure.
- The result: no plan exists, `openMilestones` returns `[]`, the submission is unbound, and the review reports `pendingAfter = 0`. The agreement and task complete with nobody paid, and the buyer benefits.
- The same fail-open applies to the M-1 `completeAgreementIfClear` pass.
- A store outage during submit is not affected, because that throws and aborts the submit. The hole is a non-throwing, repeatable `ensurePlan` failure.

Fix: when `ctx.settlement` is wired and no plan exists, the gate must throw a conflict. `pendingMilestoneCount` should signal "no plan" instead of 0.

### R4-M7: Events are now emitted only after commit and are lost on a crash

Files: `events.ts:51-71`, all atomic sections

[P4] The mechanics hold:
- The buffer is FIFO and `flush()` drains it in call order through the emitter queue.
- Every settlement atomic (`createPlan`, `doApprove`, `markLegPaid`, `raiseDispute`, `resolveDispute`) buffers its emits.
- `rollupIntent` takes the same buffer.
- Failures roll back by throwing, and the flush is gated on `res.ok`, so nothing is flushed from a rolled-back section.
- No settlement emit inside an atomic writes straight through. The only direct `ctx.emit.emit` calls are outside atomics: `transitionMilestone`, the anchor request, and the anchor drain.

Stale-flush check: in every duplicate return (`createPlan` dedupe, `raiseDispute` same-subject dedupe) the return happens before the first `buf.emit`, so no stale queue is flushed. This is by construction, not by guard. A later `return ok(...)` after a `buf.emit` would flush events for a no-op. A `return fail(...)` after writes would commit those writes and silently drop their events. Neither occurs today.

What is new, and the downside of the M-2 fix:
- A crash between commit and flush leaves state with no event, for example a paid leg with no `leg.completed`. The previous design leaked phantom events. The new one leaks missing events, and `emit()` swallows all append errors.
- Ordering across concurrent requests follows flush order, not commit order. Serialization holds only if the emitter instance is shared. Per-call `createSettlementCtx(getDb())`, as in the bridge, may create one per request. If so, concurrent flushes on one entity can read the same previous hash and fork or drop an event.

Fix: confirm the emitter is a process singleton, or give the event store a unique `(entityType, entityId, prevHash)` constraint and retry. State in the docs that the event stream is best-effort. Do not derive receipts or audit conclusions from it.

## Nits / Suggestions

**Verifier (`verify-payout-tx-viem.ts`)**

[P1] Launder analysis, all fail-closed:
- A tx that is both a native transfer and carries ERC-20 logs reports only the native facts, with the ERC-20 logs ignored. If `tx.to` is not the payee, it fails, which is a false negative, not a launder.
- `tx.to === null` (contract creation) skips the native rail. Only pinned-token logs can match, and the payer pin requires the treasury to be the deployer, so there is no abuse.
- A native transfer to a contract payee is fine.
- Native 18-decimal values with a non-zero digit past 6dp throw in `decimalToMicro` (caught, so TX_UNVERIFIED), which means exact-micro payments only.

Remaining gaps:
- `tx.input` is not checked, so a contract payee that bounces `msg.value` still reads as "paid".
- ERC-20 logs are not checked for `from == payer`.
- Internal native transfers via a Safe, batch contract or 4337 bundler are not seen. A contract-wallet treasury therefore cannot verify, because the payer is the bundler.
- `BigInt(log.data)` on `"0x"` throws for ERC-721-shaped logs when `usdcToken` is unpinned. Require `topics.length === 3`.
- The first matching log wins, so a duplicate transfer fails closed.
- Decimals 18 and 6 are literals, not read from `@/onchain-facts`.

Confirmations: `Number(latest - blockNumber) + 1` is at least 1 on a consistent node. A lagging `getBlockNumber` gives 0 or less, which fails closed with a misleading "confirmations>=1" message. It is a transient DoS, not a bypass. The threshold is hard-wired to 1 (acceptable under Arc's deterministic finality; make it configurable).

[P1] `notBeforeMs` is always set. `markLegPaid` passes `intent.createdAtMs`, and `doApprove` always sets it to `Date.now()`. The check uses `!== undefined`, so a nullable legacy `createdAtMs` of `null` would fail open. Use `typeof === "number"`.
- Block timestamps have second resolution while `createdAtMs` is in milliseconds. A payout in the same second as the intent can be falsely rejected.
- Server clock skew versus chain time shifts the window slightly.
- Split legs created by SPLIT inherit the intent's original `createdAtMs`, not their own.
- Same-amount payouts from the treasury to the same payee carry no per-leg reference, so a tx from the same payee/amount can be attributed to any matching leg that predates it. This is an operator-error risk, not an outsider attack.

**`register.ts`**

[P8] Construction order is correct: `usdcToken` is validated before `createViemPayoutVerifier`. A malformed `ARC_SETTLEMENT_USDC_TOKEN` only logs and disables the pin, even under `ARC_SETTLEMENT_REQUIRE_VERIFY=1`. That should be fatal there, as the treasury wallet already is.
- `chainId` unset with REQUIRE_VERIFY off silently drops to manual attestation. Log a warning.

**`decimalToMicro` (`guards.ts:209`)**

[P8] The new ">6dp refuse to truncate" branch is dead code. `isDecimalString` (`DECIMAL_RE` allows `\d{1,6}`) already rejects any longer fraction before the branch is reached. The behavior did not change, and there is no regression in `sumDecimals`, `feeOf` or `decimalSub`. The R3-M6 premise that these paths "truncated" did not hold in the first place. `verifyLegTx` line 185 calls `decimalToMicro(expected.amount)` outside its try/catch. It is safe only because leg amounts are validated at creation.

**Review gate and events**

- `ctx.settlement!.approveMilestone` in the gate is not wrapped. A thrown store error escapes as a 500, not the typed 409 claimed.
- The gate treats an `undefined` result as success (`ap && !ap.ok`).
- The post-commit resync can call `approveMilestone` on a now-DISPUTED milestone and only log a warning.
- Commerce atomics still write events straight through (`offer-accept.ts:133,157`, `submission-service.ts:197`), so a rolled-back accept leaves a phantom `agreement.created` event. This is the same class as R3-M2, outside its settlement scope.
- A concurrent duplicate dispute raise now returns 409 INVALID_STATE, not the documented `duplicate:true`. After a failed plan CAS, re-read the subject's disputes and return the OPEN one.
- `completeAgreementIfClear` throws on an illegal task edge (for example a CANCELLED task). The error is caught and logged, and the agreement stays ACTIVE.

**Snapshot and offers**

[P7] Legacy agreements (no `payload.milestones`) now read as canonical "full" in both `verifyAgreement` and `healedPlan`. A pre-M-5 agreement with a multi-milestone offer and no plan row, whose accept-time `ensurePlan` failed, would heal to a single "full" milestone. Re-posting the correct multi-milestone plan to `/plans` would be FORBIDDEN.
- This is real only for agreements that are ACTIVE at deploy time and have no plan. It is theoretical if R2/R3 never shipped.
- Backfill `agreements.payload.milestones` from the offers before deploy, or fall back to the offer row when the snapshot is absent.
- `checkMilestoneInputs` has no object guard on entries (`checkLegTemplate` does). `milestones: [null]` throws a TypeError, which is a 500 at offer submit and accept, not a typed 400.
- Offers with `milestones: []` or `EVALUATOR_VERDICT` now fail at accept, while `verifyAgreement` treats an empty array as absent. Existing PENDING offers with those shapes become un-acceptable and must be rejected.
- `byCodePoint` compares UTF-16 code units, not code points. It is deterministic and total on both sides, so the vector is still canonical. Rename it or fix the comment.

**Disputes and anchors**

- FOR_BUYER on an intent that already has COMPLETED legs cancels the intent and milestone with money out. The immutable-leg check exists only for SPLIT. Consider the same guard.
- `stillOpen` uses `list({limit: 1000})`. One-OPEN-dispute-per-plan makes it moot except for legacy rows.
- One participant can DISPUTE the whole plan via a milestone dispute and block every other milestone's approvals and submissions until an operator resolves. This is existing behavior and a griefing vector.
- `drainSettlementAnchors` skips silently when a drain is in flight, so a row enqueued mid-pass waits for the next trigger.
- If the memo send succeeds but `markAnchored` throws, the retry sends a second memo tx.

## Verified-good

- **[P1] Verifier is fail-closed.**
  - A status other than success, a missing tx or receipt, an RPC throw, or a missing `getBlock` all return `verified:false`.
  - `getBlock` or `getBlockNumber` throws are caught in `verifyLegTx` and become PROVIDER_ERROR, not 500.
  - Payer pinning in `verifyLegTx` stops a third-party tx from satisfying a leg.
  - REQUIRE_VERIFY without an adapter, or without a payer pin, throws at startup.
- **R3-H1 wiring.** `register.ts` assigns `deps.verifyTx`, `chainId`, `expectedPayer`, `usdcToken` and `requireVerification`. The admin route forwards all of them from the shared `deps` object.
- **R3-M3 error mapping.** `SettlementConflictError` is caught at all five settlement atomic boundaries, including inside `applyFreezeResolution`.
- **Plan-level safety nets.**
  - `rollupIntent` gates on the live milestone before writing the intent and returns MOVED. `markLegPaid` throws to roll back.
  - Plan completion is a `plans.applyStatus(ACTIVE to COMPLETED)` CAS, so it cannot complete a DISPUTED plan.
  - `doApprove` has an intent-conflict pre-check, a throw on a failed intent or leg insert, and a unique intent per milestone.
- **R3-H2 binding.**
  - Auto-bind picks only the sole PENDING milestone, and more than one returns 400.
  - Bound refs are resolved per plan and must be PENDING.
  - The unbound review path counts the whole plan (READY and DISPUTED count as pending, APPROVED does not).
  - Bound-but-unresolved refs, DISPUTED milestones and CANCELLED milestones all fail the review with a 409 and no approve.
- **[P4] Event ordering and duplicate paths.** Covered under R4-M7. There is no stale-queue flush in any duplicate path today.
- **[P8] Extractions.** `dispute-scope.ts` and `resolve-apply.ts` are faithful extractions. `review-settlement.ts` has no new behavior except what R4-H1 and R4-M6 describe. `rollup.ts` header and logic agree. `stillOpen` is scoped by `payload.planId`, and FOR_BUYER now yields CANCELLED only when all milestones are cancelled, COMPLETED when released work exists.
- **EVALUATOR_VERDICT** is rejected at plan create (`checkMilestoneInputs`), at offer submit, and at offer accept.
- **Replay and txHash.** The leg txHash is bound set-once under per-intent and per-tx locks, with a unique `(network, hash)` replay check.

## Round-3 status

- **R3-H1 (no VerifyPayoutTx adapter wired): PARTIAL.** The adapter is real, wired and fail-closed, and startup throws on misconfiguration. The chain pin is a self-echo (R4-M1), and the token pin disables the native rail (R4-M2).
- **R3-H2 (unbound submission completes unpaid): PARTIAL.** Auto-bind and plan-wide counting work (`submission-service.ts:136-154`, `review-settlement.ts:35-41`). The plan-missing fail-open remains (R4-M6).
- **R3-H3 (swallowed post-commit approve): PARTIAL.** The approve now precedes the verdict, the 409 is typed, APPROVED is a resume state and the operator route exists. But approve-before-validation is a new High (R4-H1), and force-approve has weak audit (R4-M4).
- **R3-M1 (concurrent reviews strand agreement): CONFIRMED-FIXED.** The IN_PROGRESS to COMPLETED edge is in `commerce/state-machines.ts:23` and `completeAgreementIfClear` runs post-commit (`submission-review.ts:196-213`). It does throw on an illegal task edge, which is caught and logged (Nits).
- **R3-M2 (phantom events on rollback): CONFIRMED-FIXED for settlement.** All five atomic sections buffer and flush after commit, only on success. Lost events on a crash are a new tradeoff (R4-M7). Commerce atomics still write through (Nits).
- **R3-M3 (throws become HTTP 500): CONFIRMED-FIXED.** The sentinel is caught at every settlement atomic boundary.
- **R3-M4 (plan-wide dedupe race): CONFIRMED-FIXED.** The plan CAS is the first write (`dispute-service.ts:164-174`). One gap: the freeze loop does not handle a lost milestone CAS (R4-M3). The fix relies on the store doing a conditional UPDATE.
- **R3-M5 (bad offer milestones brick agreement): CONFIRMED-FIXED.** `checkMilestoneInputs` runs at offer create and in the accept tx, the snapshot is written to `agreement.payload`, and verify and heal read the snapshot. Leftovers: null entries throw a TypeError, and legacy agreements default to "full" (Nits).
- **R3-M6 (verifier hardening): PARTIAL.** The token pin exists, chainId normalization works, and network compare is case-insensitive. The `decimalToMicro` change is dead code with no behavior change, and the token pin breaks the native rail (R4-M2).
- **R3-M7 (`milestoneVector` throws on offer JSON): CONFIRMED-FIXED.** The try/catch returns FORBIDDEN (`register.ts:104-122`), and empty arrays are treated as absent. Offer intake still rejects `milestones: []`, a minor inconsistency.
- **M-8 (counterparty re-raise after resolve): ACKNOWLEDGED, not re-tested.** With one OPEN dispute per plan now enforced by CAS, the exposure is limited to re-raising on the same plan after resolution.
- **Nits:**
  - JSON-row vector: fixed.
  - Code-point comparator: deterministic but really UTF-16 order.
  - `stillOpen` scoped to the plan: fixed.
  - FOR_BUYER all-cancelled gives CANCELLED: fixed.
  - Resolve emits only on CAS success: fixed.
  - `rollup.ts` header: fixed.
  - Review awaits wrapped: PARTIAL (the gate's `approveMilestone` call is unwrapped).
  - Anchor drain guard: fixed in-process, with a skipped-drain liveness gap.

---

## Remediation status (devin, commit pending)

### R4-H1 — FIXED (approve-gate now prechecked; raced approve reverts)
- `review-settlement.ts`: `resolveSettlementGate` runs a read-only mirror of the verdict atomic's preconditions — buyer identity → submission `SUBMITTED` → task `UNDER_REVIEW|SUBMITTED` → agreement `ACTIVE` — BEFORE any settlement call (heal, submit-retry, approve). A stranger/rejected/closed review now 4xxs with zero settlement side-effects. The approve call itself is guarded → typed 409, and an empty result is not success.
- `submission-review.ts`: when the gate's OWN approve landed but the verdict atomic fails, `revertApproval` undoes APPROVED→READY + cancels the OPEN intent (+legs). `gate.approvedByUs` ensures a raced sibling's approval is never reverted.
- `milestone-revert.ts` (new): CAS-only atomic, idempotent (non-APPROVED → no-op), buffered events.
- `state-machines.ts`: APPROVED→READY edge added (bridge/operator-only).
- Regression: `commerce-settlement-r4.test.ts` — REJECT→stale-ACCEPT mints no intent; stranger review 403s untouched; `settlement-lifecycle.test.ts` — revertApproval state assertions.

### R4-M1 — FIXED (chain id observed, not echoed)
- `verify-payout-tx-viem.ts`: `PayoutTxSource.getChainId` added; the adapter reports `await client.getChainId()` (falling back to `client.chain.id`, then undefined → missing-fact fail in verifyLegTx). The expected compare is now a real cross-check.
- `register.ts`: boot-time `client.getChainId()` probe logs an error on divergence; the per-call compare still fails closed.

### R4-M2 — FIXED (token pin no longer breaks native rail)
- `verify-payout-tx.ts`: `check.token === "native"` is always an acceptable rail (Arc's gas token IS USDC); an ERC-20 token fact with NO pin configured is unverifiable → TX_UNVERIFIED; with a pin it must match exactly.
- Regression: native + pin verifies; unpinned-ERC-20-fact fails.

### R4-M3 — FIXED (freeze CAS failure aborts the dispute)
- `dispute-service.ts`: a lost milestone CAS throws `SettlementConflictError` → the whole atomic rolls back (no stranded APPROVED+CANCELLED). The intent freeze is gated on the milestone actually being frozen by THIS dispute (`freeze.milestones[m.id]`).
- Nit fixed too: a failed plan CAS re-reads the subject's disputes and returns the documented `duplicate:true` shape when a competing dispute won.

### R4-M4 — FIXED (operator force-approve hardened)
- `milestone-approve.ts`: `requireOperator` + `normalizeOperator`, mandatory `reason`, optional `submissionRef`; every landed effect writes `FORCE_APPROVE_MILESTONE` via `recordPostEffectAudit` (evidence: milestoneId, planId, agreementRef, intentId, reason, submissionRef) and returns `auditRecorded`.
- Idempotent branch returns ok only while the intent is OPEN; CANCELLED/COMPLETED → INVALID_STATE.
- `settlement-admin.ts`: body schema `{operator, reason, submissionRef?}`; `KNOWN_ACTIONS` extended.
- Regression: reason/operator/audit/CANCELLED-intent coverage in `settlement-lifecycle.test.ts`.

### R4-M5 — FIXED (rejected submission releases its milestone)
- `state-machines.ts`: READY→PENDING edge added.
- `milestone-service.ts`: `reopenMilestone` — idempotent READY→PENDING + clears `submissionRef`.
- `review-postcommit.ts` (new): post-commit `postCommitSettlementSync` releases the bound milestone on REJECT/REVISION_REQUIRED.
- Regression: reject → PENDING → resubmit rebinds → ACCEPT completes.

### R4-M6 — FIXED (no-plan is null, never "0")
- `settlement-bridge.ts`: `pendingMilestoneCount` returns `number | null` — null = no plan = "cannot prove payable state".
- `review-settlement.ts`: `pendingCount` maps null → typed 409; `review-postcommit.ts`: the M-1 pass skips completion on null.
- Regression: wrapped bridge (null pending) → review 409, submission stays SUBMITTED.

### R4-M7 — PARTIAL (emitter now a per-DB singleton)
- `settlement/index.ts`: `createSettlementCtx` caches one ctx per `Database` (WeakMap) — every route/bridge caller shares the same serialized emit queue; concurrent flushes can no longer fork a stream's prevHash.
- Remaining residual (documented): a crash between commit and flush loses events, and `emit()` swallows append errors — the event stream is best-effort, never the state of record. A unique (entityType, entityId, prevHash) constraint would harden this but needs a DB-package republish — deferred.

### Nits addressed
- viem adapter: ERC-20 log requires exactly 3 topics (ERC-721 has 4); the Transfer `from` must equal `tx.from` (a third-party transfer to the payee can't launder); `log.data === "0x"` skipped; `typeof notBeforeMs === "number"`.
- `register.ts`: malformed `ARC_SETTLEMENT_USDC_TOKEN` + `REQUIRE_VERIFY=1` → startup throw; missing chain id → warn.
- `verify-payout-tx.ts`: `decimalToMicro(expected.amount)` moved inside the try (malformed expectation → TX_UNVERIFIED, not 500).
- `invariants.ts`: `checkMilestoneInputs` rejects non-object entries (`milestones: [null]` → typed 400, not TypeError).
- `dispute-resolve.ts`: FOR_BUYER with a COMPLETED leg → INVALID_STATE (same immutable-leg guard as SPLIT).
- `plan-terms.ts`: `byCodePoint` comment corrected (UTF-16 code units — canonical order, not a Unicode claim).
- `review-postcommit.ts`: resync only approves a still-READY milestone (DISPUTED is left to the dispute path).
- `review-settlement.ts`: heal path reuses the gate's already-fetched agreement row.

### Nits acknowledged / not changed
- `tx.input` unchecked on the native rail (contract payee bouncing value) — operator-attested rail; documented.
- Block-timestamp second-resolution vs ms intent creation — same-second false reject possible, retry-acceptable.
- Split legs inherit the intent's `createdAtMs` — by design.
- Same-amount/same-payee leg ambiguity — operator-error risk, not outsider attack.
- Commerce atomics still emit straight through (phantom `agreement.created` on rollback) — commerce-scope residual, same class as R3-M2; deferred.
- Legacy agreements without `payload.milestones` read as canonical "full" — pre-M-5 deploy edge; theoretical if R2/R3 never shipped.
- One-participant milestone dispute griefs the whole plan — existing design; resolver SLAs mitigate.
- `drainSettlementAnchors` skipped-drain liveness + double-send on markAnchored failure — in-process guard documented.
- 18/6 decimals as literals in the adapter — readable, pinned to Arc+USDC.
