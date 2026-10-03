#!/usr/bin/env bash
# SLICE-155-7: dogfood runbook — agent wallet lifecycle on a live
# server. Covers: register → envelope → paid call → cap deny →
# audit read. Idempotent; safe to re-run.
#
# Env:
#   BASE          — http://localhost:4021 (default)
#   OPERATOR_KEY  — 0x… EOA private key signing API calls (required)
#   AGENT_WALLET  — 0x… registered agent wallet (or generate one)
#   VENUE_ID      — optional venue scope
#   PAY_URL       — x402 pay endpoint, default $BASE/api/eaas/verdict
set -euo pipefail
BASE="${BASE:-http://localhost:4021}"
PAY_URL="${PAY_URL:-$BASE/api/eaas/verdict}"
: "${OPERATOR_KEY:?need an EOA private key (signs API calls)}"

need() { command -v "$1" >/dev/null || { echo "missing $1"; exit 1; }; }
need bun; need curl; need jq

# EIP-191 sig over "wallet:method:path:timestamp" — same challenge
# the server verifies (agent-auth buildAccessChallenge).
sign() { # method path wallet -> "sig ts wallet"
  bun -e '
    import { privateKeyToAccount } from "viem/accounts";
    import { buildAccessChallenge } from "./src/server/middleware/agent-auth";
    const [key, method, path, wallet] = process.argv.slice(1);
    const ts = Math.floor(Date.now()/1000);
    const a = privateKeyToAccount(key);
    const sig = await a.signMessage({
      message: buildAccessChallenge({wallet,method,path,timestamp:ts})});
    console.log(JSON.stringify({sig,ts}));
  ' "$OPERATOR_KEY" "$1" "$2" "$3"
}

req() { # sig-method method path wallet [json]
  local m="$2" p="$3" w="$4" body="${5:-}"
  local s; s=$(sign "$m" "$p" "$w")
  local args=(-s -o /tmp/aw-resp -w "%{http_code}" -X "$m" "$BASE$p"
    -H "x-wallet: $w" -H "x-sig: $(jq -r .sig <<<"$s")"
    -H "x-timestamp: $(jq -r .ts <<<"$s")")
  [ -n "$body" ] && args+=(-H "content-type: application/json" -d "$body")
  echo "$(curl "${args[@]}")"
}

OPERATOR=$(bun -e 'import{privateKeyToAccount}from"viem/accounts";
  console.log(privateKeyToAccount(process.argv[1]).address)' "$OPERATOR_KEY")
AGENT_WALLET="${AGENT_WALLET:-$(bun -e 'import{generatePrivateKey,
  privateKeyToAccount}from"viem/accounts";
  console.log(privateKeyToAccount(generatePrivateKey()).address)')}"
echo "== operator: $OPERATOR"
echo "== agent wallet: $AGENT_WALLET"

step() { echo; echo "── $*"; }

step "1. register wallet (POST /api/wallets)"
p="/api/wallets"
code=$(req POST "$p" "$OPERATOR" \
  "{\"address\":\"$AGENT_WALLET\",\"label\":\"dogfood\",\"kind\":\"eoa\"}")
echo "  $code $(head -c 200 /tmp/aw-resp)"
[[ "$code" =~ ^(200|201|409)$ ]] || exit 1

step "2. envelope per-tx \$0.01 daily \$0.05 (PATCH …/envelope)"
p="/api/wallets/$AGENT_WALLET/envelope"
code=$(req PATCH "$p" "$OPERATOR" '{"perTxUsd":0.01,"dailyUsd":0.05}')
echo "  $code $(head -c 200 /tmp/aw-resp)"; [ "$code" = 200 ] || exit 1

step "3. envelope read-back"
code=$(req GET "$p" "$OPERATOR")
echo "  $code $(head -c 300 /tmp/aw-resp)"; [ "$code" = 200 ] || exit 1

step "4. paid call (x402 settle via hooks → envelope reserve/settle)"
echo "  → $PAY_URL  (payment signature via x402-client — see note)"
cat <<'NOTE'
  The platform settle path runs through x402 hooks — send a real
  x402 payment here (shared/x402-pay.ts x402Fetch) with header
  x-wallet: $AGENT_WALLET so the enforcer attributes the spend.
  On success: ledger entry state=settled.
NOTE

step "5. cap-deny check (envelope per-tx \$0.01 vs request > cap)"
echo "  → trigger any x402 call whose price exceeds per-tx — expect"
echo "    402 spend_cap {cap:perTx} + spend.cap_denied alert event"

step "6. audit feed (GET /api/wallets/:a/audit)"
p="/api/wallets/$AGENT_WALLET/audit"
code=$(req GET "$p" "$OPERATOR")
echo "  $code"; jq '{entries:[.entries[]?|{kind,amountUsd,state,txHash}],
    alerts:[.alerts[]?|{type}]}' /tmp/aw-resp 2>/dev/null || \
    head -c 300 /tmp/aw-resp
[ "$code" = 200 ] || exit 1

step "7. balance + funding"
p="/api/wallets/$AGENT_WALLET/balance"
code=$(req GET "$p" "$OPERATOR")
echo "  $code $(head -c 200 /tmp/aw-resp)"

echo; echo "== dogfood done — envelope+audit live. For an x402"
echo "   settle use: bun run agents/bstock-pay.ts (AGENT_WALLET_ADDRESS set)"
