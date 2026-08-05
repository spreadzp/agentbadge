# Trust Badge

## What Is the Trust Badge?

The AgentBadge trust badge is a visual indicator that displays your API's Agent Readiness score. It signals to developers, AI agents, and integrators that your API has been measured for agent readiness.

## What the Badge Means

The badge is:

- **A trust signal**, not a certification — we don't guarantee your API works
- **Transparent** — the ruleset is open, anyone can see how scoring works
- **Evidence-based** — every finding links to the HTTP response that produced it
- **Dynamic** — re-scan after changes to update your score

## Badge vs Certification

| Badge | Certification |
|-------|--------------|
| Measures specific characteristics | Guarantees overall quality |
| Open ruleset, reproducible | Proprietary criteria |
| Anyone can verify | Requires authority |
| Score changes over time | Binary pass/fail |
| Free to obtain | Often paid |

AgentBadge measures, it does not certify. The distinction matters:

- **Measurement** = "Your API has `llms.txt`, OpenAPI spec, and structured errors"
- **Certification** = "Your API is safe, reliable, and approved"

## How to Display the Badge

1. Run a scan on your API
2. Get your score and report
3. Add the badge to your README, website, or API docs
4. The badge links to your full report with evidence

## Score Tiers

| Range | Tier | Meaning |
|-------|------|---------|
| 90-100 | Excellent | API is highly agent-ready |
| 70-89 | Good | API is mostly agent-ready, minor gaps |
| 50-69 | Fair | API has significant agent-readiness gaps |
| 0-49 | Poor | API is not agent-ready |

## Related

- [Agent Readiness](/agent-guide/concepts/agent-readiness) — What the badge measures
- [Scoring Engine](/agent-guide/concepts/scoring) — How the score is calculated
- [CLI Tool](/agent-guide/capabilities/cli) — How to get your badge
