#!/usr/bin/env bash
# probe-fuzz-post.sh — generic adversarial POST fuzzing against one endpoint.
#
# Usage: probe-fuzz-post.sh <url> <valid-json-file> [header ...]
#   url            full endpoint URL
#   valid-json     file with a KNOWN-VALID request body (control case)
#   header         extra headers (e.g. -H equivalents as plain strings:
#                  'x-admin-key: X' 'x-operator-id: BOT-TEST-X')
#
# Output: one line per probe —
#   FUZZ-<n> | <mutation> | <http-status> | PASS|FAIL|ANOMALY | body:<200 chars>
# Verdict heuristic (endpoint-classify by CALLER afterwards):
#   PASS    = 4xx on invalid input, 2xx on control
#   FAIL    = 2xx on clearly invalid input, or 5xx anywhere
#   ANOMALY = timeout/000, odd status, oversized body on 4xx
set -u
URL=${1:?url}; VALID=${2:?valid-json-file}; shift 2
HDRS=(); for h in "$@"; do HDRS+=(-H "$h"); done
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
BODY="$WORK/body"

# ── generate mutation payloads ───────────────────────────────────────────────
python3 - "$VALID" "$WORK" <<'PY'
import json, sys, os
valid_path, work = sys.argv[1], sys.argv[2]
base = json.load(open(valid_path))
out = []
def add(name, payload): out.append((name, payload))
# raw-body mutations
add("empty-body", "")
add("malformed-json", '{"type":"question",')
add("json-array", "[]")
add("json-scalar", '"just a string"')
add("duplicate-keys", json.dumps({"a":1}).replace("}","") + ',"a":2}' if "a" in base else '{"dup":1,"dup":2}')
# per-field mutations
for k in list(base.keys()):
    minus = {x: y for x, y in base.items() if x != k}
    add(f"remove-{k}", json.dumps(minus))
    m = dict(base); m[k] = None; add(f"null-{k}", json.dumps(m))
    if isinstance(base[k], str):
        m = dict(base); m[k] = 12345; add(f"num-{k}", json.dumps(m))
        m = dict(base); m[k] = True; add(f"bool-{k}", json.dumps(m))
        m = dict(base); m[k] = "x" * 70_000; add(f"huge-70k-{k}", json.dumps(m))
        for tag, s in [
            ("xss",   '<img src=x onerror=alert(1)>'),
            ("sqli",  "' OR '1'='1"),
            ("tmpl",  "${7*7}{{7*7}}"),
            ("bidi",  "a‮b"),
            ("nul",   "pre\x00post"),
            ("emoji", "🔥" * 500),
            ("nl",    "a" + "\n" * 2000 + "b"),
        ]:
            m = dict(base); m[k] = s; add(f"inject-{tag}-{k}", json.dumps(m))
    elif isinstance(base[k], (int, float)):
        m = dict(base); m[k] = -1; add(f"neg-{k}", json.dumps(m))
        m = dict(base); m[k] = "NaN-string"; add(f"str-{k}", json.dumps(m))
        m = dict(base); m[k] = 2**63; add(f"int64-{k}", json.dumps(m))
    elif isinstance(base[k], list):
        m = dict(base); m[k] = [{}] * 50; add(f"list50-{k}", json.dumps(m))
        m = dict(base); m[k] = "notalist"; add(f"strlist-{k}", json.dumps(m))
    elif isinstance(base[k], dict):
        m = dict(base); m[k] = {f"k{i}": "v" * 1000 for i in range(50)}; add(f"map50-{k}", json.dumps(m))
# unknown fields
m = dict(base); m["__proto__"] = {"polluted": True}; add("proto-pollution", json.dumps(m))
m = dict(base); m["unknownField"] = "x"; add("unknown-field", json.dumps(m))
m = dict(base); m["admin"] = True; m["role"] = "admin"; add("privesc-fields", json.dumps(m))
manifest = open(os.path.join(work, "manifest.tsv"), "w")
for i, (name, payload) in enumerate(out):
    pf = os.path.join(work, f"p{i}")
    open(pf, "w").write(payload)
    manifest.write(f"{i}\t{name}\t{pf}\n")
manifest.close()
PY

# ── control request ──────────────────────────────────────────────────────────
ctl=$(curl -sS --max-time 15 -o "$BODY" -w '%{http_code}' \
  -H 'content-type: application/json' "${HDRS[@]}" -d @"$VALID" "$URL" 2>/dev/null || echo 000)
case $ctl in
  2*) echo "CONTROL | valid-body | $ctl | PASS | body:$(head -c 200 "$BODY" | tr '\n' ' ')" ;;
  *)  echo "CONTROL | valid-body | $ctl | FAIL | body:$(head -c 200 "$BODY" | tr '\n' ' ')" ; echo "ABORT: control failed — fix URL/body/headers" >&2 ;;
esac

# ── mutation loop ────────────────────────────────────────────────────────────
while IFS=$'\t' read -r i name pf; do
  code=$(curl -sS --max-time 15 -o "$BODY" -w '%{http_code}' \
    -H 'content-type: application/json' "${HDRS[@]}" -d @"$pf" "$URL" 2>/dev/null || echo 000)
  sz=$(wc -c < "$BODY" | tr -d ' ')
  verdict=ANOMALY
  case $code in
    2*) verdict=FAIL ;;        # accepted invalid input
    400|401|403|404|409|413|415|422|429) verdict=PASS ;;
    5*) verdict=FAIL ;;
    000) verdict=ANOMALY ;;
  esac
  snippet=$(head -c 160 "$BODY" | tr '\n\t' '  ')
  printf 'FUZZ-%s | %s | %s | %s | bytes:%s body:%s\n' "$i" "$name" "$code" "$verdict" "$sz" "$snippet"
done < "$WORK/manifest.tsv"
