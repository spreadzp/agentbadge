# Review Findings — a2a-settlement R2 (EPIC-227)

## Scope

Round-2 adversarial re-verification of the Round-1 fixes, plus a probe of the changed code for new defects. Paths are relative to `server/src/server/`.

Read in full:
- `lib/settlement/`: `types`, `state-machines`, `invariants`, `verify-payout-tx`, and `services/{ctx,plan-service,milestone-service,payout-service,dispute-service,dispute-resolve,rollup}`.
- `lib/settlement/receipt.ts`: the M6 region only.
- `routes/settlement/{settlement,settlement-admin,settlement-receipts,helpers,register}.ts`.
- `lib/commerce/settlement-bridge.ts` and `lib/commerce/services/submission-review.ts`.

Not read: `anchor.ts` and the commerce store, submission, and accept services. The `atomic()` implementation, `guards.ts`, and `withLock` were not provided either.

Anything that depends on those is marked "unverified" below. Finding IDs use the prefix R2-. Line numbers are per file.

## Verdict

**BLOCK**

Most Round-1 fixes are real at the library level: rollup, M1 guards, M8, M11, M12/M15, and the hoisted SPLIT and approve checks. But several fixes either do not reach production or move the failure somewhere worse.

- **H5 is dead in prod.** `register.ts:85` mounts the admin routes with no deps. `verifyTx`, `requireVerification`, `chainId` and `expectedPayer` are never wired, so every mark-paid is blind operator attestation.
- **C1 is only half closed.** `verifyAgreement` binds the parties and the total, but not the milestone or leg structure. A participant can still author the payout contract.
- **H6 can deadlock agreement completion.** It also fails open to "complete the agreement, pay nobody".
- **The write-then-fail class is not eliminated.** Three sites remain, including a permanent freeze with no dispute row.
- **Overlapping disputes lose arbitration outcomes.** AGREEMENT and MILESTONE disputes on the same milestone interfere with each other.

Each is a money-path correctness or fund-lock problem, and some are reachable by a single honest-looking participant. Do not ship until R2-H1 to R2-H6 are addressed.

> **Round-2 remediation applied** — all six High findings fixed with regression tests (14 new cases across settlement-lifecycle/-disputes/-payouts + commerce-settlement); M-A/C/D/E/H fixed; M-B/F/G/I documented as residuals. Statuses annotated inline.

## Critical

None new. C1 drops from Critical to High (R2-H1) because the party and total forgery is closed. The remaining forgery needs a participant role and an operator who pays by the plan.

## High

**R2-H1: C1 is only partially closed. Milestone, leg and policy forgery survives `verifyAgreement`.** — **RESOLVED r2** (seam now compares the full milestone vector — ids, amounts, releasePolicy, leg payee/role/amount multiset — against the offer's canonical terms; CANCELLED agreements rejected; `samePlanTerms` extended to the same vector so forged dupes CONFLICT instead of adopting)

- `routes/settlement/register.ts:33-60` compares only buyer, provider and total against the commerce agreement.
- `createPlan` then stores the caller's `milestones[]` verbatim. That includes `milestoneId`, per-milestone `legs[].payee`, `role`, and `releasePolicy`, which is a free enum that accepts `EVALUATOR_VERDICT`.
- `samePlanTerms` (`plan-service.ts:90`) also compares only parties and total.
- So the accept-time `ensurePlan` (`settlement-bridge.ts:87`) returns `duplicate:true` and silently adopts a participant-authored plan. `settled()` only logs failures, so no signal is raised.
- The window is the gap between the commerce agreement commit and the best-effort post-commit `ensurePlan`. It stays open indefinitely if that call failed.
- Buyer-squat scenarios:
  - Use `milestoneId:"zzz"` while the provider submits `milestoneRef:"full"`. `findMilestone` returns null and R2-H5 completes the agreement unpaid.
  - Use `releasePolicy:"EVALUATOR_VERDICT"`. `approveMilestone` always fails and the failure is swallowed.
  - Use a template leg `{payee: buyerAltWallet, role:"PROVIDER", amount: total}`. The plan then pays the buyer's wallet.
- Provider-squat scenario: split into 64 micro-milestones. This gives a buyer-side DoS through H6 and a skewed payout structure.
- `verifyAgreement` also does not check agreement status (CANCELLED or COMPLETED agreements get plans), currency, or any leg-payee relation to the provider.
- Default is fail-open: `verifyAgreement?` is optional in `createPlan` and in `SettlementRouteDeps`. Any mount that forgets it (tests, a second `createSettlementRoutes()` call) is back to the Round-1 hole.
- Fix:
  - Make the seam required in non-test builds, or make standalone mode an explicit opt-in flag.
  - Have the seam return the canonical milestone and leg set, derived from offer terms, and compare against it.
  - Extend `samePlanTerms` to a milestone-vector hash: ids, amounts, policy, and the multiset of leg payees and roles.
  - Constrain leg payees to the provider plus declared collaborators.
  - Better still, remove the public `POST /plans` and let only the bridge create plans.

**R2-H2: The H4/H5 verifier hardening is not wired in production.** — **RESOLVED r2** (`createSettlementAdminRoutes(deps)` now receives the seam deps; `chainId`/`expectedPayer` forwarded to markLegPaid; `PayoutTxCheck.chainId` is a distinct field from the `network` label; `expectedPayer` + `requireVerification` wired from env in register. Residual: no VerifyPayoutTx adapter exists yet — mark-paid stays manual attestation until one is wired, per D-227-4)

- `register.ts:85` calls `createSettlementAdminRoutes()` with no `deps`.
- `settlement-admin.ts:119-120` forwards only `verifyTx` and `requireVerification`. `chainId` and `expectedPayer` are never forwarded to `markLegPaid`, even when deps are supplied.
- `SettlementRouteDeps` (`helpers.ts`) has no `expectedPayer` field. Its `chainId?: number` is the receipt chain id, and `PayoutVerifyDeps.chainId` is `string`. Wiring one into the other is a type error, or a silent `String()` coercion.
- So "chainId + expectedPayer wired" (the R2 claim) is false end to end, and mark-paid is always manual attestation in prod.
- Latent bug for when it is wired: `verifyLegTx` compares the single `check.network` field to both `expected.chainId` (lines 181-188) and `expected.network` (the leg label `"arc"`, lines 190-198). Setting `chainId` makes both can-never-hold, so every verification fails and mark-paid is DoSed.
- Fix:
  - Split the verifier's report into `network` (the label) and `chainId`.
  - Add `expectedPayer` and `chainId: string` to the route deps.
  - Forward all four fields.
  - Set `requireVerification: true` in prod.

**R2-H3: The write-then-fail class survives in three places. `atomic()` has no rollback on a returned error, only on a throw.** — **RESOLVED r2** (all three sites now `throw` so the atomic rolls back: dispute insert conflict after freezes, rollup MOVED after leg completion, intent insert conflict after milestone APPROVED. Dead `getById(newDisputeId())` pre-flight removed)

- **`dispute-service.ts:159-161 and 210-226`.**
  - The "pre-flight" calls `getById(newDisputeId())`, which is a fresh id that is then discarded, because line 211 mints a second `newDisputeId()`. The check can never fail.
  - The only fallible write (`disputes.create` returning null) happens after the milestone, intent, leg and plan freezes. The code then does `return fail("PROVIDER_ERROR")`.
  - The result is milestones, intents and legs frozen, the plan DISPUTED, and no dispute row to resolve.
  - Fix: `throw` on a null insert, or insert the dispute row first with the freeze map patched afterwards.
- **`payout-service.ts:196-224`.**
  - `payoutLegs.complete` writes the txHash set-once, then `rollupIntent` may return `"MOVED"` (`rollup.ts:42`) and the service does `return fail`.
  - Dispute raise and resolve take no `settle-intent` lock, only the atomic. A concurrent raise can freeze the intent in between.
  - That leaves a COMPLETED leg with a bound txHash under a FROZEN intent. A retry returns `TX_REUSED`, and the operator sees an error although the money moved.
  - Fix: `throw` on `MOVED`, or re-validate the intent immediately before the leg write and take the same lock in dispute and approve paths.
- **`milestone-service.ts:176-213`.**
  - `milestones.applyStatus(READY→APPROVED)` is written first.
  - `if (!intent) return fail("INVALID_STATE")` then fires after that write. The pre-check at line 170 narrows the window but does not remove the race.
  - The result is an APPROVED milestone with no intent. Nothing in the state machine can recover it: submit and approve both need PENDING or READY, and a dispute restores to the stored prior status.
  - Fix: `throw` there.

**R2-H4: H6 can leave an agreement ACTIVE and its task IN_PROGRESS forever.** — **RESOLVED r2** (`pendingMilestoneCount` excludes APPROVED — accepted-but-unpaid no longer blocks completion; regression test covers two-milestone accept-before-pay)

- `pendingMilestoneCount` (`settlement-bridge.ts:143`) counts every milestone not in `RELEASED` or `CANCELLED`. That includes `APPROVED`, which means accepted and awaiting manual payout.
- Manual payouts lag acceptance by design (D-227-4). So when the last milestone is accepted before earlier ones are paid, `pendingAfter > 0` and the agreement is not completed.
- Nothing later completes it. `rollupIntent` completes only the settlement plan, and there is no `plan.completed` hook back to commerce. The task then also never completes (`submission-review.ts:328-335`).
- Races make it likelier:
  - Two concurrent accepts of the last two milestones each see the other as pending.
  - A dispute FOR_BUYER that later cancels a milestone never re-triggers completion.
  - `pendingAfter` is read outside the tx (`submission-review.ts:51-63`) and can only go stale-high. A stale zero cannot become positive, but a stale positive is never corrected.
- Fix: count only work not yet accepted (`PENDING`, `READY`, and `DISPUTED` with prior status ≤ READY). Add a post-commit "all milestones accepted" re-check, or a plan-completed callback from the bridge that completes the agreement.

**R2-H5: H6/H7 fail open to "agreement COMPLETED, provider unpaid", with a silent post-commit miss and no retry.** — **RESOLVED r2** (review now 409s before commit when milestoneRef is unresolved or not READY; PENDING heal retries submitMilestone once; findMilestone heal rebuilds the plan from the offer's milestone vector; heal skipped for terminal agreements)

- When `findMilestone` returns null, `pendingAfter` stays 0 (`submission-review.ts:51`). The agreement then completes on any accept whose `milestoneRef` does not resolve.
- A submission with no `milestoneRef` on a multi-milestone plan also completes the agreement, and the plan stays ACTIVE with pending milestones.
- The H7 lazy heal calls `ensurePlan` without milestones, so it can only ever build a single milestone named `"full"`.
  - A multi-milestone agreement whose accept-time `ensurePlan` failed gets a `"full"` plan.
  - Every `milestoneRef` ≠ `"full"` then resolves to null, and the commerce agreement completes unpaid.
  - The wrong plan is now permanent: a later correct `ensurePlan` is `duplicate:true`.
- `found.status` is never checked before the commerce verdict commits. If the milestone is DISPUTED, PENDING (the bridge `submitMilestone` failed), or `EVALUATOR_VERDICT`, the post-commit `approveMilestone` fails and is swallowed.
  - `reviewSubmission` is then terminal for that submission (`status` is no longer `SUBMITTED`).
  - The settlement routes expose no approve endpoint.
  - The provider is never paid.
- Fix:
  - Fail the review (409) before commit when `milestoneRef` is present but unresolved, or the milestone is not READY.
  - Persist the milestones from the offer terms so heal can rebuild the exact plan.
  - Add a reconcile or retry for accepted-but-not-approved milestones.

**R2-H6: Overlapping AGREEMENT and MILESTONE disputes silently drop or invert arbitration outcomes.** — **RESOLVED r2** (plan-wide OPEN-dispute dedupe inside the atomic — a second subject on the same plan → INVALID_STATE, so freeze maps always cover what they own)

- The freeze map is owned by the first dispute that froze a row. The second dispute on the same milestone, `raiseDispute` with a different subject type, finds the milestone already DISPUTED and the intent FROZEN, so it freezes nothing and records an empty map. Dedupe is per `(subjectType, subjectRef)` only (`dispute-service.ts:112-116 and 144-148`).
- Order 1, AGREEMENT dispute B open and then MILESTONE dispute A raised:
  - A's `FOR_BUYER` resolves as RESOLVED but is a no-op, because `prev === undefined` (`dispute-resolve.ts:147-152`). The milestone stays DISPUTED and the intent stays FROZEN.
  - When B later resolves `FOR_PROVIDER`, the milestone and legs are restored to payable and paid against A's verdict.
- Order 2, MILESTONE dispute A open and then AGREEMENT dispute B raised:
  - Resolving A unfreezes the milestone and intent even though B is still open.
  - H3 protects the freeze from an overlapping dispute only in the reverse direction.
- SPLIT is also rejected on such a dispute, because `freeze.milestones[m.id]` is undefined (`dispute-resolve.ts:82`). It becomes unresolvable via SPLIT.
- Fix: per-row dispute refcount or a `frozenBy[]` set on milestone, intent and leg. Resolve restores a row only when it is the last freezer. Reject resolution of a dispute whose freeze map is empty for its subject. Alternatively, forbid concurrent disputes per plan.

## Medium

- **M-A: `verifyLegTx` gaps.** — **RESOLVED r2** (payer mandatory when expectedPayer pinned; malformed amount → TX_UNVERIFIED not throw; asset compare case-insensitive; chainId mandatory when expected. Residual: no finality threshold beyond confirmations≥1; verified flag still event/audit-only)
  - `payer` is optional, so an adapter that omits it bypasses both the treasury pin and the self-pay guard (`verify-payout-tx.ts:160-179`).
  - `decimalToMicro(check.amount)` runs outside the try block. A malformed adapter amount throws and gives a 500, not `TX_UNVERIFIED`.
  - The asset compare is case-sensitive, so `"usdc"` is rejected.
  - Only `confirmations ≥ 1` is enforced and no finality threshold is pinned.
  - The H4 residual is unchanged: nothing is persisted per leg. `verified` (true or null) lives only in the event payload and the AdminAction evidence, so a receipt cannot distinguish attested from verified.
- **M-B: FOR_BUYER on an intent with a COMPLETED leg.** — documented residual (partially-paid intents cancel; no refund record — reconciliation is ops follow-up)
  - A partially paid intent (leg A COMPLETED, leg B frozen) has its milestone CANCELLED and intent CANCELLED. There is no reconcile or refund record (SPLIT is correctly blocked).
  - Allowing `allTerminal` to flip the plan to COMPLETED, even with zero payout, reports a clean-looking terminal state over partially paid money.
- **M-C: `rollupIntent` ordering.** — **RESOLVED r2** (milestone gated APPROVED→RELEASED before the intent writes COMPLETED; leg.completed emits before intent/milestone/plan events)
  - The intent is written COMPLETED before the milestone is gated (`rollup.ts:42-54`). If the live milestone is not APPROVED (for example DISPUTED), the intent is permanently COMPLETED and the milestone can never reach RELEASED, because both resolve branches require a FROZEN intent.
  - This is not reachable through the normal flow, but a read-then-gate-then-write order is safer.
  - The `leg.completed` event is emitted after `intent.completed`, `milestone.released` and `plan.completed`, so the event stream reads backwards.
- **M-D: Review pre-read is unguarded.** — **RESOLVED r2** (lookup failures → typed 409; heal gated to ACTIVE agreements only)
  - `findMilestone` and `pendingMilestoneCount` run before the tx with no try/catch (`submission-review.ts:50-64`).
  - A settlement DB error, or the `this` problem below, throws out of `reviewSubmission` and blocks the buyer's verdict. The docs and file header call this path best-effort.
  - The H7 heal makes a write on a review read path. It runs for any agreement status, including terminal ones.
- **M-E: `this.ensurePlan` in `findMilestone` (`settlement-bridge.ts:122`).** — **RESOLVED r2** (ensurePlan extracted to a local closure — destructuring-safe)
  - It works only when the bridge methods are invoked as `ctx.settlement.findMilestone(...)`.
  - A destructured, spread-and-rebound, proxied or instrumented bridge gives `this === undefined`, a TypeError, and the pre-read crash in M-D.
  - Capture `ensurePlan` in a local closure.
- **M-F: Concurrency assumptions are unverified.** — documented residual (in-memory atomic serializes; PG atomic is a real transaction; in-process intent/tx locks don't span instances — single-instance deployment assumption stands)
  - The H3 "dedupe inside atomic" and "re-read in tx" fixes assume `atomic()` serializes (advisory lock, SERIALIZABLE, or a partial unique index on OPEN disputes per subject). I could not confirm this.
  - `markLegPaid` takes the in-process per-intent and per-tx locks. Dispute raise, resolve, and approve do not, and in-process locks do not span multiple instances.
- **M-G: `resolveDispute` ignores `applyStatus` results.** — open (lower risk: applyStatus failures are silent by design in the restore path; freeze-map scoping r1 narrowed the window)
  - Failed guarded transitions (milestone, intent, leg) are silent, so a dispute can be marked RESOLVED with state unchanged (`dispute-resolve.ts:147-175`).
  - `splitLegs` is persisted as `splitAmounts` for FOR_BUYER and FOR_PROVIDER without sum validation. The route validates only the leg shape.
- **M-H: `verifyAgreement` wiring.** — **RESOLVED r2** (seam resolves the DB via `deps.getDb`; decimalToMicro compare wrapped → typed FORBIDDEN on unreadable stored amounts)
  - It reads `getDatabase()` directly instead of `deps.getDb`, so route tests with an injected DB hit the global one.
  - `decimalToMicro(a.agreedAmount)` on a DB value can throw and give a 500 instead of the typed failure. Unverified: depends on `guards.ts`.
- **M-I: M6 is opt-in only.** — documented residual (verifySettlementReceiptSignature accepts expectedSigner; no in-repo caller verifies — consumers are external)
  - `verifySettlementReceiptSignature(receipt, expectedSigner?)` pins the signer only when the caller passes one, and no caller in the read files does.
  - The cross-field assert (`agreementId`, `issuedAt`, `chainId`) is present.

## Nits / Suggestions

- **OPERATOR_REQUIRED ordering.**
  - The ordering in `settlement-admin.ts:92-110 and 158-176` is correct: operator check first, then `safeParse`.
  - A whitespace-only operator passes the route and is rejected inside the service, which returns the same code.
  - The behaviour on a malformed JSON body depends on `readBody`, which was not provided.
- `verifyLegTx` carries a defensive `!== undefined` after the mandatory-field check, which is now redundant. `normalizeOperator` is applied after the verify step.
- `dispute-service.ts:159`: delete the dead `disputeId` preflight.
- `settled()` in the bridge logs a CONFLICT from `ensurePlan` at warn only. Consider an error-level log or a metric, since a CONFLICT means a forged or stale plan.
- Raising a dispute on any non-terminal milestone has no cooldown or bond. That is a griefing vector, though by design.
- Add property tests for: the overlapping dispute matrix; accept-before-pay across two milestones; the all-cancelled then SPLIT then complete path.

## Verified-good

- **M1.** Submit requires PENDING and plan ACTIVE. Approve requires READY, plan ACTIVE, and no OPEN milestone dispute. The write itself is a guarded `applyStatus(from=READY)`, which closes a race against a concurrent freeze.
- **M8.** All three bodies (`plans`, `dispute`, and both admin routes) use `safeParse` and return 400. `checkLegTemplate` guards non-object entries.
- **M11.** Currency is USDC-only (`plan-service.ts`) and the zero address is rejected in `checkLegTemplate`.
- **M12/M15.**
  - Amount comparison is numeric through `decimalToMicro`.
  - `samePlanTerms` is case-insensitive.
  - A mismatched duplicate returns CONFLICT in both the pre-check and the lost-race branch.
- **H1.**
  - `rollupIntent` excludes CANCELLED legs and requires at least one COMPLETED.
  - FROZEN, OPEN and FAILED legs block rollup, which fails safe.
  - SPLIT then complete reaches intent COMPLETED, milestone RELEASED and plan COMPLETED.
  - An all-CANCELLED intent never rolls up.
- **H2, partial.**
  - SPLIT's completed-leg check runs before any write.
  - `approveMilestone` pre-checks an existing intent.
  - `markLegPaid` re-reads the intent before the leg write.
  - Milestone and leg insert conflicts use `throw`, which aborts the section.
- **H3, partial.** Resolve acts only on the ids in the dispute's own freeze map, and FOR_BUYER cancels only legs in `frozenLegIds`. Raise re-reads milestone status inside the tx.
- **Legs created after a dispute is raised.** The only such legs are SPLIT legs created inside the same dispute's resolve. `approveMilestone` is blocked by milestone status. So post-dispute legs cannot escape a FOR_BUYER cancel.
- **H5, library level.** Mandatory asset, payee, amount, network and confirmations. Numeric amount compare. Payee case-insensitive.
- **Replay protection.** txHash is bound per `(network, hash)`, checked under the tx lock and enforced set-once by `complete()`.
- **Event stream.** `ctx.emit` is awaited inside the atomic section where it matters, so a thrown abort cannot leave later events behind.

## Round-1 status

- **C1: PARTIAL.** Parties and total are bound. Milestones, legs, policy and agreement status are not, the seam is optional and fail-open, and `samePlanTerms` ignores milestones (R2-H1).
- **H1: CONFIRMED-FIXED.** `rollup.ts:34-35` filters CANCELLED, requires every remaining leg COMPLETED, and has a test path through SPLIT.
- **H2: PARTIAL.** Three write-then-return-fail sites remain: `dispute-service.ts:224`, `payout-service.ts:219`, `milestone-service.ts:206` (R2-H3).
- **H3: PARTIAL.** Scoping and in-tx re-reads are real. Overlapping AGREEMENT and MILESTONE disputes drop or invert outcomes, and dedupe isolation is unverified (R2-H6, M-F).
- **H4: PARTIAL.** Verifier fields are mandatory, but there is no per-leg verified flag, payer is optional, and the verifier is not wired in prod (R2-H2, M-A).
- **H5: NOT-FIXED in prod.** `createSettlementAdminRoutes()` has no deps (`register.ts:85`) and the admin route does not forward `chainId` or `expectedPayer`. Wired, the `chainId` and `network` checks contradict each other (R2-H2).
- **H6: PARTIAL.** It no longer completes an agreement on the first accept, but it can now never complete it and also fails open on unresolved milestones (R2-H4, R2-H5).
- **H7: PARTIAL.** `findMilestone` heals a missing plan, but only to a single `"full"` milestone, without a try/catch guard, and with a `this` dependency (R2-H5, M-D, M-E).
- **M1: CONFIRMED-FIXED.** `milestone-service.ts:81-92 and 138-149`.
- **M6: PARTIAL.** The cross-field assert is present. The signer pin is opt-in and unused by callers (M-I).
- **M8: CONFIRMED-FIXED.** `safeParse` returns 400 in `settlement.ts` and `settlement-admin.ts`. Operator ordering is correct.
- **M11: CONFIRMED-FIXED.** USDC-only and zero-address reject.
- **M12/M15: CONFIRMED-FIXED.** Numeric amount compare in `verifyLegTx`, and CONFLICT on mismatched terms.
- **Other Round-1 Mediums (M2 to M5, M7, M9, M10, M13, M14): NOT VERIFIED.** They were not itemised in this round's brief. Items M2 (phantom `plan.completed`) and M4 (terminal-milestone dispute reject) were spot-checked as present.
