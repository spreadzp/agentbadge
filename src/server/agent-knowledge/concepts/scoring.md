---
related_capabilities:
  - backend-development
  - ai-agent-architecture
related_services:
  - api-development
---

# Scoring Engine

## What Is the Scoring Engine?

The AgentBadge scoring engine evaluates APIs across multiple dimensions and produces a reproducible, evidence-based score.

## How Scoring Works

Each check is a **binary rule** with a clear pass/fail result:

1. **Rule** — A specific, deterministic check (e.g., "Does `/llms.txt` exist?")
2. **Status** — Pass or fail (no subjective scoring)
3. **Evidence** — The HTTP response, header, or body that proves the result
4. **Confidence** — How certain we are (high for deterministic checks, lower for heuristic ones)

## Score Dimensions

| Dimension | What It Measures |
|-----------|-----------------|
| Discovery | Can agents find your API? (`llms.txt`, sitemap, well-known endpoints) |
| Documentation | Can agents understand your API? (OpenAPI spec, structured docs) |
| Authentication | Can agents authenticate? (clear auth flow, API keys) |
| Machine-readability | Is your API response machine-parseable? (JSON, structured errors) |

## Category Floors

Some dimensions have **category floors** — a minimum score required to pass. If your API scores below the floor in a critical dimension, the overall score is capped regardless of other dimensions.

## Reproducibility

The same URL + same ruleset version = same score. This is fundamental to trust:

- Rules are **versioned** — each scan records which ruleset version was used
- Checks are **deterministic** — no random sampling, no subjective judgment
- Evidence is **preserved** — every finding links to the HTTP response that produced it

## Open Ruleset

The scoring ruleset is open and transparent. Anyone can:

- Read the rules and understand what each check does
- Reproduce a scan locally using the CLI
- Verify that the same inputs produce the same outputs
- Propose new rules or changes to existing ones

## Related

- [Agent Readiness](/agent-guide/concepts/agent-readiness) — What the score measures
- [Trust Badge](/agent-guide/concepts/badge) — How to display your score
- [Passive Scanner](/agent-guide/capabilities/scanner) — How the scan is performed
- [Open Ruleset](/agent-guide/context#open-ruleset-principle) — Same rules for everyone
