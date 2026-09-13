# Continuous Monitoring

> **Free: find your problems. Paid: keep them fixed.**

Continuous monitoring scans your API on a schedule, detects regressions between runs, and alerts you through webhook, Discord, Telegram, or email — before your users notice.

## Pipeline

```
schedule → scan → diff → alert
```

1. **Schedule:** A tick-loop scheduler checks `next_run_at` for each enabled project. When due, it fires a run. Per-project lock prevents double-fires. Restart-safe (state persisted to disk).

2. **Scan:** `scanDomain(url)` → `formatScanReport()` → `RunSummary` extracted (score, grade, gap_summary, status_counts, ASR). Full report stored behind `report_ref`; summary is the timeline payload.

3. **Diff:** The regression engine compares the current run's summary against the previous run. Six rules detect different regression types. Noop runs (identical summaries) produce no report and no alert.

4. **Alert:** The alert engine filters findings by `min_severity`, applies dedupe + cooldown (per-key, 24h default, persisted), and delivers through configured channels. Suppressed alerts are silent.

## The 6 Regression Rules

| Rule | Trigger | Default Threshold | Severity |
|------|---------|-------------------|----------|
| `score_drop` | Score decreases between runs | ≥ 5 points | warning |
| `new_gap` | Gap appears that was never seen before (not in gap-history) | — | critical (if CRITICAL priority) / warning |
| `reopened_gap` | Gap appears that was previously resolved (in gap-history) | — | critical (if CRITICAL priority) / warning |
| `status_flip` | Rule status changes from VERIFIED → GAP | — | warning |
| `new_conflict` | Rule status changes to CONFLICT | — | info |
| `asr_drop` | Agent Service Ratio drops between runs | ≥ 0.1 (10%) | warning |

### Worked Examples

**Score drop:** Run 1 score=80, Run 2 score=72. Drop=8 ≥ 5 → warning. Finding: `{rule: "score_drop", severity: "warning", delta: {prev: 80, curr: 72, drop: 8}}`.

**New gap:** Gap `gap-003` appears in Run 2, not in Run 1, and not in project gap-history. Finding: `{rule: "new_gap", gap_id: "gap-003", severity: "warning"}`. If gap-003 has CRITICAL priority → severity=critical.

**Reopened gap:** Gap `gap-002` appears in Run 2, was in Run 1 but not in a later run, and IS in gap-history. Finding: `{rule: "reopened_gap", gap_id: "gap-002"}`. The gap-history (96-8 payoff) distinguishes "new" from "reopened".

**Status flip:** Rule `AB-001` was VERIFIED in Run 1, GAP in Run 2. Finding: `{rule: "status_flip", rule_id: "AB-001", delta: {prev: "VERIFIED", curr: "GAP"}}`.

## Channels + Webhook Signing

### Webhook (HMAC-signed)

Each project can have a `webhook_secret`. When set, alert payloads are signed with HMAC-SHA256:

```
X-AgentBadge-Signature: <HMAC-SHA256(secret, body)>
```

To verify on the receiver side:

```python
import hmac, hashlib

expected = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
if hmac.compare_digest(expected, request.headers["X-AgentBadge-Signature"]):
    # Valid
```

### Channel Types

| Type | Target Format | Status |
|------|---------------|--------|
| webhook | HTTPS URL | ✅ Implemented (HMAC, timeout, retry) |
| discord | Discord webhook URL | ✅ Implemented (same as webhook) |
| telegram | Telegram chat ID | Stub (future) |
| email | Email address | Stub (future) |

### Dedupe + Cooldown

- **Dedupe key:** `f(project_id, rule, gap_id|rule_id)` — same regression in consecutive runs is deduplicated.
- **Cooldown:** Default 24h per dedupe key. After an alert fires, the same regression won't alert again for 24h (even if detected in subsequent runs).
- **Persisted:** Cooldown state is stored in the monitoring store, surviving restarts.

## Tiers and Limits

| Feature | Free | Paid |
|---------|------|------|
| Projects | 1 | Unlimited |
| Schedules | Daily | Daily + Weekly |
| Channels | Webhook + Email | All (webhook, Discord, Telegram, email) |
| Runtime monitoring | — | Opt-in |

Free-tier limits are enforced at create/edit boundaries. API returns `402 Payment Required` with an upgrade message when limits are exceeded.

`resolvePlan()` is the hook for future Stripe wiring — currently defaults to `free`, with `MONITORING_DEFAULT_PLAN=paid` env override for testing.

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/monitoring/projects` | Create project (tier-checked) |
| `GET` | `/monitoring/projects` | List projects |
| `GET` | `/monitoring/projects/:id` | Project detail |
| `PATCH` | `/monitoring/projects/:id` | Update project (tier-checked) |
| `DELETE` | `/monitoring/projects/:id` | Remove project (runs kept) |
| `POST` | `/monitoring/projects/:id/run` | Manual trigger |
| `GET` | `/monitoring/projects/:id/runs` | Run timeline |
| `GET` | `/monitoring/projects/:id/alerts` | Alert log |
| `POST` | `/monitoring/projects/:id/test-alert` | Test alert delivery |
| `GET` | `/monitoring` | Dashboard view (HTML) |
| `GET` | `/monitoring/:id` | Project detail view (HTML) |

## Dashboard

The `/monitoring` page provides:

- **Project cards:** name, URL, current score + Δ since last run, sparkline, next run time, outcome badge
- **Add/edit form:** URL, name, schedule picker, channels, thresholds, webhook secret (write-only)
- **Project detail:** timeline chart (score over time), run table, regression diff expand (the money UI — every item shows WHY it's a regression), alerts log, Run now + Test alert buttons
- **Empty state:** "Monitoring keeps you fixed — register your first project"
- **No-JS degraded text** for crawlers

## Lifecycle Proof

The E2E lifecycle test (`tests/e2e/monitoring-lifecycle.e2e.test.ts`) proves the full arc:

1. **Register** project (daily schedule)
2. **Run** → RunRecord ok, score=80
3. **Degrade** fixture target → **Run** → score=65, regression detected (score_drop + new_gap)
4. **Alert** delivered to fixture webhook (HMAC-verified), AlertRecord persisted
5. **Cooldown** — third run (unchanged) → regression suppressed, no second webhook
6. **Restart** — recreate store → state intact, runs preserved
7. **Recovery** — restore fixture → no regression, no alert, timeline shows recovery

## How It Feeds EPIC-100 (CI Mode)

The regression engine + timeline are the foundation for PR-check semantics:
- **Score diff:** Same `detectRegressions()` function runs on PR branches
- **Fail-on critical:** `min_severity` config maps to CI exit codes
- **CLI CI-mode:** Consumes the same `RunSummary` format

## How It Feeds Phase-5 (Corpus)

Every monitored run produces a `RunRecord` with `RunSummary`. These accumulate as corpus data points:
- Score trends over time → readiness trajectories
- Gap histories → common failure patterns
- Regression frequencies → prioritization signals

The corpus (EPIC-103) starts collecting from day one of monitoring.

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `MONITORING_DATA_DIR` | `.data/monitoring` | Store root directory |
| `MONITORING_DEFAULT_PLAN` | `free` | Override plan for testing |
