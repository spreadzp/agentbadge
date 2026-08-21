# A/B Test Log — EPIC-72 MCP Namespacing

> Experiment 1: Full harness (token reduction) vs raw agent (manual workflow)
> Date started: 2026-08-21

## Setup

| Item | Value |
|---|---|
| Epic | EPIC-72: MCP Server Namespacing |
| Slices | 72-1 through 72-10 |
| Git repo | `hackathon/server` |
| Control branch | `ab-control-epic72` |
| Harness branch | `ab-harness-epic72` |
| Control worktree | `/home/dev/Projects/my/agents-ai/hedera/hackathon/server-ab-control` |
| Harness worktree | `/home/dev/Projects/my/agents-ai/hedera/hackathon/server-ab-harness` |
| Base commit | `fc8d4b7` (main) |

## Per-slice results

### SLICE-72-1: Tool Audit & Namespace Mapping

| Metric | Control (raw) | Harness (token reduction) |
|---|---|---|
| Tokens (estimated) | ~12k | TBD |
| Tool calls | 18 | TBD |
| Wall-clock time | ~6 min | TBD |
| Tests pass | N/A (documentation slice) | TBD |
| Files created | 3 (namespace-mapping.md, tool-inventory.txt, current.md) | TBD |
| Acceptance criteria | 5/5 ✅ | TBD / 5 |
| Commits | 1 | TBD |
| Errors | 0 | TBD |
| Retries | 0 | TBD |
| RTK savings | N/A | TBD |
| Caveman active | N/A | TBD |
| Notes | 65 tools audited from source grep. 17 parity-tools reclassified. Source count corrected from 66 to 65. | |

### SLICE-72-2: Multi-registry architecture

| Metric | Control (raw) | Harness (token reduction) |
|---|---|---|
| Tokens (estimated) | TBD | TBD |
| Tool calls | TBD | TBD |
| Wall-clock time | TBD | TBD |
| Tests pass | TBD | TBD |
| Files modified | TBD | TBD |
| Acceptance criteria | TBD / N | TBD / N |
| Commits | TBD | TBD |
| Errors | TBD | TBD |
| Retries | TBD | TBD |
| RTK savings | N/A | TBD |
| Notes | | |

### SLICE-72-3: Namespace HTTP routes

| Metric | Control (raw) | Harness (token reduction) |
|---|---|---|
| Tokens (estimated) | TBD | TBD |
| Tool calls | TBD | TBD |
| Wall-clock time | TBD | TBD |
| Tests pass | TBD | TBD |
| Files modified | TBD | TBD |
| Acceptance criteria | TBD / N | TBD / N |
| Commits | TBD | TBD |
| Errors | TBD | TBD |
| Notes | | |

### SLICE-72-4: passport-mcp wiring

| Metric | Control (raw) | Harness (token reduction) |
|---|---|---|
| Tokens (estimated) | TBD | TBD |
| Tool calls | TBD | TBD |
| Wall-clock time | TBD | TBD |
| Tests pass | TBD | TBD |
| Files modified | TBD | TBD |
| Acceptance criteria | TBD / N | TBD / N |
| Commits | TBD | TBD |
| Notes | | |

### SLICE-72-5: market-mcp wiring

| Metric | Control (raw) | Harness (token reduction) |
|---|---|---|
| Tokens (estimated) | TBD | TBD |
| Tool calls | TBD | TBD |
| Wall-clock time | TBD | TBD |
| Tests pass | TBD | TBD |
| Files modified | TBD | TBD |
| Acceptance criteria | TBD / N | TBD / N |
| Commits | TBD | TBD |
| Notes | | |

### SLICE-72-6: discovery-mcp wiring

| Metric | Control (raw) | Harness (token reduction) |
|---|---|---|
| Tokens (estimated) | TBD | TBD |
| Tool calls | TBD | TBD |
| Wall-clock time | TBD | TBD |
| Tests pass | TBD | TBD |
| Files modified | TBD | TBD |
| Acceptance criteria | TBD / N | TBD / N |
| Commits | TBD | TBD |
| Notes | | |

### SLICE-72-7: audit-mcp wiring

| Metric | Control (raw) | Harness (token reduction) |
|---|---|---|
| Tokens (estimated) | TBD | TBD |
| Tool calls | TBD | TBD |
| Wall-clock time | TBD | TBD |
| Tests pass | TBD | TBD |
| Files modified | TBD | TBD |
| Acceptance criteria | TBD / N | TBD / N |
| Commits | TBD | TBD |
| Notes | | |

### SLICE-72-8: Well-known descriptors

| Metric | Control (raw) | Harness (token reduction) |
|---|---|---|
| Tokens (estimated) | TBD | TBD |
| Tool calls | TBD | TBD |
| Wall-clock time | TBD | TBD |
| Tests pass | TBD | TBD |
| Files modified | TBD | TBD |
| Acceptance criteria | TBD / N | TBD / N |
| Commits | TBD | TBD |
| Notes | | |

### SLICE-72-9: Stdio + backward compat

| Metric | Control (raw) | Harness (token reduction) |
|---|---|---|
| Tokens (estimated) | TBD | TBD |
| Tool calls | TBD | TBD |
| Wall-clock time | TBD | TBD |
| Tests pass | TBD | TBD |
| Files modified | TBD | TBD |
| Acceptance criteria | TBD / N | TBD / N |
| Commits | TBD | TBD |
| Notes | | |

### SLICE-72-10: Tests, deploy & verification

| Metric | Control (raw) | Harness (token reduction) |
|---|---|---|
| Tokens (estimated) | TBD | TBD |
| Tool calls | TBD | TBD |
| Wall-clock time | TBD | TBD |
| Tests pass | TBD | TBD |
| Files modified | TBD | TBD |
| Acceptance criteria | TBD / N | TBD / N |
| Commits | TBD | TBD |
| Notes | | |

## Cumulative summary

| Metric | Control | Harness | Delta |
|---|---|---|---|
| Total tokens | TBD | TBD | TBD |
| Total tool calls | TBD | TBD | TBD |
| Total wall-clock | TBD | TBD | TBD |
| Total commits | TBD | TBD | TBD |
| Total errors | TBD | TBD | TBD |
| All tests pass | TBD | TBD | TBD |
| Token reduction % | 0% | TBD | TBD |

## Final analysis

TBD — заполнить после завершения всех слайсов.

## Merge decision

TBD — после сравнения результатов.

## SLICE-72-1: Detailed Notes (Control)

| Metric | Value |
|---|---|
| Tokens | ~12k (estimated) |
| Tool calls | 18 |
| Wall-clock time | ~6 min |
| Tests pass | N/A (documentation slice) |
| Files modified | 3 (namespace-mapping.md, tool-inventory.txt, current.md) |
| Acceptance criteria | 5/5 ✅ |
| Commits | 1 |
| Errors | 0 |
| RTK savings | N/A (rtk not activated per instructions) |
| Caveman active | N/A (not activated per instructions) |
| Notes | 65 tools audited from source grep across 12 files. 17 parity-tools reclassified out of audit-mcp. Source count = runtime count = 65 (no discrepancy). Commit: 24d3471. |
