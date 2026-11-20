# Prod Verify — EPIC-227 — GAMMA — 2026-11-20

Target: `https://agentbadge.xyz` (v0.16.0, gitCommit `e15919f7`, db up, arc-mainnet RPC up).
Method: external consumer via curl + EIP-191 `agentbadge-commerce:v2` sig-auth (3 ephemeral BOT-TEST-GAMMA wallets) + `X-Admin-Key` for admin surface. All writes used `operator="BOT-TEST-GAMMA"` / BOT-TEST-GAMMA entity labels. No code changes, no commits, no paid on-chain ops.

Synthetic entities created on prod (test residue, labeled):
- Task `ct_c9ac30eebafd44958d0d6d6c` (maxProviders=2, OPEN→IN_PROGRESS)
- Offers `of_053634a25f9b4314822412a3` (prov1), `of_124d68ed0d894f528571a243` (prov2) — both ACCEPTED
- Agreements `ag_8b02b9ed0f6248f3b304aa2a` (buyer+prov1), `ag_497a6f5a278a4f66badad398` (buyer+prov2)
- Plans `mp_6ece1983-220b-4abb-9562-807f6af259c1` (ag1, auto-created at accept), `mp_fac234ea-6f45-42b5-8ec4-ca22a392ad1f` (ag2)
- Milestones `ms_a87462e7-…` (m1, APPROVED), `ms_fa3210d4-…` (m2, APPROVED after dispute)
- Intents `pi_57af9872-…` (OPEN, leg `pl_f97b56f0-…` 0.6 PROVIDER), `pi_eddac63b-…` (OPEN, SPLIT re-leg: `pl_8389c957-…` 0.3 PROVIDER + `pl_2f257835-…` 0.1 COLLABORATOR; original `pl_efe0f302-…` CANCELLED)
- Dispute `dp_977dde1c-9070-41d8-9db5-fec5a50582d4` RESOLVED/SPLIT, `resolvedBy:"BOT-TEST-GAMMA"`
- Submissions `sub_555bea75886e45e6b9539b27`, `sub_602ce6affb354a57b2cb62ab` (both ACCEPTED)

## Verdict: PARTIAL

Every check executable without a paid on-chain op passed clean — zero functional bugs.
The single unreachable leg is a *successful* mark-paid (needs a real Arc USDC transfer to the payee; the wired viem verifier correctly fails closed on fabricated hashes — proven live). Consequently leg→intent→milestone→plan rollup-to-RELEASED, a non-null EIP-712 `artifact`, and a created PENDING anchor row are unexercised.

## Checklist

**A. AUTH-КОНТУР — PASS**
- A1: `POST /admin/settlement/intents/x/mark-paid` no key → 401, `code:UNAUTHORIZED` (not INTERNAL_ERROR), `cache-control: no-store`. PASS
- A2: `POST /admin/settlement/milestones/x/approve` no key → identical 401 envelope + no-store. PASS
- A3: wrong `X-Admin-Key` → identical 401 envelope. PASS
- A4: `POST /api/settlement/plans` no sig → 401 `WRONG_SIGNER`; GET agreements/receipts no sig → 401 `UNAUTHORIZED` "participant signature required". Typed, no 500. PASS
- Bonus: `GET /admin/settlement/plans` (nonexistent path) → 404 `not_found` — correct, admin surface is POST-only.

**B. READS — PASS**
- B1: participant sig → 200 `{plan, milestones[], intents[], legs[], disputes[]}`; non-party sig (prov2 on ag1) → 404 `RESOURCE_NOT_FOUND` (existence oracle); unsigned → 401. Matches routes/OpenAPI. PASS
- B2: `GET /api/settlement/receipts/:agreementId` → 200 `settlement_projection@1` with plan/milestones/intents/legs/disputes, `anchor:null`, `artifact:null`. Deterministic (see E1). PASS
- B3: `/openapi.json` lists exactly the 10 settlement routes implemented (5 admin POST, 5 api). One doc-text nit — see Bugs.

**C. HAPPY PATH — PASS (C3 positive leg constrained)**
- C1: plan auto-created by offer-accept bridge (post-commit `ensurePlan`); `POST /api/settlement/plans` replay → 200 `duplicate:true`; milestones visible in agreement view. PASS
- C2: dispute (prov1 sig) → `frozenIntents:1, frozenLegs:1`, intent FROZEN, milestone DISPUTED, plan DISPUTED; admin SPLIT resolve → 200, old leg CANCELLED, 2 new OPEN legs summing 0.40, intent back OPEN, plan back ACTIVE, `auditRecorded:true`. PASS
- C3: mark-paid missing txHash → 400 `BAD_INPUT`; malformed → 400 `BAD_INPUT`; valid-format nonexistent hash → 400 `TX_UNVERIFIED` ("rpc read failed: Transaction … could not be found") — verifier wired on prod and fail-closed; multi-leg intent without legId → 400 `BAD_INPUT` "legId required — 2 OPEN legs"; nonexistent intent → 404 `NOT_FOUND`; replay → deterministic same TX_UNVERIFIED. Real-tx happy path untestable (paid op forbidden). PARTIAL-by-constraint.
- C4: dispute row `resolvedBy:"BOT-TEST-GAMMA"`; `auditRecorded:true` on the resolve response. (No REST read on AdminAction rows — attribution verified on subject rows.) PASS

**D. NEGATIVE/EDGE — PASS**
- D1: `sum(milestones)≠totalUsd` → 400 `BAD_INPUT`; milestone vector ≠ canonical offer snapshot → 403 `FORBIDDEN` "plan milestone terms do not match the offer"; SPLIT `sum(splitLegs)≠milestone` → 400 `BAD_INPUT`. PASS
- D2: overlong (200-char) dispute subjectRef → 400 `BAD_INPUT` "subjectRef exceeds 128 characters"; blank reason → 400 `INVALID_INPUT`. PASS
- D3: plan replay → `duplicate:true` (200); second OPEN dispute on same milestone → `duplicate:true`, `frozenIntents:0`. PASS
- D4: resolve response carries `auditRecorded:true`. PASS
- D5: all 5 admin POST routes (mark-paid, disputes/resolve, milestones approve/reopen/release) → 401 `code:UNAUTHORIZED` + `cache-control:no-store` without key. PASS
- Bonus: non-participant dispute → 403 `FORBIDDEN`; force-approve on `appr_`-epoch APPROVED milestone → 409 `INVALID_STATE` "already APPROVED by a commerce cycle — no-op force-approve refused" (epoch guard works).

**E. RECEIPT/ANCHOR — PASS**
- E1: receipt GET twice (buyer sig) → byte-identical body (diff clean). `artifact:null` is honest — no COMPLETED leg exists, so no EIP-712 artifact is fabricated. PASS
- E2: anchor POST (admin key) on non-terminal plan → 409 `INVALID_STATE` "anchor requires every milestone terminal with at least one RELEASED"; nonexistent agreement → 404 `NOT_FOUND`; no auth → 401 `WRONG_SIGNER`. No fabricated anchor. PASS

**F. SYNTHETIC FULL-CYCLE — PASS (within no-paid-ops constraint)**
- Ran: task(maxProviders=2) → 2 offers (with `payload.milestones` vector) → 2 accepts → 2 agreements ACTIVE → 2 plans auto-created → provider submits (`milestoneRef` bound) → buyer ACCEPTED → milestone APPROVED + PayoutIntent OPEN + leg → dispute→freeze→SPLIT re-leg → deterministic receipt read. Only the real-payout mark-paid and its downstream RELEASED/artifact/anchor remain untested.

## Bugs found

- **Trivial/doc-nit** — `GET /api/settlement/agreements/{id}` OpenAPI description says "unsigned or non-party callers get 404"; an *unsigned* caller actually gets **401** `UNAUTHORIZED` (non-party signed correctly 404s). The 401 is declared in the route's own `responses` and matches the implementation (`scopedWallet===null → 401`) — description text only. Repro: `curl https://agentbadge.xyz/api/settlement/agreements/any` → 401 vs "404" wording. Severity: cosmetic.
- No functional bugs observed. All error envelopes carry correct `code` fields and status classes; no 500s, no INTERNAL_ERROR on 4xx, no leaked existence oracles.

## Curl log (key responses — sanitized, no secrets)

```
POST /admin/settlement/intents/x/mark-paid            → 401 {"error":"Unauthorized","code":"UNAUTHORIZED"}            cache-control: no-store
POST /admin/settlement/milestones/x/approve           → 401 same envelope                                            cache-control: no-store
POST /admin/settlement/intents/x/mark-paid (bad key)  → 401 same envelope
POST /admin/settlement/disputes/x/resolve (no key)    → 401 same envelope                                            cache-control: no-store
POST /admin/settlement/milestones/x/reopen (no key)   → 401 same envelope                                            cache-control: no-store
POST /admin/settlement/milestones/x/release (no key)  → 401 same envelope                                            cache-control: no-store
GET  /admin/settlement/plans                          → 404 {"error":"not_found",...}
POST /api/settlement/plans (no sig)                   → 401 {"code":"WRONG_SIGNER","error":"valid X-Wallet/X-Sig/X-Timestamp/X-Nonce required"}
GET  /api/settlement/agreements/x (no sig)            → 401 {"code":"UNAUTHORIZED","error":"participant signature required"}
GET  /api/settlement/receipts/x  (no sig)             → 401 same

POST /api/commerce/tasks        (buyer sig)   → 201 {task: ct_c9ac30eebafd44958d0d6d6c, OPEN, maxProviders:2, duplicate:false}
POST /api/commerce/tasks/:id/offers (prov1)   → 201 {offer: of_053634a25f9b4314822412a3, PENDING, payload.milestones preserved}
POST /api/commerce/tasks/:id/offers (prov2)   → 201 {offer: of_124d68ed0d894f528571a243, PENDING}
POST /api/commerce/offers/of_0536…/accept     → 200 {agreement: ag_8b02b9ed0f6248f3b304aa2a ACTIVE, payment pm_… RECORD_ONLY/NOT_PAID}
POST /api/commerce/offers/of_124d…/accept     → 200 {agreement: ag_497a6f5a278a4f66badad398 ACTIVE}

GET  /api/settlement/agreements/ag_8b02… (buyer)      → 200 {plan mp_6ece1983 ACTIVE USDC totalUsd "1",
                                                           milestones [m1 PENDING 0.6, m2 PENDING 0.4], intents:[], legs:[], disputes:[]}
GET  /api/settlement/agreements/ag_8b02… (prov2, non-party) → 404 {"code":"RESOURCE_NOT_FOUND"}
POST /api/settlement/plans (identical replay)         → 200 {plan mp_6ece1983, duplicate:true}
POST /api/settlement/plans (sum 0.6+0.5 vs 1.00)      → 400 {"error":{"code":"BAD_INPUT","message":"sum(milestones.amountUsd) must equal totalUsd (D-227-3)"}}
POST /api/settlement/plans (wrong milestone vector)   → 403 {"error":{"code":"FORBIDDEN","message":"plan milestone terms do not match the offer"}}

POST /api/commerce/agreements/ag_8b02…/submissions (prov1, milestoneRef m1) → 201 {sub_555bea75886e45e6b9539b27 SUBMITTED}
POST /api/commerce/submissions/sub_555b…/review ACCEPTED (buyer)            → 200 {submission ACCEPTED; task IN_PROGRESS; agreement ACTIVE}
GET  /api/settlement/agreements/ag_8b02… (buyer)      → m1 APPROVED (submissionRef bound, escrowRef appr_06c6bb1e…),
                                                        intent pi_57af9872 OPEN, leg pl_f97b56f0 OPEN 0.6→prov1 arc

POST /admin/settlement/intents/pi_57af9872/mark-paid {"operator":"BOT-TEST-GAMMA"}              → 400 BAD_INPUT (txHash required)
POST …/mark-paid txHash:"0xnothex"                                                              → 400 BAD_INPUT "txHash must be a 0x-prefixed 64-hex…"
POST …/mark-paid txHash:0xdeadbeef…(valid format, nonexistent on-chain)                         → 400 TX_UNVERIFIED "rpc read failed: Transaction could not be found"
POST …/mark-paid same fake hash (replay)                                                        → 400 TX_UNVERIFIED (deterministic)
POST /admin/settlement/intents/pi_eddac63b/mark-paid (2 OPEN legs, no legId)                    → 400 BAD_INPUT "legId required — intent has 2 OPEN legs"
POST /admin/settlement/intents/pi_doesnotexist/mark-paid                                        → 404 NOT_FOUND

POST /api/commerce/agreements/ag_8b02…/submissions (prov1, milestoneRef m2) → 201 {sub_602ce6affb354a57b2cb62ab}
POST /api/commerce/submissions/sub_602c…/review ACCEPTED                    → 200; m2 APPROVED, intent pi_eddac63b OPEN, leg pl_efe0f302 OPEN 0.4
POST /api/settlement/milestones/ms_fa3210d4/dispute (prov1)                 → 200 {dispute dp_977dde1c OPEN, frozenIntents:1, frozenLegs:1}
   intent pi_eddac63b → FROZEN; milestone m2 → DISPUTED; plan → DISPUTED
POST same dispute again                                                   → 200 {duplicate:true, frozenIntents:0}
POST dispute as non-participant (prov2)                                   → 403 FORBIDDEN
POST /admin/settlement/disputes/dp_977dde1c/resolve SPLIT splitLegs sum 0.60 → 400 BAD_INPUT "sum(splitLegs.amountUsdc) must equal the milestone amount"
POST /admin/settlement/disputes/dp_977dde1c/resolve SPLIT legs 0.30+0.10     → 200 {dispute RESOLVED/SPLIT,
                                                                                    resolvedBy:"BOT-TEST-GAMMA", resolverRef:"gamma-review-1",
                                                                                    auditRecorded:true}
   post-state: leg pl_efe0f302 CANCELLED; new legs pl_8389c957 (0.3 PROVIDER→prov1) +
               pl_2f257835 (0.1 COLLABORATOR→prov2) OPEN; intent OPEN; m2 APPROVED; plan ACTIVE
POST /admin/settlement/milestones/ms_a87462e7/approve (appr_ epoch)          → 409 INVALID_STATE "already APPROVED by a commerce cycle"

GET  /api/settlement/receipts/ag_8b02b9ed0f6248f3b304aa2a (buyer)  → 200 settlement_projection@1
     {plan ACTIVE, milestones [m1 APPROVED intent+leg, m2 APPROVED intent+3 legs incl. CANCELLED],
      disputes [dp_977dde1c RESOLVED/SPLIT], anchor:null, artifact:null}
GET  same again → byte-identical (diff clean)
POST /api/settlement/receipts/ag_8b02…/anchor (admin key)  → 409 INVALID_STATE "anchor requires every milestone terminal with at least one RELEASED"
POST /api/settlement/receipts/ag_nonexistent/anchor        → 404 NOT_FOUND "settlement plan not found"
POST /api/settlement/milestones/<200-char-id>/dispute      → 400 BAD_INPUT "subjectRef exceeds 128 characters"
POST /api/settlement/milestones/ms_a87462e7/dispute {"reason":""} → 400 INVALID_INPUT
```

## Notes for the parent agent / triage

- **Verifier is live on prod**: `TX_UNVERIFIED` came from a real viem RPC read against Arc mainnet — `verifyTx` is wired (`createViemPayoutVerifier`), so any fabricated hash fails closed. To complete the C3-positive leg on prod, an operator must send a real USDC transfer to the leg payee and pass its hash; no mock path exists (by design, D-227-4).
- `artifact:null` and `anchor:null` on the receipt are honest outputs, not gaps — artifact requires ≥1 COMPLETED leg; anchor requires a fully-terminal plan.
- Residual prod state: two OPEN intents (`pi_57af9872` 0.6 USDC→prov1; `pi_eddac63b` 0.3+0.1 split) under plan `mp_6ece1983` await real payouts; task `ct_c9ac30eebafd44958d0d6d6c` remains IN_PROGRESS (agreements ACTIVE — m1/m2 APPROVED keep it payable per pendingMilestoneCount semantics). All attributed to BOT-TEST-GAMMA.
