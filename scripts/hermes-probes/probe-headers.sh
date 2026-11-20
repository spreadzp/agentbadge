#!/usr/bin/env bash
# probe-headers.sh — response-header audit for one URL.
# Flags: missing no-store on mutable/pollable surface, positive max-age,
# deprecated without notice headers, server fingerprint leaks.
#
# Usage: probe-headers.sh <url> [method] [header ...]
#   method  GET (default) | POST | OPTIONS
# Output: HEADER | name | value  +  AUDIT | <rule> | PASS|FAIL|ANOMALY
set -u
URL=${1:?url}; METHOD=${2:-GET}; shift 2 || true
HDRS=(); for h in "$@"; do HDRS+=(-H "$h"); done
H=$(mktemp); trap 'rm -f "$H"' EXIT
curl -sS --max-time 15 -D "$H" -o /dev/null -X "$METHOD" "${HDRS[@]}" "$URL" 2>/dev/null

awk 'NR>1 && NF {gsub(/\r/,""); print "HEADER | " $0}' "$H"

cc=$(grep -i '^cache-control:' "$H" | tr -d '\r' | cut -d: -f2-)
dep=$(grep -ci '^deprecation:' "$H")
sun=$(grep -ci '^sunset:' "$H")
srv=$(grep -i '^server:\|^x-powered-by:' "$H" | tr -d '\r' | tr '\n' ';')

if echo "$cc" | grep -qi 'no-store'; then
  echo "AUDIT | mutable-surface-no-store | PASS"
elif echo "$cc" | grep -qi 'public\|max-age=[1-9]'; then
  echo "AUDIT | mutable-surface-no-store | FAIL cache-control:$cc"
elif [ -z "$cc" ]; then
  echo "AUDIT | mutable-surface-no-store | ANOMALY no-cache-control"
else
  echo "AUDIT | mutable-surface-no-store | $cc"
fi
[ "$dep" -gt 0 ] && [ "$sun" -gt 0 ] \
  && echo "AUDIT | deprecation-pair | PASS" \
  || echo "AUDIT | deprecation-pair | n/a (dep:$dep sun:$sun)"
[ -n "$srv" ] && echo "AUDIT | server-fingerprint | ANOMALY $srv" \
              || echo "AUDIT | server-fingerprint | PASS"
