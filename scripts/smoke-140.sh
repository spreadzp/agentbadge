#!/usr/bin/env bash
# smoke-140.sh — EPIC-140 baseline smoke checklist.
#
# Verifies key server endpoints after each Track A refactor slice.
# Idempotent, read-only: only GETs + auth-negative POSTs.
#
# Usage:
#   ./scripts/smoke-140.sh [BASE_URL]
# Default BASE_URL: http://localhost:4021
#
# Exit code: 0 = all checks PASS, 1 = at least one FAIL.

set -u

BASE_URL="${1:-http://localhost:4021}"
PASS=0
FAIL=0
CURL_OPTS=(--max-time 10 -s -o /dev/null)

check() {
  # check <name> <expected_codes_csv> <method> <path> [extra curl args...]
  local name="$1" expected="$2" method="$3" path="$4"
  shift 4
  local code
  code=$(curl "${CURL_OPTS[@]}" -w "%{http_code}" -X "$method" "$@" "${BASE_URL}${path}" 2>/dev/null)
  if [[ ",$expected," == *",$code,"* ]]; then
    echo "PASS  $name  [$method $path -> $code]"
    PASS=$((PASS + 1))
  else
    echo "FAIL  $name  [$method $path -> $code, expected: $expected]"
    FAIL=$((FAIL + 1))
  fi
}

check_body() {
  # check_body <name> <expected_code> <grep_pattern> <method> <path> [extra curl args...]
  local name="$1" expected="$2" pattern="$3" method="$4" path="$5"
  shift 5
  local out code
  out=$(curl --max-time 10 -s -w $'\n%{http_code}' -X "$method" "$@" "${BASE_URL}${path}" 2>/dev/null)
  code=$(echo "$out" | tail -1)
  if [[ "$code" == "$expected" ]] && echo "$out" | head -n -1 | grep -q "$pattern"; then
    echo "PASS  $name  [$method $path -> $code, body matches '$pattern']"
    PASS=$((PASS + 1))
  else
    echo "FAIL  $name  [$method $path -> $code, expected: $expected + body '$pattern']"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== EPIC-140 smoke checklist against $BASE_URL ==="

# Health
check_body "health JSON"        200 '"status":"healthy"' GET /health
check_body "api health alias"   200 '"status":"healthy"' GET /api/health

# OpenAPI / docs
check "api specs"               200 GET /api/specs
check "openapi.json"            200 GET /openapi.json
check "openapi.yaml"            200 GET /openapi.yaml
# /docs redirects to GitBook (302) — accept 200 or 302
check "docs"                    200,302 GET /docs

# Catalog
check "catalog"                 200 GET /catalog

# MCP passport namespace — JSON-RPC tools/list
check_body "mcp passport tools/list" 200 '"jsonrpc"' POST /mcp/passport \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# 404 — JSON for API clients, HTML for browsers
check "404 JSON accept"         404 GET /nonexistent-xyz -H "Accept: application/json"
check "404 HTML accept"         404 GET /nonexistent-xyz -H "Accept: text/html"

# Static / well-known
check "favicon.ico"             200 GET /favicon.ico
check "manifest.json"           200 GET /manifest.json
check "security.txt"            200 GET /.well-known/security.txt

# Auth-negative: indexnow without credentials must not succeed.
# 401/403 when ADMIN_API_KEY configured; 500 when not configured (baseline 2026-09-21).
check "indexnow no auth"        401,403,500 POST /api/indexnow

# Payment gate: passport request without payment must be rejected.
check "passport/request unpaid" 401,402 POST /passport/request \
  -H "Content-Type: application/json" -d '{}'

echo "=== RESULT: $PASS PASS, $FAIL FAIL ==="
[[ $FAIL -eq 0 ]]
