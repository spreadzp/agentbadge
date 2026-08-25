# Scanner Usage

The AgentBadge scanner evaluates websites for agent-readiness compliance.

## CLI Commands

### Basic Scan

```bash
bun run cli -- scan https://example.com
```

### Full Options

```bash
bun run cli -- scan https://example.com \
  --format json \
  --output report.json \
  --threshold 80 \
  --category discovery \
  --fix-hints
```

### Flags

| Flag | Description |
| --- | --- |
| `--format` | Output format: `text` (default), `json`, `compact` |
| `--output` | Write report to file |
| `--threshold` | Minimum score to pass (exit code 1 if below) |
| `--category` | Scan only specific category |
| `--fix-hints` | Include fix suggestions in output |
| `--watch` | Re-scan on file changes (development mode) |
| `--report-url` | Generate a web report link |

## API Usage

```bash
curl "https://agentbadge.xyz/api/scan?url=https://example.com"
```

Returns a JSON report with score, categories, and individual check results.

## MCP Tool

The scanner is also available as an MCP tool:

```json
{
  "tool": "check_compliance",
  "params": { "url": "https://example.com" }
}
```
