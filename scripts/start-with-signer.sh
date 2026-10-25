#!/usr/bin/env bash
#
# EPIC-173 (SLICE-173-2): production entrée — API + signer-service on
# one Fly machine (unix socket needs same host).
#
# Custody split (AC1): ARC_SETTLE_KEY is a Fly secret on the machine —
# the signer child inherits it, but the API child is spawned with
# `env -u ARC_SETTLE_KEY` so its env contains NO money key. The API
# reaches the signer only over SIGNER_SOCKET_PATH.
#
# Degraded-mode (AC4 / D-173-4): the API boots even when the signer is
# down — free routes serve; paid routes 503 via the health-gate until
# the supervisor loop brings the signer back.

set -euo pipefail

SOCKET="${SIGNER_SOCKET_PATH:-/tmp/agentbadge-signer.sock}"
export SIGNER_BACKEND=socket

# ── signer child — restart loop, survives crashes ────────────────────
(
  while true; do
    bun src/signer-service/index.ts || true
    echo "[supervisor] signer-service exited — restart in 2s" >&2
    sleep 2
  done
) &
SIGNER_LOOP_PID=$!

# ── shutdown fan-out ─────────────────────────────────────────────────
shutdown() {
  kill "$SIGNER_LOOP_PID" 2>/dev/null || true
  pkill -f "src/signer-service/index.ts" 2>/dev/null || true
  rm -f "$SOCKET"
  exit 0
}
trap shutdown SIGTERM SIGINT

# ── API child — money key stripped from its environment ─────────────
echo "[supervisor] signer on $SOCKET; API starts keyless (ARC_SETTLE_KEY stripped)"
exec env -u ARC_SETTLE_KEY -u SIGNER_KEY bun src/server/index.ts
