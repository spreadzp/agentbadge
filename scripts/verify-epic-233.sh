#!/usr/bin/env bash
#
# verify-epic-233.sh — EPIC-233 «Agent Protocol Exposure» owner verification.
# Prints PASS/FAIL/SKIP per check. HTTP only — no deploy/migrate/restart.
#
# Usage:
#   ./scripts/verify-epic-233.sh [local|prod] [--with-mutations]
#
# Modes: local → http://localhost:4021 (dev server), prod → https://agentbadge.xyz.
# Default = prod. --with-mutations enables write-path checks
# (create_task_request, SSRF reject, replay, break-glass transition, burst-429).
#
# Env (all optional):
#   PROBE_AGENT_KEY      — live agb_ key → keyed-lane checks run; else SKIP.
#   PROBE_WEBHOOK_URL    — callback_url for the write leg (e.g. webhook.site/<uuid>);
#                          unset → POST /mcp/agent-interaction on the same host
#                          (always answers 200 envelope → delivery counts as ok).
#   PROD_ADMIN_API_KEY   — break-glass X-Admin-Key → terminal transition +
#                          real webhook delivery; else that check is SKIP.
#   WEBHOOK_SIGNING_SECRET — enables mathematical v1 verification when the
#                          delivery payload is observable (webhook.site token).
#
# Rate-limit budget (lesson 231): the whole mutating leg = ONE real submit
# + ONE replay (dedupe) + rejects that never reach the lanes + burst.
# Re-running is safe — idempotency_key is per-run, replays dedupe.
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

if [ "$MODE" = "local" ]; then BASE="http://localhost:${PROBE_LOCAL_PORT:-4021}";
else BASE="https://agentbadge.xyz"; fi
MCP="/mcp/agent-interaction"; MAN="/.well-known/agent-interaction.json"
RUN="OWNER-TEST-$(date +%s | tail -c 7)"

pass=0; fail=0; skip=0
ok()   { echo "PASS  $1"; pass=$((pass+1)); }
bad()  { echo "FAIL  $1"; fail=$((fail+1)); }
skipf(){ echo "SKIP  $1"; skip=$((skip+1)); }

# jq-less JSON fetch: jsonget <json> <dot.path>
jsonget() { python3 -c "import json,sys
d=json.loads(sys.argv[1])
cur=d
for s in sys.argv[2].split('.'):
    m=s.rstrip(']').split('[')
    cur=cur.get(m[0]) if isinstance(cur,dict) else None
    if len(m)>1 and cur is not None: cur=cur[int(m[1])] if isinstance(cur,list) else None
    if cur is None: break
print('' if cur is None else (json.dumps(cur) if isinstance(cur,(dict,list)) else cur))" "$1" "$2"; }

rpc() { # rpc <method> [params-json]
  local body
  if [ $# -ge 2 ]; then
    body="{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":$2}"
  else
    body="{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\"}"
  fi
  curl -sS -m 15 -X POST "$BASE$MCP" -H 'content-type: application/json' -d "$body"; }

echo "== EPIC-233 verify — $MODE ($BASE) =="

# ── 1. Discovery ──────────────────────────────────────────────
code=$(curl -s -o /tmp/v233-man.json -w '%{http_code}' "$BASE$MAN")
[ "$code" = 200 ] && ok "manifest GET → 200" || bad "manifest GET → $code (want 200)"
tools_m=$(jsonget "$(cat /tmp/v233-man.json)" "tools" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null)
[ "$tools_m" = 8 ] && ok "manifest tools = 8" || bad "manifest tools = ${tools_m:-?} (want 8)"
wh=$(jsonget "$(cat /tmp/v233-man.json)" "webhooks.status")
[ "$wh" = "degraded" ] && ok "webhooks.status = degraded (honest durability)" || bad "webhooks.status = $wh (want degraded)"

# ── 2. tools/list ↔ manifest parity ──────────────────────────
r=$(rpc tools/list)
names_rpc=$(echo "$r" | python3 -c "import json,sys;print(sorted(t['name'] for t in json.load(sys.stdin)['result']['tools']))" 2>/dev/null)
names_man=$(python3 -c "import json;print(sorted(t['name'] for t in json.load(open('/tmp/v233-man.json'))['tools']))" 2>/dev/null)
[ "$names_rpc" = "$names_man" ] && [ -n "$names_rpc" ] \
  && ok "tools/list ↔ manifest parity (${tools_m} tools)" \
  || bad "parity mismatch: rpc=$names_rpc man=$names_man"

# ── 3. Read tools (keyless) ───────────────────────────────────
r=$(rpc tools/call '{"name":"agentbadge_discover","arguments":{}}')
[ -n "$(jsonget "$r" "result.structuredContent.service")" ] \
  && ok "discover → structuredContent.service" || bad "discover: $r"

r=$(rpc tools/call '{"name":"agentbadge_ask","arguments":{"question":"verify probe"}}')
[ -n "$(jsonget "$r" "result.structuredContent.results")" ] \
  && ok "ask → typed results" || bad "ask: $r"

r=$(rpc tools/call '{"name":"agentbadge_get_request_status","arguments":{"request_id":"rq_owner_no_such"}}')
st=$(jsonget "$r" "result.structuredContent.state")
[ "$st" = "not_found" ] && ok "get_request_status(bogus) → typed not_found (no enumeration leak)" \
  || bad "get_request_status → state=$st (want not_found)"

# ── 4. Envelope errors / method guard ─────────────────────────
r=$(rpc tools/call '{"name":"agentbadge_bogus_tool","arguments":{}}')
[ "$(jsonget "$r" "error.code")" = "-32601" ] && ok "unknown tool → -32601 (roster whitelist)" || bad "unknown tool → $r"
r=$(curl -sS -m 15 -X POST "$BASE$MCP" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"bogus"}')
[ "$(jsonget "$r" "error.code")" = "-32601" ] && ok "unknown rpc method → -32601" || bad "bogus method → $r"
r=$(curl -sS -m 15 -X POST "$BASE$MCP" -H 'content-type: application/json' -d '["x"]')
[ "$(jsonget "$r" "error.code")" = "-32600" ] && ok "batch array → -32600" || bad "batch → $r"
r=$(curl -sS -m 15 -X POST "$BASE$MCP" -H 'content-type: application/json' -d '{"broken":')
[ "$(jsonget "$r" "error.code")" = "-32700" ] && ok "malformed JSON → -32700" || bad "malformed → $r"
code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE$MCP")
[ "$code" = 404 ] && ok "PUT method-guard → 404" || bad "PUT → $code (want 404)"

# ── 5. Keyed lane (optional) ──────────────────────────────────
if [ -n "${PROBE_AGENT_KEY:-}" ]; then
  r=$(curl -sS -m 15 -X POST "$BASE$MCP" -H 'content-type: application/json' \
        -H "authorization: Bearer $PROBE_AGENT_KEY" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
  [ -n "$(jsonget "$r" "result.tools")" ] && ok "keyed lane (Bearer agb_) → tools/list" || bad "keyed lane → $r"
else
  skipf "keyed lane — PROBE_AGENT_KEY not set"
fi

# ── 6. WebMCP carrier ─────────────────────────────────────────
r=$(curl -sS -m 15 "$BASE/for-agents")
echo "$r" | grep -q 'submit-request' && echo "$r" | grep -q 'poll-request' \
  && ok "/for-agents WebMCP inject (submit/poll tools present)" \
  || bad "/for-agents missing WebMCP tools"

# ── 7. Mutations (write path + webhook + burst) ───────────────
if [ "$MUT" = 0 ]; then
  skipf "write path + webhook + burst — rerun with --with-mutations"
else
  CB="${PROBE_WEBHOOK_URL:-$BASE$MCP}"
  KEY="$RUN-w"
  SUB="{\"name\":\"agentbadge_create_task_request\",\"arguments\":{\"kind\":\"question\",\"payload\":{\"text\":\"$RUN owner verify\"},\"idempotency_key\":\"$KEY\",\"callback_url\":\"$CB\"}}"
  r=$(rpc tools/call "$SUB")
  rid=$(jsonget "$r" "result.structuredContent.request_id")
  sec=$(jsonget "$r" "result.structuredContent.webhook_secret")
  rlcode=$(jsonget "$r" "result.structuredContent.error.code")
  # SSRF reject — validation precedes submit lanes, runs even when the
  # lane is saturated (private-IP callback is PASS behaviour).
  r_ssrf=$(rpc tools/call "{\"name\":\"agentbadge_create_task_request\",\"arguments\":{\"payload\":{\"text\":\"$RUN ssrf\"},\"idempotency_key\":\"$RUN-s\",\"callback_url\":\"http://169.254.169.254/x\"}}")
  ec=$(jsonget "$r_ssrf" "result.structuredContent.error.code")
  [ "$ec" = "INVALID_INPUT" ] && ok "SSRF callback 169.254.169.254 → typed INVALID_INPUT (guard PASS)" \
    || bad "SSRF callback → $r_ssrf"

  if [ "$rlcode" = "RATE_LIMITED" ]; then
    # Domain submit lane (~1/2h per fingerprint) already saturated by an
    # earlier run — the limiter answering is itself PASS evidence.
    ok "submit lane RATE_LIMITED (limiter live — retry_after $(jsonget "$r" "result.structuredContent.error.data.retry_after_seconds")s)"
    skipf "submit/replay/poll/webhook — lane window saturated; re-run later for the happy path"
  else
  case "$rid" in rq_*) ok "create_task_request + callback_url → $rid";; *) bad "submit → $r";; esac
  case "$sec" in whsec_*) ok "webhook_secret whsec_ returned once";; *) bad "webhook_secret missing: $r";; esac

  r2=$(rpc tools/call "$SUB")
  dup=$(jsonget "$r2" "result.structuredContent.duplicate")
  rid2=$(jsonget "$r2" "result.structuredContent.request_id")
  [ "$dup" = "True" ] && [ "$rid2" = "$rid" ] \
    && ok "idempotent replay → duplicate + same request_id" \
    || bad "replay: dup=$dup rid2=$rid2 vs $rid"

  r=$(rpc tools/call "{\"name\":\"agentbadge_get_request_status\",\"arguments\":{\"request_id\":\"$rid\"}}")
  st=$(jsonget "$r" "result.structuredContent.state")
  case "$st" in submitted|working) ok "poll own request → $st";; *) bad "poll → state=$st";; esac

  # break-glass terminal transition → real webhook delivery
  if [ -n "${PROD_ADMIN_API_KEY:-}" ] && [ -n "$rid" ]; then
    code=$(curl -s -o /tmp/v233-st.json -w '%{http_code}' -X POST \
      "$BASE/api/ops/requests/$rid/state" -H 'content-type: application/json' \
      -H "x-admin-key: $PROD_ADMIN_API_KEY" -d '{"state":"failed"}')
    [ "$code" = 200 ] && ok "break-glass transition → failed (outbox enqueued)" \
      || bad "ops transition → $code $(cat /tmp/v233-st.json)"
    if [ "$code" = 200 ]; then
      # webhook.site delivery check (only if callback is a webhook.site URL)
      tok=$(echo "$CB" | grep -oE 'webhook.site/[0-9a-f-]{36}' | cut -d/ -f2)
      if [ -n "$tok" ]; then
        sleep 8
        got=$(curl -s -m 15 "https://webhook.site/token/$tok/requests?per_page=5" | python3 -c "import json,sys
for r in json.load(sys.stdin).get('data',[]):
    h=r.get('headers',{}); b=r.get('content','')
    if '$rid' in b and 'x-agentbadge-signature' in {k.lower():v for k,v in h.items()}:
        sig=[v for k,v in h.items() if k.lower()=='x-agentbadge-signature'][0]
        print(sig if isinstance(sig,str) else sig[0]); break")
        case "$got" in t=*,v1=*) ok "delivery landed — signature header t=…,v1=…";; *) bad "no signed delivery at webhook.site for $rid";; esac
      else
        skipf "delivery observation — PROBE_WEBHOOK_URL is not a webhook.site URL (self-sink fallback; check traffic log)"
      fi
    fi
  else
    skipf "break-glass transition + live delivery — PROD_ADMIN_API_KEY not set"
  fi
  fi # /RATE_LIMITED lane

  # burst → 429 — anon lane 60/min per MACHINE (in-memory bucket:
  # effective cap ≈ limit × live replicas). Parallel so the 60s
  # window can't refill between sequential requests.
  hit=$(seq 1 80 | xargs -P 20 -I{} curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE$MCP" \
    -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
    | grep -c '^429$')
  [ "${hit:-0}" -ge 1 ] && ok "burst → $hit×429 (mcpAbuseGuard live; per-machine bucket)" \
    || bad "no 429 after 80-req parallel burst (guard silent?)"
fi

echo
echo "== done: $pass PASS / $fail FAIL / $skip SKIP =="
[ "$fail" = 0 ]
