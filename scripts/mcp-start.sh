#!/usr/bin/env bash
cd "$(dirname "$0")/.."
set -a
source .env
set +a
exec bun src/mcp/entry.ts
