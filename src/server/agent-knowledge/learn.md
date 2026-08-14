# Learning Path — How to Make Your API Agent Ready

This guide walks you through the process of making your API agent-ready, step by step.

## Step 1: Understand What Agent Readiness Is

Read the [Context guide](/agent-guide/context) to understand:

- What Agent Readiness means
- Why it matters for your API
- How AgentBadge scores your API

## Step 2: Check Your API

Run a scan to see your current Agent Readiness score:

- **Web UI** — Go to the AgentBadge dashboard and enter your API URL
- **CLI** — Use the `agentbadge scan` command (install via npm/npx)
- **GitHub Action** — Add the AgentBadge Action to your CI/CD pipeline

The scanner is passive — it sends HTTP requests to your public endpoints, just like an AI agent would. No code changes required.

## Step 3: Read Your Report

After the scan completes, you'll get a detailed report with:

- **Overall score** — 0-100 across all dimensions
- **Dimension scores** — Discovery, Documentation, Authentication, Machine-readability
- **Findings** — Each finding has evidence (HTTP response, header, body)
- **Recommendations** — What to fix and how

Read the [Scoring concept](/agent-guide/concepts/agent-readiness) to understand how scores are calculated.

## Step 4: Fix Issues

Follow the recommendations in your report. Common fixes include:

- Add `llms.txt` to your API root
- Publish an OpenAPI spec
- Add structured error responses (JSON with error codes)
- Document your authentication flow
- Add `/.well-known/agent-card.json`

Each fix will improve your score in the corresponding dimension.

## Step 5: Display Your Badge

Once you're satisfied with your score, display the AgentBadge trust badge:

- Add the badge to your README, website, or API docs
- The badge links to your full report with evidence
- The badge is dynamic — it updates when you re-scan

## Step 6: Keep Improving

Agent Readiness is not a one-time check. As your API evolves:

1. **Re-scan** after major changes (new endpoints, new auth, new docs)
2. **Track progress** — compare scores over time
3. **Watch for regressions** — new endpoints might not be agent-ready
4. **Follow best practices** — new rules may be added to the ruleset

## Need Help?

If you want expert help making your API agent-ready, AgentBadge offers:

- [Engineering Services](/agent-guide/team/services) — Full-service implementation
- [Capabilities](/agent-guide/team/capabilities) — What we can do
- [Contact](/agent-guide/team/contact) — Start a conversation

Or submit a structured [Work Request](/api/work-requests) directly.

## Continuous Improvement

Set up automated scanning in your CI/CD pipeline:

```yaml
# GitHub Action example
- uses: agentbadge/scan-action@v1
  with:
    api-url: https://api.example.com
```

This ensures every deployment is checked for Agent Readiness.
