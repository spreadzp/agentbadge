#!/usr/bin/env bash
#
# verify-epic-232.sh — EPIC-232 «AI review automation» owner verification.
# Prints PASS/FAIL/SKIP per check. HTTP only — no deploy/migrate/restart.
#
# Usage:
#   ./scripts/verify-epic-232.sh [local|prod] [--with-mutations]
#
# Modes: local → http://localhost:4021 (dev server — `bun run dev`),
#        prod  → https://agentbadge.xyz. Default = prod.
# --with-mutations enables the policy write-leg (set mode → kill back):
# writes append-only PolicyChange rows with reason "OWNER-TEST-…" and
# restores the scenario to off — idempotent, no public ingest-lane cost.
#
# Env (all optional):
#   PROD_ADMIN_API_KEY — break-glass X-Admin-Key → authed section runs;
#                        unset → those checks print SKIP honestly.
#   PROBE_LOCAL_PORT   — dev-server port for `local` (default 4021).
#
# EPIC-232 ships no new public endpoints: its intake piggybacks on the
# 228/230 contracts (feedback/reviews/interaction). The epic-specific
# surface is the operatorAuthed /admin/ai console (+ SSR form posts).
#
set -uo pipefail

MODE="prod"; MUT=0
for a in "$@"; do
  case "$a" in
    local|prod) MODE="$a" ;;
    --with-mutations) MUT=1 ;;
    -h|--help) sed -n '1,20p' "$0"; exit 0 ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done

if [ "$MODE" = "local" ]; then
  BASE="http://localhost:${PROBE_LOCAL_PORT:-4021}"
else
  BASE="https://agentbadge.xyz"
fi
RUN="OWNER-TEST-$(date +%s | tail -c 7)"

pass=0; fail=0; skip=0
ok()   { echo "PASS  $1"; pass=$((pass+1)); }
bad()  { echo "FAIL  $1"; fail=$((fail+1)); }
skipf(){ echo "SKIP  $1"; skip=$((skip+1)); }

echo "== EPIC-232 verify — $MODE ($BASE) =="

# ── 0. Liveness ───────────────────────────────────────────────
code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 "$BASE/health")
if [ "$code" = 200 ]; then
  ok "GET /health → 200"
else
  bad "GET /health → $code"
  if [ "$MODE" = "local" ]; then
    echo "   dev server not running? start it:  bun run dev   (port $PROBE_LOCAL_PORT or 4021)"
    echo "== done: $pass PASS / $fail FAIL / $skip SKIP =="
    exit 1
  fi
fi

# ── 1. Admin gate (unauth) ────────────────────────────────────
for p in "/admin/ai" "/admin/ai/metrics"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 "$BASE$p")
  [ "$code" = 401 ] && ok "GET $p unauth → 401" || bad "GET $p → $code (want 401)"
done
code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 -X POST "$BASE/admin/ai/policies/answer_draft" -d 'mode=shadow')
[ "$code" = 401 ] && ok "POST policies/:scenario unauth → 401" || bad "POST policies → $code (want 401)"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 -X POST "$BASE/admin/ai/policies/answer_draft/kill" -d 'reason=x')
[ "$code" = 401 ] && ok "POST policies/:scenario/kill unauth → 401" || bad "POST kill → $code (want 401)"

# ── 2. Method-guard on admin + intake ─────────────────────────
code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 -X PUT "$BASE/admin/ai")
[ "$code" = 401 ] && ok "PUT /admin/ai → 401 (auth layer)" || bad "PUT /admin/ai → $code"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 -X OPTIONS "$BASE/admin/ai")
[ "$code" = 204 ] && ok "OPTIONS /admin/ai → 204" || bad "OPTIONS → $code (want 204)"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 -X DELETE "$BASE/api/v1/agent/feedback/test123")
[ "$code" = 404 ] && ok "DELETE intake → 404 method-guard" || bad "DELETE intake → $code (want 404)"

# ── 3. Typed negatives (validation precedes write lanes) ──────
code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 -X POST "$BASE/api/v1/agent/feedback" \
  -H 'content-type: application/json' -d '{"broken":')
[ "$code" = 400 ] && ok "malformed JSON body → typed 400" || bad "malformed → $code (want 400)"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 -X POST "$BASE/api/v1/agent/reviews" \
  -H 'content-type: application/json' -d '{}')
[ "$code" = 400 ] && ok "empty contract body → typed 400" || bad "empty body → $code (want 400)"

# ── 4. Authed admin console (break-glass) ─────────────────────
if [ -z "${PROD_ADMIN_API_KEY:-}" ]; then
  skipf "admin authed (SSR + forms) — PROD_ADMIN_API_KEY not set"
else
  AK=(-H "x-admin-key: $PROD_ADMIN_API_KEY")
  AUTHED=0
  code=$(curl -s -o /tmp/v232-page.html -w '%{http_code}' -m 15 "${AK[@]}" "$BASE/admin/ai")
  if [ "$code" = 500 ] && grep -q 'Operator store unavailable' /tmp/v232-page.html; then
    skipf "admin authed — operator store down on $MODE (typed 500 by design; local DB/seed missing?)"
  elif [ "$code" = 200 ]; then
    AUTHED=1
    ok "GET /admin/ai authed → 200"
    grep -q 'master kill' /tmp/v232-page.html \
      && ok "SSR: master kill (AI_AUTOMATION_ENABLED) state rendered" \
      || bad "SSR: no master kill line"
    grep -q 'agent_request' /tmp/v232-page.html \
      && ok "SSR: per-stream usage (agent_request/feedback/review_case)" \
      || bad "SSR: no per-stream usage"
    grep -q 'PolicyChange' /tmp/v232-page.html \
      && ok "SSR: PolicyChange audit table present" \
      || bad "SSR: no audit table"
  else
    bad "GET /admin/ai authed → $code (want 200) — ключ принят? break-glass armed?"
  fi

  if [ "$AUTHED" = 0 ]; then
    skipf "metrics/form-guard/write-leg — auth refused above"
  else
  code=$(curl -s -o /tmp/v232-metrics.html -w '%{http_code}' -m 15 "${AK[@]}" "$BASE/admin/ai/metrics")
  [ "$code" = 200 ] && grep -q 'quality metrics' /tmp/v232-metrics.html \
    && ok "GET /admin/ai/metrics → 200 + E10 projection rendered" \
    || bad "/admin/ai/metrics → $code / missing projection"

  # SSR form-guard: POST without token → typed redirect, zero writes.
  loc=$(curl -s -o /dev/null -w '%{redirect_url}' -m 15 "${AK[@]}" -X POST \
    "$BASE/admin/ai/policies/answer_draft" -d 'mode=shadow')
  case "$loc" in
    *err=form_expired_or_duplicate*) ok "formToken guard → form_expired_or_duplicate";;
    *) bad "formToken guard → $loc";;
  esac

  # ── 5. Mutating leg: policy set → audit → kill restore ──────
  if [ "$MUT" = 0 ]; then
    skipf "policy write-leg (set→audit→kill) — rerun with --with-mutations"
  else
    TOK=$(grep -oE 'value="ft_[^"]+"' /tmp/v232-page.html | head -1 | grep -oE 'ft_[^"]+')
    if [ -z "$TOK" ]; then
      bad "no formToken in SSR — cannot run write-leg"
    else
      loc=$(curl -s -o /dev/null -w '%{redirect_url}' -m 15 "${AK[@]}" -X POST \
        "$BASE/admin/ai/policies/answer_draft" \
        -d "mode=shadow&reason=$RUN verify&formToken=$TOK")
      case "$loc" in
        *ok=updated_answer_draft*) ok "set answer_draft→shadow → ok=updated";;
        *) bad "policy set → $loc";;
      esac

      sleep 1
      curl -s -m 15 "${AK[@]}" "$BASE/admin/ai" -o /tmp/v232-page2.html
      grep -q "$RUN" /tmp/v232-page2.html \
        && ok "PolicyChange audit row appeared (actor=break_glass, reason=$RUN)" \
        || bad "no audit row for $RUN"

      TOK2=$(grep -oE 'value="ft_[^"]+"' /tmp/v232-page2.html | head -1 | grep -oE 'ft_[^"]+')
      loc=$(curl -s -o /dev/null -w '%{redirect_url}' -m 15 "${AK[@]}" -X POST \
        "$BASE/admin/ai/policies/answer_draft/kill" \
        -d "reason=$RUN cleanup&formToken=$TOK2")
      case "$loc" in
        *ok=killed_answer_draft*) ok "kill → mode back to off (E8 kill path)";;
        *) bad "kill → $loc";;
      esac
    fi
  fi
  fi
fi

echo
echo "== done: $pass PASS / $fail FAIL / $skip SKIP =="
[ "$fail" = 0 ]
