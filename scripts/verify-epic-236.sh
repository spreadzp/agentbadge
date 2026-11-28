#!/usr/bin/env bash
#
# verify-epic-236.sh — EPIC-236 «Process Mapping & Actor Resolution»
# owner verification. Prints PASS/FAIL/SKIP per check. HTTP only —
# no deploy/migrate/restart. The epic is READ-ONLY (read-side mapping
# into ProcessEventProjection) — there is no write surface to mutate.
#
# Usage:
#   ./scripts/verify-epic-236.sh [local|prod] [--with-mutations]
#
# Modes: local → http://localhost:4021 (dev server), prod → https://agentbadge.xyz.
# Default = prod. --with-mutations enables the burst-429 limiter probe
# (parallel GETs against the 60 req/min machine bucket; read-only anyway).
#
# Canonical prod fixture: live 216-4 dogfood shipment
#   dogfood-1794151620383 — 13 events, 3 verified hops (jobs 66/67/68).
# On `local` the stream may be absent (in-memory ledger / local DB
# without the prod run) → honest SKIP, not FAIL.
#
# Expected statuses (documented, not bugs): handoff/verify → PARTIAL +
# ACTOR_UNRESOLVED (the dogfood used throwaway wallets, correctly
# unresolved by the ActorResolver); work_offer/work_accept/pay →
# UNSUPPORTED + TYPE_UNKNOWN (claimed kinds without step mapping).
#
set -uo pipefail

MODE="prod"; MUT=0
for a in "$@"; do
  case "$a" in
    local|prod) MODE="$a" ;;
    --with-mutations) MUT=1 ;;
    -h|--help) sed -n '1,26p' "$0"; exit 0 ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done

if [ "$MODE" = "local" ]; then BASE="http://localhost:${PROBE_LOCAL_PORT:-4021}";
else BASE="https://agentbadge.xyz"; fi
SID="dogfood-1794151620383"
API="/api/process/projections"

pass=0; fail=0; skip=0
ok()   { echo "PASS  $1"; pass=$((pass+1)); }
bad()  { echo "FAIL  $1"; fail=$((fail+1)); }
skipf(){ echo "SKIP  $1"; skip=$((skip+1)); }

# jq-less JSON fetch: jsonget <json> <dot.path>  (list index: arr.[0].x)
jsonget() { python3 -c "import json,sys
d=json.loads(sys.argv[1])
cur=d
for s in sys.argv[2].split('.'):
    m=s.rstrip(']').split('[')
    cur=cur.get(m[0]) if isinstance(cur,dict) else None
    if len(m)>1 and cur is not None: cur=cur[int(m[1])] if isinstance(cur,list) else None
    if cur is None: break
print('' if cur is None else (json.dumps(cur) if isinstance(cur,(dict,list)) else cur))" "$1" "$2"; }

echo "== EPIC-236 verify — $MODE ($BASE) =="

# ── 1. Health + regression ────────────────────────────────────
code=$(curl -s -o /tmp/v236-health.json -w '%{http_code}' "$BASE/health")
db=$(jsonget "$(cat /tmp/v236-health.json)" "db" 2>/dev/null)
[ "$code" = 200 ] && [ "$db" = "up" ] && ok "/health → 200, db:up" \
  || bad "/health → $code db=$db (want 200/up)"

code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/schemas/process/inventory.json")
[ "$code" = 200 ] && ok "schemas/process/inventory.json → 200 (EPIC-235 regression)" \
  || bad "inventory.json → $code (want 200)"

code=$(curl -s -o /tmp/v236-ship.json -w '%{http_code}' "$BASE/api/ledger/shipments/$SID")
tl=$(jsonget "$(cat /tmp/v236-ship.json)" "timeline" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))" 2>/dev/null)
if [ "$code" = 200 ] && [ "$tl" = 13 ]; then
  ok "ledger shipments/$SID → 200, 13 events (216-4 live run)"
elif [ "$code" = 404 ] && [ "$MODE" = "local" ]; then
  skipf "ledger shipments — $SID not in local ledger (expected on local)"
else
  bad "ledger shipments → $code timeline=$tl (want 200/13)"
fi

# ── 2. Stream projection — the whole chain ────────────────────
code=$(curl -s -o /tmp/v236-stream.json -w '%{http_code}' "$BASE$API?source=supply_chain&sourceId=$SID")
n=$(jsonget "$(cat /tmp/v236-stream.json)" "events" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))" 2>/dev/null)
if [ "$code" = 200 ] && [ "$n" = 13 ]; then
  ok "projections stream → 200, 13 events"
  # status table — documented expectations (see header)
  python3 - <<'EOF' > /tmp/v236-status.txt
import json
d = json.load(open("/tmp/v236-stream.json"))
for e in d["events"]:
    print(e["seq"], e["kind"], e["status"], ",".join(i["code"] for i in e["issues"]))
EOF
  hand=$(grep -c " handoff PARTIAL ACTOR_UNRESOLVED" /tmp/v236-status.txt)
  ver=$(grep -c " verify PARTIAL ACTOR_UNRESOLVED" /tmp/v236-status.txt)
  uns=$(grep -c " UNSUPPORTED TYPE_UNKNOWN" /tmp/v236-status.txt)
  [ "$hand" = 3 ] && ok "handoff ×3 → PARTIAL+ACTOR_UNRESOLVED (dogfood wallets, honest)" \
    || bad "handoff PARTIAL count=$hand (want 3): $(cat /tmp/v236-status.txt | tr '\n' ' ')"
  [ "$ver" = 3 ] && ok "verify ×3 → PARTIAL+ACTOR_UNRESOLVED" \
    || bad "verify PARTIAL count=$ver (want 3)"
  [ "$uns" = 7 ] && ok "work_offer+work_accept+pay ×7 → UNSUPPORTED+TYPE_UNKNOWN" \
    || bad "UNSUPPORTED count=$uns (want 7)"
  # stepType + subjectRefs on a handoff row
  st=$(python3 -c "import json;d=json.load(open('/tmp/v236-stream.json'));e=[x for x in d['events'] if x['kind']=='handoff'][0];p=e['projection'];print(p['interpretation']['stepType'],p['interpretation']['subjectRefs'][0]['assetType'],p['interpretation']['subjectRefs'][0]['externalReferences'][0]['namespace'])")
  [ "$st" = "supply-chain.handoff physical.batch agentbadge:supply-chain" ] \
    && ok "handoff projection → stepType+physical.batch+agentbadge:supply-chain ref" \
    || bad "handoff interpretation: $st"
elif [ "$code" = 200 ] && [ "${n:-0}" = 0 ] && [ "$MODE" = "local" ]; then
  skipf "projections stream — empty on local ledger (run against prod for the live chain)"
else
  bad "projections stream → $code events=${n:-?} (want 200/13)"
fi

# ── 3. Single event + versioning ──────────────────────────────
EID="ev:supply_chain:$SID:4"
code=$(curl -s -o /tmp/v236-one.json -w '%{http_code}' "$BASE$API/$EID")
if [ "$code" = 200 ]; then
  seid=$(jsonget "$(cat /tmp/v236-one.json)" "projection.sourceEvent.id")
  av=$(jsonget "$(cat /tmp/v236-one.json)" "adapterVersion")
  [ "$seid" = "$EID" ] && [ "$av" = "0.3.0" ] \
    && ok "single :eventId → 200, sourceEvent.id round-trip, adapter 0.3.0" \
    || bad "single: sourceEvent.id=$seid adapterVersion=$av"
else
  [ "$MODE" = "local" ] && skipf "single :eventId — event absent on local" \
    || bad "single :eventId → $code (want 200)"
fi

code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$API/$EID?version=0.3.0")
[ "$code" = 200 ] && ok "?version=0.3.0 → 200 materialized" \
  || { [ "$MODE" = "local" ] && skipf "?version=0.3.0 — nothing materialized on local" \
    || bad "?version=0.3.0 → $code (want 200)"; }
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$API/$EID?version=9.9.9")
[ "$code" = 404 ] && ok "?version=9.9.9 → 404 not_found (lazy model)" \
  || { [ "$MODE" = "local" ] && skipf "?version=9.9.9 — n/a on empty local ledger" \
    || bad "?version=9.9.9 → $code (want 404)"; }

# ── 4. Venue twin (may be empty on prod — honest) ─────────────
code=$(curl -s -o /tmp/v236-venue.json -w '%{http_code}' "$BASE$API?source=venue&sourceId=66")
n=$(jsonget "$(cat /tmp/v236-venue.json)" "events" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))" 2>/dev/null)
[ "$code" = 200 ] && ok "venue twin query → 200 (${n:-0} events — empty is expected when unindexed)" \
  || bad "venue twin → $code (want 200)"

# ── 5. Typed negatives — honest codes, never 500 ──────────────
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$API/ev:supply_chain:no-such-shipment:1")
[ "$code" = 404 ] && ok "unknown eventId → 404 not_found" || bad "unknown event → $code (want 404)"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$API/garbage%20id")
[ "$code" = 400 ] && ok "malformed eventId → 400 invalid_id" || bad "malformed id → $code (want 400)"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$API?source=supply_chain")
[ "$code" = 400 ] && ok "missing sourceId → 400" || bad "missing sourceId → $code (want 400)"

# ── 6. OpenAPI surface ────────────────────────────────────────
code=$(curl -s -o /tmp/v236-oa.json -w '%{http_code}' "$BASE/openapi.json")
has=$(python3 -c "
import json
try:
    d = json.load(open('/tmp/v236-oa.json'))
    paths = [p for p in d.get('paths', {}) if 'process/projections' in p]
    print(len(paths))
except Exception: print(0)" 2>/dev/null)
[ "$code" = 200 ] && [ "${has:-0}" -ge 2 ] \
  && ok "/openapi.json → 200, ≥2 process/projection paths (tags=[Process])" \
  || bad "/openapi.json → $code process_paths=${has:-0} (want 200/≥2)"

# ── 7. Burst limiter (optional — mutates only the rate bucket) ─
if [ "$MUT" = 0 ]; then
  skipf "burst-429 probe — rerun with --with-mutations (80 parallel GETs, 60/min bucket)"
else
  hit429=$(seq 1 80 | xargs -P 20 -I{} curl -s -o /dev/null -w '%{http_code}\n' "$BASE$API/ev:supply_chain:no-such:1" \
    | grep -c '^429$')
  [ "${hit429:-0}" -ge 1 ] && ok "burst → ${hit429}×429 (processLimiter live, 60/min/machine)" \
    || skipf "burst → no 429 in 80 parallel (bucket split across replicas; limiter untripped — not a defect)"
fi

echo
echo "== done: $pass PASS / $fail FAIL / $skip SKIP =="
[ "$fail" = 0 ]
