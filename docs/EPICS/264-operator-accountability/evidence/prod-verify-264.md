# prod-verify-264 — EPIC-264 production bring-up

**Date:** 2026-11-25 · **Commit on prod:** `2b9f6f3f` (main HEAD —
audit batch `0ed2651e` + confirm-round `2b9f6f3f`) · **App:**
agent-passport-hedera (fly.io) · **Machines:** fra `48e0e31c071608`,
ams `8911065a66e968` · **Image:**
`deployment-01M894HQM514MQ6SCJFGE55VG0` (355 MB)

## Starting state found

- Prod already ran `545563c9` (main deploy ~42 min before this
  window) — EPIC-264 code minus the confirm-round commit.
- Ledger `prisma_contract.ledger` = id 46
  (`20261124T2148_intel_pull_attestation`) — ALL migrations applied
  incl. `1013_admin_operators`, `1328_admin_action_principal_id`,
  `1635_gap_ownership`, `1720_gap_events`, `1925_gap_overdue`.
- `adminOperator` table EMPTY; secrets missing:
  `OPERATOR_SEED_JSON`, `ADMIN_BREAK_GLASS_ENABLED` → every admin
  surface hard-locked 401 (zero operators, break-glass disarmed).

## Actions (in order)

1. `fly deploy --build-only --push` → image ref above →
   `fly machine update` both machines → `/health` gitCommit=2b9f6f3f.
2. `fly secrets set OPERATOR_SEED_JSON={"displayName":"paul-spread",
   "key":"opk_…"} ADMIN_BREAK_GLASS_ENABLED=true` — rolling restart
   (fra→ams, no seed race). Seed fired once:
   `op_01M894P0SFJ2M6KCSKQTZ07R22` / cred `opk_Z5MoWrIg…`.
   Key delivered in the ops session — stored by the owner.
3. Service creds via admin API (idempotency-key'd, audited under
   paul-spread): `probe-a/b/c` [probe,workflow] · `probe-noflow`
   [probe] · `probe-revoked` (cred revoked) · `probe-disabled`
   (operator disabled). Prod keys live in `/tmp/probe-prod-keys.env`
   on the ops box (transient — owner must move to own secret store).
4. Seed consumed → `fly secrets unset OPERATOR_SEED_JSON` (rolling
   restart; the plaintext no longer lives anywhere but the owner).
5. Manual break-glass walk-through (armed use).

## Verification results

- **Seed+auth**: `/admin/operators` 401 anon → 200 with seed cred;
  `x-admin-key` in request logs reads `[REDACTED]`.
- **Auth matrix**: probe-a/noflow → 403 on operator-admin surface
  (cap boundary); revoked/disabled/junk → 401.
- **Probe prod pass** (`--target https://agentbadge.xyz`):
  - `operator-auth-negative` **6/6 PASS** (401×4, 403, 400).
  - `knowledge-sod-negative` **PASS** — verify-self refused
    `SEPARATION_OF_DUTIES` 403; item `pbcfbb9801fe` stranded at
    VERIFIED (publish-by-verifier refused).
  - `knowledge-lifecycle` — flow COMPLETED end-to-end on prod:
    item `pbf05203f58f` DRAFT→PENDING→VERIFIED→PUBLISHED→WITHDRAWN;
    statusEvent actors = probe-a submit, probe-b verify, probe-c
    publish, probe-a withdraw (distinct `op_*`, SoD enforced).
    Case verdict: 1 inconclusive — create-replay 409. Cause:
    replay POST crossed to the second machine (in-memory idem
    store, accepted risk M2) + dbVerify blind on remote target.
    Substantive outcome = PASS.
  - `auth-negative` + `no-store-audit` + `contract-basic` sweep on
    `/admin/*`: **196 PASS / 0 fail / 0 inconclusive** (148
    skipped — dedupe/apply filters).
  - `probe diff local↔prod` run: divergences are dead-scratch
    (localhost:4022) + requeue noise; knowledge/admin surface
    verdicts match on the cases that ran both sides.
- **Break-glass (one controlled use)**: shared key on
  `GET /admin/api/knowledge/gaps` → **200**; on
  `GET /admin/operators` → **403** (no operator-admin cap — shared
  key cannot mint credentials). Log warns
  `operator_admin.break_glass USE` fired on every presentation
  (alert-on-use works); `breakGlassAuthUsed` counter incremented.
- **Attribution**: pre-264 `adminAction` rows read `principalId=null`
  (shared-key era — honest); post-deploy actions attribute
  `op_*`/`break_glass` — e.g.
  `{"action":"credential_revoke","actor":"op_01M894P0SFJ2M6KCSKQTZ07R22","principalType":"human"}`.

## Deviation vs spec

- `ADMIN_LEGACY_KEY_UNTIL` window **not set — the mechanism no
  longer exists**: SLICE-264-9 deleted the dual-auth window; shared
  key is break-glass-only by construction. Spec line predates 264-9.
  Effective posture = the spec's END state immediately (DoD #1
  satisfied on day one, not after 7d). Break-glass remains armed.
- Two machines now serve prod (ams added 2026-11-24); deploy
  procedure updated both. Rolling restarts made the one-shot seed
  race-free.

## Residual notes

- Probe `inconclusive` on create-replay documents the accepted
  M2 reality (per-process idem store; replicas can replay-execute
  once each — dedupe is not multi-replica atomic). Not a regression.
- `probe-revoked`/`probe-disabled` are intentional fixtures for the
  auth battery — leave them; `probe-disabled` must stay disabled.
- Boot-time DB pool briefly timed out post-restart (47s first
  /health); recovered — not related to this slice's changes.
