# CLI Tool

## What Is the CLI?

The AgentBadge CLI is a command-line tool that lets you scan your API for Agent Readiness locally — no account required, no data sent to our servers.

## Installation

```bash
npm install -g @agentbadge/scanner
# or
npx @agentbadge/scanner scan https://api.example.com
```

## Basic Usage

```bash
# Scan an API
agentbadge-scan scan https://api.example.com

# Scan with all output formats
agentbadge-scan scan https://api.example.com --format all

# Output JSON report
agentbadge-scan scan https://api.example.com --format json > report.json
```

## GitHub Action

You can also run scans in CI/CD:

```yaml
- name: Agent readiness scan
  run: npx @agentbadge/scanner scan https://api.example.com --format json
```

## What the CLI Does

1. Sends HTTP requests to your API (same as the web scanner)
2. Runs all ruleset checks
3. Produces a local report with evidence
4. Outputs a score and recommendations

## Why Use the CLI?

- **Free** — no account or payment required
- **Private** — scans run from your machine, results stay local
- **Reproducible** — same ruleset version = same results
- **CI/CD ready** — integrate into your deployment pipeline
- **Open source** — the ruleset is open, anyone can verify

## Related

- [Passive Scanner](/agent-guide/capabilities/scanner) — How the scan works
- [Scoring Engine](/agent-guide/concepts/scoring) — How scores are calculated
- [Trust Badge](/agent-guide/concepts/badge) — Display your score
- [Learning Path](/agent-guide/learn) — Full step-by-step guide
- [Engineering Services](/agent-guide/team/services) — We can help integrate agent-readiness into your workflow
- [Contact Us](/agent-guide/team/contact) — Start a conversation
