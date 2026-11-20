# Prod Verify — EPIC-227 — DELTA — 2026-11-20

Target: https://agentbadge.xyz (Hono, Fly deploy, viem@2.55.8 payout verifier live on Arc)
Verifier: bot DELTA, external consumer only — admin writes `operator="BOT-TEST-DELTA"`, commerce writes signed EIP-191 (agentbadge-commerce:v2) from a demo buyer wallet (`0x8c644ea1fc47d9185f5eefb84be23f7394c6e0d8`) and two ephemeral provider wallets generated for this run. No paid on-chain ops, no code changes.

## Verdict: PARTIAL

Every reachable check passed; the two unreachable sub-items require a real Arc USDC payment (prohibited paid on-chain op) and are blocked *by design* — prod fails closed (`TX_UNVERIFIED`) rather than attesting blind. 1 medium bug + 1 doc drift found, see below.

## Checklist

**A. AUTH-контур**
- A1 PASS — `POST /admin/settlement/intents/x/mark-paid` no key → `401 {"error":"Unauthorized","code":"UNAUTHORIZED"}`, `cache-control: no-store`. No GET listing: `GET /admin/settlement/plans` → `404 not_found` (admin surface is POST-only, correct).
- A2 PASS — `POST /admin/settlement/milestones/x/approve` no key → identical 401 envelope + no-store.
- A3 PASS — wrong `X-Admin-Key` → identical 401 envelope (no oracle between missing/invalid).
- A4 PASS — `POST /api/settlement/plans` unsigned → `401 {"code":"WRONG_SIGNER"}`, not 500. Malformed sig headers → `401 WRONG_SIGNER` ("timestamp outside ±300s skew window").
- Extra PASS — replay guard: identical signed request replayed within window → `409 CONFLICT "replayed signed request"` (reads AND writes; first call consumed the nonce even on a 404 domain failure).

**B. READS**
- B1 PASS (spec-corrected) — `GET /api/settlement/agreements/:id` unsigned → `401 UNAUTHORIZED "participant signature required"`; signed non-participant → `404 RESOURCE_NOT_FOUND` (existence-oracle holds — the agreement exists but is invisible); signed participant → `200 {plan,milestones,intents,legs,disputes}`.
- B2 PASS — `GET /api/settlement/receipts/:id` unsigned → `401 UNAUTHORIZED`; participant → `200 {type:"settlement_projection@1", agreementRef, plan, milestones[intent.legs], disputes, anchor, artifact}`; `artifact:null` while no leg is COMPLETED (no fabricated artifact).
- B3 PASS w/ note — response shapes match route schemas + openapi.json (all 10 settlement paths present). Doc drift: OpenAPI says "unsigned or non-party callers get 404" — actual unsigned = 401 (see Bug D2 below).

**C. HAPPY PATH (all writes operator=BOT-TEST-DELTA / BOT-TEST-DELTA-labelled)**
- C1 PASS — `POST /api/settlement/plans` → `200 duplicate:true`: the commerce bridge had already provisioned the plan at offer-accept (plan createdAt == accept time); the POST verified canonical-terms dedupe. Milestones visible in reads (`PENDING`).
- C2 PASS — dispute raise → `plan:DISPUTED, ms:DISPUTED, intent:FROZEN, leg:FROZEN` (frozenIntents:1, freeze map persisted in dispute payload). `resolve SPLIT 0.70 PROVIDER + 0.30 PLATFORM_FEE` → `200`, dispute `RESOLVED/SPLIT/resolvedBy=BOT-TEST-DELTA`, original leg `CANCELLED`, 2 new `OPEN` legs (0.7+0.3=1.0), `auditRecorded:true`. Second dispute → `FOR_PROVIDER` → `RESOLVED`, `auditRecorded:true`.
- C3 PARTIAL — mark-paid chain: missing operator → `400 OPERATOR_REQUIRED`; missing txHash → `400 BAD_INPUT` (schema); `0x0` → `400 BAD_INPUT` (format); well-formed nonexistent hash → `400 TX_UNVERIFIED` (real viem RPC read — verifier live, fails closed); nonexistent intent → `404 NOT_FOUND`; multi-leg intent w/o legId → `400 BAD_INPUT "legId required — intent has 2 OPEN legs"`. **Successful mark-paid, completed-leg receipt artifact, and idempotent/409 replay are unreachable without a real Arc USDC tx to the leg payee — paid op, not attempted.** This is the designed fail-closed posture.
- C4 PASS — `GET /admin/finance/audit?operator=BOT-TEST-DELTA` → exactly 3 rows (FORCE_APPROVE_MILESTONE, 2× RESOLVE_SETTLEMENT_DISPUTE), all attributed BOT-TEST-DELTA; failed negatives wrote nothing.

**D. NEGATIVE/EDGE**
- D1 PASS — milestones sum 0.50 ≠ total 1.00 → `400 BAD_INPUT "sum(milestones.amountUsd) must equal totalUsd (D-227-3)"`; legs sum 0.60 ≠ milestone → `400 BAD_INPUT "sum(...legs...) must equal the milestone amount"`; SPLIT legs 0.9 ≠ 1.0 → `400 BAD_INPUT`. Agreement-mismatch variants refused earlier at schema/invariant layer.
- D2 PASS — milestoneId 200 chars → `400 INVALID_INPUT` (zod ≤128); subjectRef 300 chars → `400 BAD_INPUT "subjectRef exceeds 128 characters"`; `//dispute` blank segment → `404 not_found`; nonexistent milestone → `404 NOT_FOUND`.
- D3 PASS — plan POST replay (same body, new sig, same `idempotency_key`) → `200 duplicate:true`, identical payload.
- D4 PASS — all successful admin writes returned `auditRecorded:true` and appear in `/admin/finance/audit`.
- D5 PASS — `401 UNAUTHORIZED` + `cache-control: no-store` verified on mark-paid, approve, reopen, release, resolve; no-store also on authed 400 paths.

**E. RECEIPT/ANCHOR**
- E1 PASS — `GET /api/settlement/receipts/:id` twice (2s apart) → byte-identical projection (`settlement_projection@1`), deterministic ordering, `artifact:null` absent completed legs.
- E2 PARTIAL — `POST .../anchor` on non-terminal plan → `409 INVALID_STATE "anchor requires every milestone terminal with at least one RELEASED"` (gate works — no anchor row fabricated); nonexistent agreement → `404 NOT_FOUND`. **PENDING→ANCHORED drain unverifiable**: needs a RELEASED milestone = paid leg (blocked per C3).

**F. SYNTHETIC FULL-CYCLE: PASS (up to the paid leg)**
- `task ct_ff8b99cdc81943a6bd2a2965` (maxProviders=2) → offers `of_38408ff…`/`of_b95fe23…` → 2 accepts → agreements `ag_37f6012f…` + `ag_ef6619d78b…` (ACTIVE) → plans auto-provisioned (`mp_efdd9038…`, `mp_01b8b53f…`, milestone `full` $1.00 each) → submissions bound `milestoneRef:full` → agr1 buyer `ACCEPTED` → milestone APPROVED + intent `pi_d2237b14…` OPEN; agr2 admin `force-approve` → APPROVED (`ops_` epoch) + intent `pi_61d20dfe…` OPEN. Receipt projections served for both. Only the last hop (paid leg → signed EIP-712 artifact → anchor) is blocked by the no-paid-ops rule.

## Bugs found

**BUG-1 (MEDIUM) — `cache-control: public, max-age=60` on sig-gated `/api/settlement/*` responses, no `Vary`**
- Repro: `curl -si https://agentbadge.xyz/api/settlement/agreements/ag_37f6012f11674a3682e37a04` (signed participant) → `200` with `cache-control: public, max-age=60`, no `Vary: X-Wallet/X-Sig`. The unsigned 401 for the same URL is equally `public`.
- Observed vs expected: participant views (plan terms, counterparty wallets, leg amounts) and existence-oracle 401/404s are marked *shared*-cacheable by URL alone. A shared cache between client and origin could serve a participant's 200 to anonymous requesters (oracle broken, payout terms leaked) or a cached anonymous 401 to legitimate participants. EPIC-226 fixed exactly this for `/admin/` (NO_STORE_PREFIXES) but the fix never covered credential-scoped `/api/` routes. Expected: `no-store` (or `private`) on any response whose body varies by X-Wallet/X-Sig identity — applies equally to `/api/commerce/*` participant surfaces (e.g. task detail DRAFT visibility). Root: `src/server/middleware/cache-headers.ts` L71 blanket rule.
- Severity note: no CDN headers observed (direct Fly), so the live exploit depends on proxy topology; the header contract itself is still wrong.

**BUG-2 (LOW, doc drift) — OpenAPI/read-shape mismatch on unsigned reads**
- `GET /api/settlement/agreements/:id` description claims "unsigned or non-party callers get 404"; actual unsigned → `401 UNAUTHORIZED` (code intentionally returns 401 for unsigned, 404 for non-parties — fine behavior, stale doc). Same for receipts route. Checklist item B1 also assumed "public read" — the actual contract is participant-signed read; verified per code, not per checklist wording.

## Curl log (key responses — sanitized, no secrets)

```
A1 POST /admin/settlement/intents/x/mark-paid (no key)        → 401 {"code":"UNAUTHORIZED"}  cache-control: no-store
A1b GET /admin/settlement/plans                             → 404 {"error":"not_found"}     cache-control: no-store
A2 POST /admin/settlement/milestones/x/approve (no key)     → 401 UNAUTHORIZED + no-store
A3 same w/ wrong key                                        → 401 UNAUTHORIZED (identical envelope)
A4 POST /api/settlement/plans (no sig)                      → 401 WRONG_SIGNER
B1 GET /api/settlement/agreements/:id (no sig)              → 401 UNAUTHORIZED
B1 GET same, signed non-participant                         → 404 RESOURCE_NOT_FOUND
   GET same, replayed identical sig headers                 → 409 CONFLICT "replayed signed request"

F  POST /api/commerce/tasks (buyer sig)                     → 201 ct_ff8b99cdc81943a6bd2a2965 maxProviders=2
   POST tasks/:id/offers (provider1/2 sigs)                 → 201 of_38408ff…, of_b95fe23…
   POST /api/commerce/offers/:id/accept ×2 (buyer sig)      → 200 ag_37f6012f…, ag_ef6619d78b… (ACTIVE, $1.00)
C1 POST /api/settlement/plans (buyer sig, canonical terms)  → 200 duplicate:true (bridge auto-provisioned)
   POST submission (provider sig, milestoneRef:"full")      → 201 sub_aa89b9d0… / sub_62947a8e…
   POST submissions/:id/review ACCEPTED (buyer sig)         → 200, agreement COMPLETED
   GET agreement view (buyer sig)                           → ms APPROVED, intent pi_d2237b14… OPEN, leg 1 USDC OPEN
   admin force-approve ms_26606721…                         → 200 APPROVED ops_ epoch, intentId pi_61d20dfe…, auditRecorded:true

C3 POST …/mark-paid {"operator":"BOT-TEST-DELTA",txHash:"0x0"}        → 400 BAD_INPUT (format)
   POST …/mark-paid no txHash                                        → 400 BAD_INPUT (schema)
   POST …/mark-paid no operator                                      → 400 OPERATOR_REQUIRED
   POST …/mark-paid well-formed dead hash                            → 400 TX_UNVERIFIED (viem RPC: tx not found)
   POST …/mark-paid pi_nonexistent                                   → 404 NOT_FOUND
   POST …/mark-paid multi-leg, no legId                              → 400 BAD_INPUT "legId required — 2 OPEN legs"

C2 POST milestones/ms_e885be4c…/dispute (buyer sig)                  → 200 dispute dp_cc85eb2e… OPEN, frozenIntents:1
   replay same dispute                                               → 200 duplicate:true frozenIntents:0
   POST disputes/dp_cc85eb2e…/resolve SPLIT 0.7+0.3 (admin)          → 200 RESOLVED auditRecorded:true, resolvedBy BOT-TEST-DELTA
   view: leg CANCELLED + legs OPEN 0.70 PROVIDER / 0.30 PLATFORM_FEE
   dispute2 dp_6b7a579d… → resolve SPLIT 0.5+0.4                     → 400 BAD_INPUT (sum)
   resolve FOR_PROVIDER                                              → 200 RESOLVED auditRecorded:true

D1 plan milestones 0.50/1.00                                        → 400 BAD_INPUT (sum != totalUsd)
   plan legs 0.60/1.00                                              → 400 BAD_INPUT (legs sum)
D2 milestoneId 200c / subjectRef 300c / //dispute / ms_nonexistent  → 400 / 400 / 404 / 404
D3 plan POST replay same idem_key                                   → 200 duplicate:true

E1 GET receipts/ag_37f6012f… ×2                                     → 200 byte-identical, artifact:null
E2 POST receipts/ag_37f6012f…/anchor (admin)                        → 409 INVALID_STATE (non-terminal gate)
   POST receipts/ag_nonexistent/anchor                              → 404 NOT_FOUND
   GET /.well-known/settlement-receipt.schema.json                  → 200 (schema v1 live)

C4 GET /admin/finance/audit?operator=BOT-TEST-DELTA                 → 3 rows, all BOT-TEST-DELTA
```

Artifacts left on prod (attributed, safe to cancel): task `ct_ff8b99cdc81943a6bd2a2965` (+2 agreements/plans/submissions, 1 OPEN intent per plan, disputes all RESOLVED). All admin actions carry `operator="BOT-TEST-DELTA"`.
