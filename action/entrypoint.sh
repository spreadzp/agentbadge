#!/usr/bin/env bash
set -euo pipefail

# SLICE-39-2: Entrypoint script for AgentBadge GitHub Action
# Reads INPUT_* env vars, runs agentbadge scan, sets GITHUB_OUTPUT

TARGET="${INPUT_TARGET:-}"
MIN_SCORE="${INPUT_MIN_SCORE:-0}"
REPORT_DIR="${INPUT_REPORT_DIR:-.agentbadge}"
RULESET="${INPUT_RULESET:-agent-readiness@1.2.0}"

if [ -z "$TARGET" ]; then
  echo "::error::Missing required input 'target'"
  exit 1
fi

mkdir -p "$REPORT_DIR"
REPORT_PATH="$REPORT_DIR/agentbadge-report.json"

echo "::group::AgentBadge Scan"
echo "Target: $TARGET"
echo "Min Score: $MIN_SCORE"
echo "Ruleset: $RULESET"
echo "Report Dir: $REPORT_DIR"
echo "::endgroup::"

# Run scan — try local CLI first, fall back to global install
if [ -f "src/agent-readiness/cli/main.ts" ]; then
  bun run src/agent-readiness/cli/main.ts scan "$TARGET" --output "$REPORT_PATH" --json > /tmp/agentbadge-stdout.json 2>/tmp/agentbadge-stderr.log
  SCAN_EXIT=$?
elif command -v agentbadge &>/dev/null; then
  agentbadge scan "$TARGET" --output "$REPORT_PATH" --json > /tmp/agentbadge-stdout.json 2>/tmp/agentbadge-stderr.log
  SCAN_EXIT=$?
else
  echo "::error::AgentBadge CLI not found. Install it with: npm install -g @agentbadge/cli"
  exit 1
fi

if [ $SCAN_EXIT -ne 0 ]; then
  echo "::error::Scan failed with exit code $SCAN_EXIT"
  cat /tmp/agentbadge-stderr.log || true
  exit 1
fi

# If --json was used, stdout has the report; write it to file
if [ -s /tmp/agentbadge-stdout.json ] && [ ! -f "$REPORT_PATH" ]; then
  cp /tmp/agentbadge-stdout.json "$REPORT_PATH"
fi

# Extract score, delta from report using jq or fallback
if command -v jq &>/dev/null; then
  SCORE=$(jq -r '.score.overall // .score.total // 0' "$REPORT_PATH")
  DELTA=$(jq -r '.score.delta // empty' "$REPORT_PATH" 2>/dev/null || echo "")
else
  # Fallback: use bun to parse JSON
  SCORE=$(bun -e "const r=require('$REPORT_PATH'); console.log(r.score?.overall ?? r.score?.total ?? 0)" 2>/dev/null || echo "0")
  DELTA=$(bun -e "const r=require('$REPORT_PATH'); console.log(r.score?.delta ?? '')" 2>/dev/null || echo "")
fi

# Check previous report for delta if not in current report
if [ -z "$DELTA" ] && [ -f "$REPORT_DIR/previous-report.json" ]; then
  if command -v jq &>/dev/null; then
    PREV_SCORE=$(jq -r '.score.overall // .score.total // 0' "$REPORT_DIR/previous-report.json")
  else
    PREV_SCORE=$(bun -e "const r=require('$REPORT_DIR/previous-report.json'); console.log(r.score?.overall ?? r.score?.total ?? 0)" 2>/dev/null || echo "0")
  fi
  DELTA=$((SCORE - PREV_SCORE))
fi

# Save current report as previous for next run
cp "$REPORT_PATH" "$REPORT_DIR/previous-report.json"

# Set outputs via GITHUB_OUTPUT
{
  echo "score=$SCORE"
  echo "report-path=$REPORT_PATH"
  if [ -n "$DELTA" ]; then
    echo "delta=$DELTA"
  else
    echo "delta=0"
  fi
} >> "$GITHUB_OUTPUT"

echo "::group::Scan Results"
echo "Score: $SCORE/100"
if [ -n "$DELTA" ] && [ "$DELTA" != "0" ]; then
  echo "Delta: $DELTA"
fi
echo "Report: $REPORT_PATH"
echo "::endgroup::"

# Threshold check
if [ "$MIN_SCORE" -gt 0 ] && [ "$SCORE" -lt "$MIN_SCORE" ]; then
  echo "::error::Score $SCORE is below minimum threshold $MIN_SCORE"
  exit 2
fi

exit 0
