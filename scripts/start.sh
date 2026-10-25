#!/usr/bin/env bash
#
# EPIC-173 (SLICE-173-2): container entrypoint.
#   SIGNER_BACKEND=socket → API + signer-service supervised together
#                           (start-with-signer.sh; money key stripped
#                           from the API child env)
#   anything else        → plain API, identical to the old CMD.

set -euo pipefail

if [ "${SIGNER_BACKEND:-env}" = "socket" ]; then
  exec bash scripts/start-with-signer.sh
fi
exec bun src/server/index.ts
