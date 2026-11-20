# Prod Verify — EPIC-227 — BETA — 2026-11-20

## Verdict: GREEN

All externally-verifiable checklist items passed against `https://agentbadge.xyz`
(prod) using throwaway EIP-191 wallets and admin writes attributed to
`operator="BOT-TEST-BETA"`. Two assertions are marked SKIP — they require a real
on-chain USDC transfer on Arc, which the run rules forbid ("никаких платных
on-chain операций"). In both cases prod showed the *correct blocking behavior*:
the live viem payout verifier refused a fabricated txHash (`TX_UNVERIFIED`), and
the anchor gate refused a non-terminal plan (`INVALID_STATE`). That is the
security property working, not a gap.

## Checklist (A..F: PASS/FAIL/SKIP + одна строка evidence)

### A. AUTH-КОНТУР — PASS
- A1 PASS — `POST /admin/settlement/intents/x/mark-paid` без ключа → **401**
  `{"error":"Unauthorized","code":"UNAUTHORIZED"}` + `cache-control: no-store`.
  `GET /admin/settlement/plans` → **404** `{"error":"not_found"}` (admin surface
  is POST-only — matches the note, correct).
- A2 PASS — `POST /admin/settlement/milestones/x/approve` без ключа → identical
  401 envelope, `code=UNAUTHORIZED`, `no-store`.
- A3 PASS — `X-Admin-Key: deadbeef…` → identical 401 envelope (timing-safe
  compare, no oracle).
- A4 PASS — `POST /api/settlement/plans` без подписи → **401** `WRONG_SIGNER`
  ("valid X-Wallet/X-Sig/X-Timestamp/X-Nonce required"); GET
  agreement/receipt без подписи → **401** `UNAUTHORIZED`
  ("participant signature required"). No 500s anywhere.

### B. READS ЗА КЛЮЧОМ / PUBLIC — PASS
- B1 PASS — `GET /api/settlement/agreements/:id`: unsigned → 401; signed
  non-participant (fresh wallet) → **404 `RESOURCE_NOT_FOUND`** on a nonexistent
  id *and* on a real agreement `ag_eb5ee6406e30485da71b0aa0` (existence-oracle
  holds); participant buyer → **200** `{plan,milestones,intents,legs,disputes}`.
  Doc nit: checklist says "public read" — actual contract is participant-gated
  read (matches route code + OpenAPI `errs(401,404)`); see Bugs/nits.
- B2 PASS — `GET /api/settlement/receipts/:agreementId`: non-participant → 404;
  participant → **200** deterministic `settlement_projection@1` with
  `milestones[].intent.legs[]` and trailing `artifact`.
- B3 PASS — response shapes match route zod/OpenAPI: plan view
  `{plan,milestones,intents,legs,disputes}`; dispute raise
  `{dispute,frozenIntents,frozenLegs,duplicate}`; resolve
  `{dispute,auditRecorded}`; receipt `settlement_projection@1`. Cosmetic nit:
  amounts normalized (`"6"` vs `"6.00"`, `totalUsd:"10"`) — decimal equality
  preserved, cosmetic only.

### C. SETTLEMENT HAPPY PATH — PASS (writes только operator=BOT-TEST-BETA)
- C1 PASS — accept → commerce→settlement bridge auto-created plan
  (`mp_16ca77b3-…`, `totalUsd:"10"`, milestones m1 `6.00` + m2 `4.00`,
  `status:ACTIVE`) — visible in participant view immediately; explicit
  `POST /api/settlement/plans` same terms → **200 `duplicate:true`**.
- C2 PASS — buyer `POST …/milestones/ms_661e4923…/dispute` → 200
  `{frozenIntents:1,frozenLegs:1,duplicate:false}`, freeze snapshot in
  `dispute.payload.freeze`; view: intent `pi_9894a07b…` → **FROZEN**.
  Admin `resolve` `{resolution:"SPLIT",splitLegs:[5.00 PROVIDER→prov1,
  1.00 COLLABORATOR→prov2]}` → **200 RESOLVED**: old leg CANCELLED, 2 new OPEN
  legs minted (`payload.splitOf=dp_fffcc072…`), `resolvedBy:"BOT-TEST-BETA"`,
  intent back to OPEN, AdminAction row `RESOLVE_SETTLEMENT_DISPUTE` in audit.
- C3 PASS-with-SKIP — `mark-paid` без txHash → **400 BAD_INPUT** (zod);
  `txHash:"0x1234"` → **400** "0x-prefixed 64-hex"; 2 OPEN legs без legId →
  **400** "legId required"; `legId:"leg-nope"` → **404 NOT_FOUND**; cancelled
  legId → **409 INVALID_STATE**; well-formed fake hash on the single-leg ag2
  intent → **400 TX_UNVERIFIED** ("Transaction … could not be found" — **live
  viem chain verifier on prod**, fabricated hash refused). SKIP: positive
  mark-paid (real txHash → leg COMPLETED → milestone RELEASED) and the
  replay/`TX_REUSED` branch need a real Arc transfer — intentionally not done.
- C4 PASS — `/admin/finance/audit?operator=BOT-TEST-BETA` shows row
  `RESOLVE_SETTLEMENT_DISPUTE | settlement_dispute:dp_fffcc072-27cb-42c8-
  974e-0ae2aaf70f0e | BOT-TEST-BETA | {"resolution":"SPLIT","note":"BOT-TEST-
  BETA-… split resolve"…} | 2026-11-20 09:57:33`. Failed negatives wrote
  nothing (by design). Attribution verified.

### D. NEGATIVE/EDGE — PASS
- D1 PASS — `sum(milestones)≠totalUsd` → **400 BAD_INPUT** "must equal totalUsd
  (D-227-3)"; `sum(legs)≠milestone` → **400 BAD_INPUT**; stranger plan on a real
  agreement → **403 FORBIDDEN** "only the agreement buyer or provider".
- D2 PASS — subjectRef 200 chars → **400** "subjectRef exceeds 128 characters";
  `reason:""` → **400 INVALID_INPUT** (zod ≥1).
- D3 PASS — task create replay same `idempotency_key` (fresh nonce) → **200
  `duplicate:true`** same `ct_` id; `POST /plans` same terms → **200
  `duplicate:true`**. Dispute-replay (duplicate:true on second OPEN dispute)
  not re-run — would have re-frozen the resolved intent.
- D4 PASS — resolve response schema is `{dispute,auditRecorded}`; the
  AdminAction row landed (verified in audit trail → auditRecorded:true).
- D5 PASS — `code=UNAUTHORIZED` + `cache-control:no-store` on all
  `/admin/settlement/*` probes; also `no-store` on successful/failed admin
  POSTs (repeat resolve → 409 + `no-store`).
- EXTRA PASS — stranger dispute on the real milestone → **403 FORBIDDEN**
  (domain participant gate after scope resolution); repeat resolve on
  RESOLVED dispute → **409 INVALID_STATE** "dispute is RESOLVED, not OPEN".

### E. RECEIPT/ANCHOR — PASS (one SKIP)
- E1 PASS — `GET /api/settlement/receipts/ag_eb5ee6406e30485da71b0aa0` twice →
  **200/200 byte-identical** (`identical=true`). `artifact:null` expected —
  no completed legs ⇒ no EIP-712 artifact; projection itself is deterministic.
- E2 SKIP-by-env — `POST …/anchor` (admin) on both agreements → **409
  INVALID_STATE** "anchor requires every milestone terminal with at least one
  RELEASED" — terminal gating verified, no fabricated anchor. A real
  PENDING-without-txHash row was unreachable (needs a completed leg, which
  needs a real payout tx — forbidden by run rules).

### F. SYNTHETIC FULL-CYCLE — PASS (dataset self-provisioned)
- Task `ct_e31e139ab0c9416aa5a0c691` (maxProviders=2) → offers `of_f5092fe1…`
  (prov1, milestones m1+m2) + `of_5468c269…` (prov2, default) → both accepted →
  agreements `ag_eb5ee640…` + `ag_4d897589…` (ACTIVE) → bridge plans
  `mp_16ca77b3…` + `mp_de85da3c…` → submissions (`milestoneRef:"m1"`, auto-bind
  `"full"`) → buyer review ACCEPTED → milestones **APPROVED** + PayoutIntents
  **OPEN** (`pi_9894a07b…`, `pi_d4511370…`) → ag2 agreement **COMPLETED**
  (last milestone), task stays IN_PROGRESS (ag1 m2 pending — correct H6
  semantics) → mark-paid refused `TX_UNVERIFIED` (verifier live — paid leg
  transition intentionally not exercised) → receipt deterministic.

## Bugs found (severity, repro curl, observed vs expected)

- **None blocking.** No 500s, no INTERNAL_ERROR mislabels, no auth bypasses, no
  fabricated chain state observed.
- **Nit (docs, severity: trivial)** — `GET /api/settlement/agreements/:id` and
  `GET /api/settlement/receipts/:agreementId` are *participant-gated*, not
  "public read" (unsigned → 401 `UNAUTHORIZED`; non-participant → 404
  existence-oracle). Matches code + OpenAPI `errs(401,404)`; only the verify
  checklist wording suggested public. No code change needed.
- **Nit (cosmetic, severity: trivial)** — decimal normalization: plan/milestone
  amounts echo as `"6"`/`"10"` rather than input `"6.00"`/`"10.00"`; leg
  `amountUsdc:"5"` vs `"5.00"`. Numeric equality preserved; cosmetic only.
- **Observation (not a bug)** — prod has the payout verifier wired
  (ARC chain id + RPC): any mark-paid with a non-chain txHash → 400
  `TX_UNVERIFIED` even though `ARC_SETTLEMENT_REQUIRE_VERIFY` is unset in the
  checked-out env. Fail-closed works; "manual ops attestation" is NOT
  blind on prod.

## Curl log (ключевые ответы — статусы + тела, БЕЗ секретов)

```
A1 POST /admin/settlement/intents/x/mark-paid            -> 401 no-store
   {"error":"Unauthorized","code":"UNAUTHORIZED", ...}
A2 POST /admin/settlement/milestones/x/approve           -> 401 no-store (identical)
A3 POST …/mark-paid  X-Admin-Key: <wrong>                -> 401 (identical)
   POST …/mark-paid  X-Admin-Key: <real>                 -> 400 BAD_INPUT (past auth)
A4 POST /api/settlement/plans (no sig)                   -> 401 WRONG_SIGNER
   GET  /api/settlement/agreements/x (no sig)            -> 401 UNAUTHORIZED
   GET  /api/settlement/receipts/x   (no sig)            -> 401 UNAUTHORIZED
   GET  /admin/settlement/plans                          -> 404 {"error":"not_found"}

B  GET agreements/ag-nope-beta (signed stranger)         -> 404 RESOURCE_NOT_FOUND
   GET receipts/ag-nope-beta   (signed stranger)         -> 404 RESOURCE_NOT_FOUND
   GET agreements/ag_eb5ee640… (signed stranger, real)   -> 404 RESOURCE_NOT_FOUND  (oracle)

F1 POST /api/commerce/tasks {maxProviders:2,OPEN}        -> 201 ct_e31e139ab0c9416aa5a0c691
D3 task create + idem replay                             -> 201 dup:false → 200 dup:true (same ct_)
F2 POST tasks/:id/offers (prov1, payload.milestones m1+m2) -> 201 of_f5092fe11a254d2f89f4f1db
F3 POST tasks/:id/offers (prov2)                         -> 201 of_5468c269067644a4925b76a8
F4 POST offers/of_f5092…/accept (buyer)                  -> 200 agreement ag_eb5ee6406e30485da71b0aa0 ACTIVE
F5 POST offers/of_5468…/accept (buyer)                   -> 200 agreement ag_4d897589206b4bca89d3255f ACTIVE

C1 GET /api/settlement/agreements/ag_eb5ee640… (buyer)   -> 200 plan mp_16ca77b3… ACTIVE,
   milestones m1 $6 PENDING + m2 $4 PENDING  (bridge auto-created at accept)
   POST /api/settlement/plans (same terms)               -> 200 duplicate:true

D1a POST /plans sum(milestones)≠totalUsd                 -> 400 BAD_INPUT (D-227-3)
D1b POST /plans sum(legs)≠milestone                      -> 400 BAD_INPUT
D1c POST /plans as stranger on ag_eb5ee640…              -> 403 FORBIDDEN

F6 POST agreements/ag_eb5ee640…/submissions milestoneRef=m1 -> 201 sub_13c6cfbb…
F7 POST submissions/sub_13c6cfbb…/review ACCEPTED (buyer)   -> 200 submission ACCEPTED
C1b GET agreement view                                   -> m1 APPROVED, escrowRef appr_d0f9…,
   intent pi_9894a07b-ebb1-4ebc-8879-e8e749c7ff5b OPEN, leg pl_af717573… $6 PROVIDER OPEN

C2a POST milestones/ms_661e4923…/dispute (buyer)         -> 200 dp_fffcc072-27cb-42c8-974e…,
   frozenIntents:1 frozenLegs:1 duplicate:false; view: intent FROZEN
C2c POST /admin/settlement/disputes/dp_fffcc072…/resolve (admin, operator BOT-TEST-BETA,
   SPLIT 5.00→prov1 + 1.00→prov2)                        -> 200 RESOLVED resolvedBy:"BOT-TEST-BETA"
C2d legs after SPLIT: old leg CANCELLED; new OPEN pl_d3529c4d… $5 PROVIDER +
   pl_610c7b4a… $1 COLLABORATOR (payload.splitOf=dp_fffcc072…)

C3a mark-paid {}                                         -> 400 BAD_INPUT (zod)
C3b mark-paid txHash:"0x1234"                            -> 400 BAD_INPUT (format)
C3c mark-paid fake-hash no legId (2 OPEN legs)           -> 400 "legId required"
C3d mark-paid fake-hash + cancelled legId                -> 409 INVALID_STATE "leg is CANCELLED"
C3f mark-paid fake-hash legId:"leg-nope"                 -> 404 NOT_FOUND
F11 mark-paid fake-hash on ag2 single OPEN leg           -> 400 TX_UNVERIFIED
   "Transaction with hash 0xaaaa… could not be found"  ← live viem verifier on prod

D2a dispute subjectRef=200×'z'                           -> 400 "subjectRef exceeds 128 characters"
D2b dispute reason:""                                    -> 400 INVALID_INPUT
    stranger dispute on real milestone                   -> 403 FORBIDDEN
    repeat resolve on RESOLVED dispute                   -> 409 INVALID_STATE + no-store

E1 GET receipts/ag_eb5ee640… ×2                          -> 200/200 byte-identical
   {"type":"settlement_projection@1","agreementRef":"ag_eb5ee640…",
    "milestones":[{m1 APPROVED, intent OPEN, legs…}], … artifact tail}
E2 POST receipts/ag_eb5ee640…/anchor (admin)             -> 409 INVALID_STATE
   "anchor requires every milestone terminal with at least one RELEASED"
   POST receipts/ag_4d897589…/anchor (admin)             -> 409 INVALID_STATE (same)

C4 GET /admin/finance/audit?operator=BOT-TEST-BETA       -> 200 row:
   RESOLVE_SETTLEMENT_DISPUTE | settlement_dispute:dp_fffcc072… |
   BOT-TEST-BETA | {"resolution":"SPLIT","note":"BOT-TEST-BETA-… split resolve"…}
```

Entity ids (all BOT-TEST-BETA-owned, ephemeral wallets): task
`ct_e31e139ab0c9416aa5a0c691` (+ idem-task `ct_2ce9d5bdf1d94aeeb3130c70`),
agreements `ag_eb5ee6406e30485da71b0aa0` / `ag_4d897589206b4bca89d3255f`,
plans `mp_16ca77b3-6b40-41ea-b18a-45ea0641851a` /
`mp_de85da3c-f1ea-4693-8acd-9c06c85a3542`, milestone `ms_661e4923-3a8a-4799-
a969-5effd61a8f4d`, intents `pi_9894a07b-ebb1-4ebc-8879-e8e749c7ff5b` /
`pi_d4511370-d423-49c1-857b-1c78ddfc0780`, dispute `dp_fffcc072-27cb-42c8-
974e-0ae2aaf70f0e`.
