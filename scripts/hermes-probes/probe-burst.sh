#!/usr/bin/env bash
# probe-burst.sh — rate-limit probe: fire N requests, tally statuses,
# report where throttling kicks in. Keep N modest (<150) — this is a
# correctness probe, not a load test.
#
# Usage: probe-burst.sh <url> <n> [valid-json-file]
#   3rd arg optional: if given, POSTs the file each time; else GETs.
# Output: per-request dots suppressed; summary lines + first-429 index.
set -u
URL=${1:?url}; N=${2:-60}; FILE=${3:-}
B=$(mktemp); trap 'rm -f "$B"' EXIT
declare -A tally=()
first429=0; first5xx=0; i=1
while [ $i -le "$N" ]; do
  if [ -n "$FILE" ]; then
    c=$(curl -sS --max-time 10 -o "$B" -w '%{http_code}' \
      -H 'content-type: application/json' -d @"$FILE" "$URL" 2>/dev/null || echo 000)
  else
    c=$(curl -sS --max-time 10 -o "$B" -w '%{http_code}' "$URL" 2>/dev/null || echo 000)
  fi
  tally[$c]=$(( ${tally[$c]:-0} + 1 ))
  [ "$c" = 429 ] && [ $first429 -eq 0 ] && { first429=$i; hdr=$(head -c 120 "$B" | tr '\n' ' '); }
  case $c in 5*) [ $first5xx -eq 0 ] && first5xx=$i ;; esac
  i=$((i+1))
done
echo "BURST | n=$N target=$URL | first-429-at:${first429:-none} first-5xx-at:${first5xx:-none}"
for s in "${!tally[@]}"; do echo "BURST | status $s | count ${tally[$s]}"; done
[ -n "${hdr:-}" ] && echo "BURST | 429-body | $hdr"
