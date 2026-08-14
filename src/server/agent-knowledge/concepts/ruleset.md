---
related_capabilities:
  - backend-development
  - ai-agent-architecture
---

# Open Ruleset

## What Is the Open Ruleset?

The AgentBadge scoring ruleset is open and transparent. Every rule is a binary check with clear pass/fail criteria and evidence. Anyone can read, reproduce, and verify the rules.

## Why Open Rules?

- **Trust** — You can see exactly what's being checked and why
- **Reproducibility** — Same URL + same ruleset version = same score
- **No pay-to-play** — Free tier uses the same rules as paid
- **Community** — Anyone can propose new rules or improvements

## Rule Structure

Each rule has:
- **ID** — Unique identifier (e.g., AB-001)
- **Description** — What it checks
- **Category** — Discovery, Documentation, Authentication, Machine-readability
- **Check type** — Binary (pass/fail)
- **Evidence** — HTTP response that proves the result

## Versioning

Rules are versioned. Each scan records which ruleset version was used. This ensures:
- Scores are reproducible
- Historical comparisons are valid
- Rule changes are tracked

## Related

- [Agent Readiness](/agent-guide/concepts/agent-readiness) — What the ruleset measures
- [Scoring Engine](/agent-guide/concepts/scoring) — How scores are calculated
- [CLI Tool](/agent-guide/capabilities/cli) — Run the ruleset locally
