# Prod Verify — EPIC-227 — ALPHA — 2026-11-20

## Verdict: GREEN

Full synthetic cycle executed live on https://agentbadge.xyz with ephemeral
wallets (buyer `0x019f…dd25`, prov1 `0x6a2f…a19b`, prov2 `0xe924…aa4e`) and
`operator="BOT-TEST-ALPHA"` on every admin write. The only unverified hop is
leg COMPLETION: the prod payout verifier is real (viem, Arc RPC, fail-closed)
so a fabricated txHash is correctly refused — completing a leg requires a real
treasury transfer, which the no-paid-on-chain constraint forbids.

Fixture data created (all marked BOT-TEST-ALPHA):
- task `ct_0d80f9432ed94f9eaf11df0f` (maxProviders=2, OPEN→IN_PROGRESS)
- offers `of_6e82163181fe40f3af2c27dc` (prov1, $10, 2 milestones + leg template),
  `of_38855ca1221643978e16ba3e` (prov2, $10, 1 milestone)
- agreements `ag_324e7940376a40a0a706149d` (ACTIVE, plan `mp_5556ed24…`,
  ms `ms_73462766…` m-alpha-1 $6 APPROVED / `ms_49e1cab0…` m-alpha-2 $4 PENDING)
  and `ag_f374e2c39874432f982cd5f6` (COMPLETED, plan `mp_68424c3d…`,
  ms `ms_ea609739…` m-beta-1 $10 → dispute → SPLIT → force-release → CANCELLED)
- intent `pi_88be20e6…` OPEN / leg `pl_c59469e3…` $6 OPEN (still payable),
  intent `pi_1492e7f1…` CANCELLED with legs CANCELLED
- dispute `dp_5ac84c6a-b3de-43e9-b014-8b315dafbef7` RESOLVED/SPLIT

## Checklist

- **A — AUTH КОНТУР: PASS**
  - A1: `POST /admin/settlement/intents/x/mark-paid` no key → 401, `code:"UNAUTHORIZED"`, `cache-control: no-store` ✓
  - A2: `POST …/milestones/x/approve` no key → identical envelope ✓
  - A3: wrong `X-Admin-Key` → identical 401 envelope ✓
  - A4: unsigned `/api/settlement/*` → typed refusals, never 500 — writes 401 `WRONG_SIGNER`, participant reads 401 `UNAUTHORIZED` ✓
- **B — READS: PASS**
  - B1: signed participant `GET /api/settlement/agreements/ag_324e…` → 200 `{plan, milestones, intents, legs, disputes}`; non-party signer → 404 `RESOURCE_NOT_FOUND` (existence oracle); nonexistent → 404 ✓
  - B2: `GET /api/settlement/receipts/ag_324e…` → 200 deterministic `settlement_projection@1`, `artifact:null` (no completed legs yet); nonexistent → 404 ✓
  - B3: response shapes match `src/server/routes/settlement/*.ts` + openapi; one nit — `Cache-Control: public, max-age=60` on participant-scoped GETs (see Bugs #2)
- **C — HAPPY PATH: PASS** (leg completion blocked only by real-tx requirement)
  - C1: bridge auto-created plans at accept; `POST /api/settlement/plans` replay → `duplicate:true`; forged milestone vector → 403 `FORBIDDEN "plan milestone terms do not match the offer"` ✓
  - C2: `POST …/milestones/:id/dispute` (buyer sig) → `{frozenIntents:1, frozenLegs:1}`; plan/milestone `DISPUTED`, intent+legs `FROZEN`; replay → `duplicate:true`; admin `resolve` SPLIT → `RESOLVED`, old leg CANCELLED + 2 new legs OPEN ($7 PROVIDER + $3 COLLABORATOR, sum=$10), plan→ACTIVE, milestone→APPROVED, `auditRecorded:true` ✓
  - C3: mark-paid — no txHash → 400 `BAD_INPUT`; malformed → 400 `BAD_INPUT`; no operator → 400 `OPERATOR_REQUIRED`; multi-leg w/o legId → 400 `legId required`; bad legId → 404; fabricated 64-hex → 400 `TX_UNVERIFIED` (live viem verifier, "tx could not be found" — fails closed, never attests); repeat → deterministic same 400; cancelled intent → 409 `INVALID_STATE`. Real completion needs a real payout tx → PARTIAL by design ✓
  - C4: `GET /admin/finance/audit?operator=BOT-TEST-ALPHA` → exactly 2 rows, both attributed `BOT-TEST-ALPHA`: `RESOLVE_SETTLEMENT_DISPUTE` (dp_5ac84c6a) + `FORCE_RELEASE_MILESTONE` (ms_ea609739); zero rows for failed writes ✓
- **D — NEGATIVE/EDGE: PASS**
  - D1: `sum(milestones)≠totalUsd` → 400 `BAD_INPUT`; `sum(legs)≠milestone` → 400 `BAD_INPUT` ✓
  - D2: subjectRef 202 chars → 400 `BAD_INPUT "subjectRef exceeds 128 characters"`; ghost milestone → 404 `NOT_FOUND` ✓
  - D3: `idempotency_key` replay on task create → `duplicate:true`; dispute re-raise → `duplicate:true` ✓
  - D4: post-effect responses carry `auditRecorded:true` (resolve, release); no-op reopen honestly reports `{reopened:false, auditRecorded:false}` ✓
  - D5: all 5 admin POST routes (mark-paid, resolve, approve, reopen, release) → 401 `UNAUTHORIZED` + `cache-control: no-store` with no key and with wrong key ✓
- **E — RECEIPT/ANCHOR: PASS**
  - E1: two consecutive `GET /api/settlement/receipts/ag_324e…` → byte-identical (cmp clean) ✓
  - E2: `POST …/receipts/:id/anchor` on non-terminal plan → 409 `INVALID_STATE "anchor requires every milestone terminal with at least one RELEASED"` — typed gate, no fabricated anchor. PENDING-anchor state unreachable without a RELEASED milestone (needs a paid leg) — observed none created/ANCHORED ✓
- **F — SYNTHETIC FULL-CYCLE: PASS**
  - task(maxProviders=2) → 2 signed offers w/ milestone vectors → 2 buyer accepts → 2 ACTIVE agreements + 2 auto-plans (bridge) → provider submissions (`milestoneRef` bound) → buyer `ACCEPTED` reviews → milestones APPROVED → PayoutIntents OPEN with legs honoring offer leg template ($6 leg on m-alpha-1, default $10 leg on m-beta-1) → dispute/SPLIT/force-release admin ops → deterministic receipt projection. Only leg pay-out needs a real Arc tx.

## Bugs found

1. **LOW — plan status not rolled after force-release cancels all milestones.**
   `milestone-release.ts` never updates the plan row (dispute-resolve does roll
   DISPUTED→CANCELLED/COMPLETED). Repro: force-release the only milestone →
   `GET /api/settlement/agreements/ag_f374e2c39874432f982cd5f6` shows
   `plan.status:"ACTIVE"` while `milestones[0].status:"CANCELLED"` and
   intent+legs CANCELLED. Expected: plan CANCELLED (all milestones cancelled)
   per the same convention applied in dispute-resolve. Observed: ACTIVE.
   Impact: status truthfulness only; no payable surface (intent cancelled).
2. **INFO — `Cache-Control: public, max-age=60` on participant-scoped
   `/api/settlement/*` GETs.** `cache-headers.ts` stamps the generic API
   policy; no `Vary: X-Wallet/X-Sig` and no `private`. Shared caches are
   permitted to store a participant's agreement/receipt view keyed on URL.
   No leak observed on prod (non-party fetch immediately after participant
   200 still 404 — fly serves no shared cache), but the header is the same
   class as the `/admin/` bug fixed for EPIC-226 A4. Suggest `no-store` or
   `private` + `Vary` for signed-read surfaces.
3. **INFO — `TX_UNVERIFIED` message embeds raw viem error incl. version
   string** ("Version: viem@2.55.8"). Typed correctly (400), cosmetic leak of
   dependency version; consider trimming at the seam.

## Curl log (key responses, sanitized)

```
A1  POST /admin/settlement/intents/x/mark-paid        → 401 {"error":"Unauthorized","code":"UNAUTHORIZED",…}  cc:no-store
A2  POST /admin/settlement/milestones/x/approve       → 401 same envelope                                      cc:no-store
A3  same + wrong X-Admin-Key                          → 401 same envelope                                      cc:no-store
A4a POST /api/settlement/plans (unsigned)             → 401 {"error":"valid X-Wallet/X-Sig/…","code":"WRONG_SIGNER",…}
A4b GET  /api/settlement/agreements/x (unsigned)      → 401 {"error":"participant signature required","code":"UNAUTHORIZED",…}
A4c POST /api/settlement/milestones/x/dispute         → 401 WRONG_SIGNER

B1  GET agreements/ag_324e… (buyer sig)               → 200 {plan ACTIVE $10 USDC, ms m-alpha-1 PENDING/$6 + m-alpha-2 PENDING/$4, intents:[], legs:[], disputes:[]}
    GET agreements/ag_324e… (prov2 sig, non-party)    → 404 {"error":"agreement ag_324e… not found","code":"RESOURCE_NOT_FOUND"}
B2  GET receipts/ag_324e… (buyer sig)                 → 200 {"type":"settlement_projection@1",…,"anchor":null,"artifact":null}
    GET receipts/ag_ghost (buyer sig)                 → 404 RESOURCE_NOT_FOUND

F   POST /api/commerce/tasks (buyer, maxProviders=2)  → 201 {task ct_0d80f943…, duplicate:false}
    replay same idempotency_key                        → 200 duplicate:true
    POST …/offers (prov1, milestones m-alpha-1 $6 [leg PROVIDER $6] + m-alpha-2 $4) → 201 of_6e821631…
    POST …/offers (prov2, milestone m-beta-1 $10)      → 201 of_38855ca1…
    POST /api/commerce/offers/of_6e82…/accept (buyer)  → 200 {offer ACCEPTED, agreement ag_324e… ACTIVE, payment NOT_PAID}
    POST /api/commerce/offers/of_3885…/accept (buyer)  → 200 {agreement ag_f374… ACTIVE}
    POST …/agreements/ag_324e…/submissions (prov1, milestoneRef m-alpha-1) → 201 sub_f47808f1…
    POST …/submissions/sub_f478…/review ACCEPTED       → 200 submission ACCEPTED → ms m-alpha-1 APPROVED → intent pi_88be20e6 OPEN + leg pl_c59469e3 OPEN ($6→prov1, network arc)
    POST …/agreements/ag_f374…/submissions (prov2, m-beta-1) → 201 sub_f15ce115…
    POST …/review ACCEPTED                              → 200 agreement COMPLETED → ms APPROVED → intent pi_1492e7f1 OPEN + leg pl_a89826a9 OPEN ($10)

C1  POST /api/settlement/plans (same terms, replay)   → 200 duplicate:true
C1b POST /api/settlement/plans (forged vector)         → 403 FORBIDDEN "plan milestone terms do not match the offer"
D1a plans sum(ms)≠total                                → 400 BAD_INPUT "sum(milestones.amountUsd) must equal totalUsd (D-227-3)"
D1b plans sum(legs)≠milestone                          → 400 BAD_INPUT "sum(milestones[0].legs.amountUsdc) must equal the milestone amount"
    plans ghost agreementRef                           → 404 NOT_FOUND "commerce agreement not found"

C2  POST …/milestones/ms_ea60…/dispute (buyer)         → 200 {dispute dp_5ac84c6a OPEN, frozenIntents:1, frozenLegs:1}
    view                                               → plan DISPUTED, ms DISPUTED, intent FROZEN, leg FROZEN
    dispute replay                                     → 200 duplicate:true frozenIntents:0
    POST /admin/settlement/disputes/dp_5ac8…/resolve SPLIT(7/3) [BOT-TEST-ALPHA] → 200 {dispute RESOLVED, resolvedBy:"BOT-TEST-ALPHA", auditRecorded:true}
    view                                               → plan ACTIVE, ms APPROVED, intent OPEN, old leg CANCELLED, new legs pl_63abb131($7 PROVIDER)+pl_41a191e3($3 COLLABORATOR) OPEN

C3  mark-paid no txHash                                → 400 BAD_INPUT (schema)
    mark-paid txHash "0x00"                            → 400 BAD_INPUT "0x-prefixed 64-hex"
    mark-paid no operator                              → 400 OPERATOR_REQUIRED
    mark-paid ghost intent                             → 404 NOT_FOUND
    mark-paid multi-leg w/o legId                      → 400 "legId required — intent has 2 OPEN legs"
    mark-paid bad legId                                → 404 "leg … not found on intent"
    mark-paid fabricated 0xccc… (real leg)             → 400 TX_UNVERIFIED "rpc read failed: Transaction … could not be found" (viem verifier live)
    mark-paid same tx again                            → 400 TX_UNVERIFIED (deterministic)
    mark-paid on CANCELLED intent                      → 409 INVALID_STATE "payout intent is CANCELLED, not OPEN"

    approve PENDING milestone ms_49e1…                 → 409 INVALID_STATE "milestone is PENDING, not READY"
    reopen APPROVED ms_ea60… (OPEN intent)             → 200 {reopened:false, auditRecorded:false}
    release ms_ea60… (COMPLETED agr, no confirm)       → 409 INVALID_STATE would_cancel_approved_payout {details:{agreementStatus:"COMPLETED",intentId:…}}
    release ms_ea60… confirmCancel:true [BOT-TEST-ALPHA] → 200 {released:true, cancelled:true, auditRecorded:true}
    view after release                                 → ms CANCELLED, intent CANCELLED, all 3 legs CANCELLED, plan ACTIVE (see Bug #1)

D2  dispute subjectRef len 202                         → 400 BAD_INPUT "subjectRef exceeds 128 characters"
    dispute ghost milestone                            → 404 NOT_FOUND "MILESTONE subject not found"

E1  GET receipts/ag_324e… ×2                           → byte-identical bodies
E2  POST receipts/ag_324e…/anchor                      → 409 INVALID_STATE "anchor requires every milestone terminal with at least one RELEASED"

C4  GET /admin/finance/audit?operator=BOT-TEST-ALPHA   → 200 rows:
      FORCE_RELEASE_MILESTONE milestone:ms_ea609739…  BOT-TEST-ALPHA  2026-11-20 10:01:15Z
      RESOLVE_SETTLEMENT_DISPUTE settlement_dispute:dp_5ac84c6a… BOT-TEST-ALPHA 10:00:03Z
```

Verification method: EIP-191 `agentbadge-commerce:v2` challenge signing
(wallet/method/path/timestamp/nonce/bodyHash/idemKey bound) with three
ephemeral secp256k1 accounts; admin surface via `X-Admin-Key` (value never
logged). No secrets in this file. No paid on-chain operations performed.
