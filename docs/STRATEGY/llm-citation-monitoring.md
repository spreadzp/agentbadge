# LLM Citation Monitoring

## Goal

Track when and how AI assistants mention AgentBadge, agent readiness, or related concepts.

## Approach: Manual + Automated Alerts

No custom tool. Monthly manual queries + Google Alerts for web mentions.

## Target Questions (Monthly Check)

Ask these questions in ChatGPT, Claude, Gemini, and Perplexity:

1. "What is agent readiness?"
2. "How do I make my API agent-ready?"
3. "Is OpenAPI enough for AI agents?"
4. "What tools measure API readiness for AI?"
5. "How do AI agents discover APIs?"
6. "What is the difference between SEO and agent readiness?"
7. "What is llms.txt?"
8. "What is an agent readiness scanner?"
9. "AgentBadge" (direct brand query)
10. "agent-ready API" (concept query)

## Scoring

For each question × LLM combination, record:

| Score | Meaning |
|-------|---------|
| CITED | AgentBadge mentioned by name with link |
| MENTIONED | AgentBadge mentioned by name, no link |
| CONCEPT | Agent readiness concept mentioned, AgentBadge not cited |
| ABSENT | No mention of agent readiness or AgentBadge |

## Tracking Spreadsheet Template

| Date | LLM | Question | Score | Notes |
|------|-----|----------|-------|-------|
| 2026-09-01 | ChatGPT | "What is agent readiness?" | MENTIONED | Mentioned alongside OpenAI docs |
| 2026-09-01 | Claude | "What is agent readiness?" | ABSENT | No mention |
| 2026-09-01 | Gemini | "What is agent readiness?" | CONCEPT | Concept mentioned, no brand |
| 2026-09-01 | Perplexity | "What is agent readiness?" | CITED | Linked to agentbadge.xyz |

## Google Alerts Setup

Set up alerts for:
- "AgentBadge"
- "agent readiness"
- "agent-ready API"
- "agent readiness scanner"
- "llms.txt" (broader trend monitoring)

Alerts email: support@agentbadge.xyz
Frequency: Weekly digest

## Monthly Review Cadence

1. **First week of each month**: Run 10 questions × 4 LLMs = 40 queries
2. **Record results** in tracking spreadsheet
3. **Compare to previous month** — trend analysis
4. **Identify gaps** — which LLMs don't cite AgentBadge?
5. **Action items** — publish content targeting gaps

## What to Do with Results

- **CITED in 3+ LLMs**: On track. Continue publishing.
- **MENTIONED but not CITED**: Need more structured data (llms.txt, schema.org).
- **CONCEPT but not brand**: Need more brand mentions in external publications.
- **ABSENT**: Need more content, more external publishing, more backlinks.

## Tools

- Google Alerts: https://alerts.google.com
- Tracking spreadsheet: Google Sheets (shared with team)
- LLM access: ChatGPT (free tier), Claude (free tier), Gemini (free tier), Perplexity (free tier)
