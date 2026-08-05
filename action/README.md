# AgentBadge GitHub Action

Scan any URL for AI agent readiness and produce a signed report with score, category breakdown, and CI summary.

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `target` | Target URL to scan (e.g. `https://example.com`) | Yes | — |
| `min-score` | Minimum score threshold (0-100). Exit code 2 if below. | No | `0` |
| `ruleset` | Ruleset to use (format: `name@version`) | No | `agent-readiness@1.2.0` |
| `report-dir` | Directory to store the report file | No | `.agentbadge` |

## Outputs

| Output | Description |
|--------|-------------|
| `score` | Overall agent readiness score (0-100) |
| `report-path` | Path to the generated report JSON file |
| `delta` | Score delta from previous scan (if available) |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Scan completed, score meets threshold |
| `1` | Error during scan execution |
| `2` | Score below minimum threshold |

## Usage Examples

### 1. Basic Scan

```yaml
name: AgentBadge Scan
on:
  push:
    branches: [main]
  schedule:
    - cron: "0 6 * * 1"  # Weekly Monday 6 AM

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: agentbadge/agentbadge-action@v1
        with:
          target: https://your-api.com
```

### 2. With Min-Score Threshold

Fail the workflow if the score drops below 70:

```yaml
name: AgentBadge Quality Gate
on:
  pull_request:
    branches: [main]

jobs:
  quality-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run scan with threshold
        id: scan
        uses: agentbadge/agentbadge-action@v1
        with:
          target: https://your-api.com
          min-score: 70
      - name: Check score
        if: steps.scan.outputs.score < 70
        run: |
          echo "Score ${{ steps.scan.outputs.score }} is below threshold"
          exit 1
```

### 3. Custom Ruleset + Delta Outputs

Track score changes across runs with delta output and custom ruleset:

```yaml
name: AgentBadge Delta Tracking
on:
  schedule:
    - cron: "0 6 * * *"  # Daily 6 AM

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run scan
        id: scan
        uses: agentbadge/agentbadge-action@v1
        with:
          target: https://your-api.com
          ruleset: agent-readiness@1.3.0
          report-dir: .agentbadge
      - name: Report delta
        run: |
          echo "Score: ${{ steps.scan.outputs.score }}/100"
          echo "Delta: ${{ steps.scan.outputs.delta }}"
          echo "Report: ${{ steps.scan.outputs.report-path }}"
      - name: Download previous report
        if: always()
        uses: actions/download-artifact@v4
        with:
          name: agentbadge-report
          path: .agentbadge/previous
```

## Troubleshooting

### Scan fails with exit code 1

- Check that the `target` URL is accessible from GitHub Actions runners
- Verify the URL is not behind a firewall or VPN
- Check the workflow logs for the error message

### Score below threshold (exit code 2)

- Review the CI summary in the job log for category breakdown
- Download the `agentbadge-report` artifact for the full report
- Fix the issues identified in the report and re-run the scan

### Bun not found

The action automatically sets up Bun. If you encounter issues:
- Ensure you're using `ubuntu-latest` or `ubuntu-22.04` runner
- Check that `oven-sh/setup-bun@v2` is not blocked by your organization policy

### jq not available

The entrypoint script falls back to `bun -e` for JSON parsing if `jq` is not installed. Both methods are supported.
