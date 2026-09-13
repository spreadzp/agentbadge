# Runtime Agent Test — Explainer

## What It Does

The Runtime Agent Test simulates an AI agent interacting with your API to verify that what your documentation declares matches what actually happens at runtime. It runs 8 read-only task journeys against your endpoint and records every step as an `ExecutionTrace`.

## The 8 Task Journeys

| Task | Category | What It Does |
|------|----------|-------------|
| RT-01 | discover | Fetches `llms.txt`, `agents.txt`, `.well-known/ai-plugin.json` |
| RT-02 | docs | Fetches + validates OpenAPI spec and `agent-guide.json` |
| RT-03 | auth | Reads declared auth from OpenAPI, attempts to use it on a protected endpoint |
| RT-04 | construct | Reads parsed OpenAPI spec, selects a read endpoint, builds a request |
| RT-05 | call | Calls the selected endpoint, validates response against schema |
| RT-06 | handle | Sends invalid params, observes error response, compares to declared error semantics |
| RT-07 | observe | Reads rate-limit headers from a real response, compares to declared limits |
| RT-08 | version | Checks for Sunset/Deprecation headers, compares to declared versioning |

All tasks default to **read-only** mode. No POST/PUT/DELETE/PATCH requests are made.

## Trace Anatomy

Each task produces an `ExecutionTrace`:

```
{
  trace_id: "deterministic-hash",
  target: "https://api.example.com",
  task_id: "RT-03",
  started_at: "2026-01-01T00:00:00Z",
  duration_ms: 342,
  steps: [
    { seq: 1, phase: "prepare", action: "read-declared-auth-from-openapi", outcome: "ok" },
    { seq: 2, phase: "auth", action: "GET /api/v1/protected with declared auth", outcome: "stopped", notes: "auth blocked: 401 received" }
  ],
  outcome: "partial",
  stop_reason: "auth_blocked"
}
```

- **outcome**: `success` (all steps ok), `partial` (some steps ok, stopped mid-run), `failed` (unrecoverable error)
- **stop_reason**: `completed`, `auth_blocked`, `error_unrecoverable`, `budget_exhausted`, `timeout`
- **Snapshot refs only**: traces contain `request_ref`/`response_ref` pointers, never inlined response bodies

## Declared vs Observed — Worked Conflict Example

Your OpenAPI spec declares OAuth2 authentication:

```yaml
securitySchemes:
  oauth2:
    type: oauth2
    flows:
      clientCredentials:
        tokenUrl: /oauth/token
```

But at runtime, the protected endpoint returns `401` when a Bearer token is used, and only accepts `X-Api-Key` header. This is a **CONFLICT**:

```
{
  rule_id: "AB-007",
  status: "CONFLICT",
  reason: "Auth scheme mismatch: declared oauth2 but runtime observed api_key"
}
```

This conflict flows through the existing gap engine — the runtime evidence has source class `runtime` (top of the hierarchy), confidence floor 0.9.

## Agent Success Rate (ASR)

ASR = successful tasks / total tasks. It sits **beside** the static readiness score, not inside it.

- **Per-category breakdown**: each of the 8 categories has its own mini-ASR
- **Partial counts as not-successful**: a task that stopped mid-run is not "successful"
- Displayed on the web Runtime tab, CLI output, JSON report, and MCP tool response

## Safety Rails

1. **Read-only by default**: all 8 tasks use `safety.mode: read_only`. Mutating tasks require explicit opt-in (future).
2. **Budget caps**: each task has `max_requests`, `max_steps`, `timeout_ms`. Budget exhaustion → `partial` outcome.
3. **No load testing**: rate limits are observed from headers, never triggered deliberately.
4. **SSRF-safe**: all runtime calls go through SSRF validation.
5. **Credential redaction**: credentials provided via env vars only. Redacted from every artifact (traces, snapshots, reports). Denylist: `Authorization`, `Cookie`, `X-Api-Key`, `api_key` variants.

## How to Run

### CLI

```bash
# Run all 8 tasks
agentbadge runtime https://api.example.com

# Run specific tasks
agentbadge runtime https://api.example.com --tasks RT-01,RT-03

# Budget override
agentbadge runtime https://api.example.com --budget-requests 3 --timeout-ms 10000

# JSON output
agentbadge runtime https://api.example.com --json

# With static scan
agentbadge runtime https://api.example.com --with-scan

# Credentials (env var names only, never values)
agentbadge runtime https://api.example.com --creds-env API_KEY
```

### MCP

```json
{
  "tool": "run_runtime_test",
  "params": {
    "url": "https://api.example.com",
    "tasks": ["RT-01", "RT-03"],
    "budget": { "max_requests": 3 }
  }
}
```

### Web

The Runtime tab appears on the service results page when `report.runtime` is present in the scan report. If runtime was not run, an empty state card is shown.

## How It Feeds the Gap Engine

Runtime CONFLICTs and GAPs flow through the existing `StatusDeterminator` + gap engine (EPIC-96). Runtime evidence has `source_class: "runtime"` — top of the source hierarchy (EPIC-94). This means runtime findings override static-only evidence when determining rule status.

## Golden Traces

Frozen expectations are maintained in `tests/unit/runtime/golden-runtime.test.ts`. Any drift in executor, task definitions, or fixture server breaks CI immediately. Determinism is verified: two identical runs produce identical traces (modulo time fields).
