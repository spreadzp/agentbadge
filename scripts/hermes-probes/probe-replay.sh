#!/usr/bin/env bash
# probe-replay.sh — idempotency/replay battery for a POST endpoint that
# supports an idempotency-key header.
#
# Usage: probe-replay.sh <url> <valid-json-file> <key> [header ...]
# Probes:
#   R1 baseline submit (key)
#   R2 replay same key + same body   → expect identical requestId+sessionId, duplicate:true
#   R3 replay same key + DIFFERENT body → expect duplicate of ORIGINAL or 409 — flag silent new record
#   R4 submit WITHOUT key            → expect fresh 202 (or endpoint-specific)
#   R5 weird keys: 300-char, unicode, spaces, sql-ish
# Output: R<n> | <desc> | <status> | <observed invariants>
set -u
URL=${1:?url}; VALID=${2:?file}; KEY=${3:?key}; shift 3
HDRS=(); for h in "$@"; do HDRS+=(-H "$h"); done
B=$(mktemp); trap 'rm -f "$B"' EXIT

post() { # key body → status, body in $B
  curl -sS --max-time 15 -o "$B" -w '%{http_code}' \
    -H 'content-type: application/json' "${HDRS[@]}" \
    ${1:+-H "idempotency-key: $1"} -d "$2" "$URL" 2>/dev/null || echo 000
}
field() { python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('$1',''))" < "$B" 2>/dev/null; }

VALID_BODY=$(cat "$VALID")

c1=$(post "$KEY" "$VALID_BODY"); r1_id=$(field requestId); r1_ses=$(field sessionId); r1_dup=$(field duplicate)
echo "R1 | baseline key=$KEY | $c1 | requestId=$r1_id sessionId=$r1_ses duplicate=$r1_dup"

c2=$(post "$KEY" "$VALID_BODY"); r2_id=$(field requestId); r2_ses=$(field sessionId); r2_dup=$(field duplicate)
inv="requestId:$([ "$r1_id" = "$r2_id" ] && echo SAME || echo DIFF-FAIL) sessionId:$([ "$r1_ses" = "$r2_ses" ] && echo SAME || echo DIFF-FAIL)"
echo "R2 | replay same key/body | $c2 | duplicate=$r2_dup $inv"

ALT=$(python3 -c "import json;d=json.load(open('$VALID'));[d.update({k:v+'-ALT'} ) if isinstance(v,str) else None for k,v in d.items()];print(json.dumps(d))" 2>/dev/null || echo "$VALID_BODY")
c3=$(post "$KEY" "$ALT"); r3_id=$(field requestId); r3_dup=$(field duplicate)
echo "R3 | same key DIFFERENT body | $c3 | duplicate=$r3_dup requestId=$r3_id $([ "$r3_id" = "$r1_id" ] && echo 'original-record(OK)' || echo 'NEW-RECORD-FAIL')"

c4=$(post "" "$VALID_BODY"); r4_id=$(field requestId)
echo "R4 | no idempotency key | $c4 | requestId=$r4_id $([ "$r4_id" = "$r1_id" ] && echo COLLIDED-FAIL || echo fresh)"

for wk in "$(python3 -c 'print("k"*300)')" "ключ-🔥" "key with spaces" "k';DROP--"; do
  c=$(post "$wk" "$VALID_BODY")
  echo "R5 | weird-key[${wk:0:24}…] | $c | $(head -c 80 "$B" | tr '\n' ' ')"
done
