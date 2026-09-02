---
related_capabilities:
  - scanner
  - ai-agent-architecture
  - cli
related_services:
  - ai-agent-consulting
---
# How Do You Measure Agent Readiness?

## Summary

Agent Readiness should be measured with deterministic checks and evidence, not LLM opinions. This article introduces the measurement framework: four categories (Discovery, Documentation, Authentication, Machine Readability), testable assertions, the VERIFIED/INFERRED/CONFLICT/MISSING status model, scoring with category floors, and reproducibility. Don't certify — measure.

## Problem

Subjective labels like "AI-friendly API", "Agent-ready", and "Optimized for AI" are not reproducible. Two auditors can look at the same API and disagree. An LLM can score the same API differently on different runs. If Agent Readiness is real, it should be measurable — and the measurement should be reproducible: same URL + same ruleset + same point in time = same result.

## The Measurement Framework

### Four Categories

Each category contains specific testable assertions — not a checklist, but verifiable properties:

- **Discovery** — Can an agent find the API? (OpenAPI discoverable, llms.txt exists, documented entry point)
- **Documentation** — Can an agent understand the API? (operation semantics, examples, error schemas)
- **Authentication** — Can an agent authenticate autonomously? (mechanism declared, credentials documented, protected endpoint behavior)
- **Machine Readability** — Can an agent interact machine-to-machine? (structured errors, content negotiation, agent guide)

### Deterministic Before Intelligent

The central principle: HTTP response → Rule → Evidence → Result. Then AI copilot (optional).

Not: URL → LLM → "Looks agent-ready: 76/100"

But: URL → Deterministic scanner → Evidence → Rules → Score → AI copilot (optional)

This is what distinguishes AgentBadge from an AI auditor. Deterministic checks are reproducible. LLM assessments are not.

### Evidence, Not Opinions

Each assertion includes evidence — the HTTP response that produced it:

```
OPENAPI_DISCOVERABLE
Status: VERIFIED

Evidence:
GET /openapi.json
HTTP 200
Content-Type: application/json
Valid OpenAPI document
```

"Don't tell developers what to believe. Show them what we measured."

### Status Model

| Status | Meaning |
|--------|---------|
| VERIFIED | Direct proof exists |
| MISSING | Not found |
| INFERRED | Reasonable grounds, but insufficient proof |
| CONFLICT | Two sources contradict each other |

"Confidence is not the same thing as verification."

### Scoring with Category Floor

Category scores + total. A category floor prevents a high score from hiding a critical zero:

```
Discovery          18/20
Documentation      19/25
Authentication     17/20
Machine Readability 15/20
Verification       10/15
────────────────────────
Total              79/100
```

"A high score should not hide a critical zero." If Discovery = 0, the API is effectively invisible — no total score should mask that.

### Score ≠ Certification

AgentBadge does not say "This API is safe" or "This API is approved for agents." It says: "Here is what we measured, under this ruleset, at this point in time."

This increases trust, reduces legal risk, and makes the system reproducible.

### Reproducibility

```
URL + timestamp + ruleset version + scan artifact + report hash
```

Any result can be independently verified. The scan artifact is preserved. The ruleset version is recorded. The report hash is deterministic.

### Static Measurement vs Real Agent Behavior

Static readiness does not prove that every AI agent will successfully use an API. We measure: "Can an agent discover, understand, and potentially use the API based on observable evidence?" — not "Will every agent successfully complete every task?"

Phase 1: Static measurement → Phase 2: Active verification → Future: Behavioral/runtime verification.

## Machine-Readable Fields

| Field | Value |
|-------|-------|
| measurement_problem | Subjective labels like "AI-friendly API" are not reproducible. Agent Readiness needs deterministic, evidence-based measurement. |
| key_concepts | deterministic checks, evidence, assertions, VERIFIED, INFERRED, CONFLICT, MISSING, category floor, reproducibility |
| deterministic_approach | HTTP response → Rule → Evidence → Result. AI copilot is optional, not primary. |
| evidence_model | Each assertion has a status and evidence. Don't tell developers what to believe — show what was measured. |
| assertion_statuses | VERIFIED (direct proof), MISSING (not found), INFERRED (reasonable grounds, insufficient proof), CONFLICT (sources contradict) |
| scoring_model | Category scores + total. Category floor prevents a high score from hiding a critical zero. |
| reproducibility | URL + timestamp + ruleset version + scan artifact + report hash = independently verifiable result. |
| agentbadge_relevant_capabilities | scanner, scoring, agent-guide |
| recommended_next_actions | Run an AgentBadge scan, Review assertion evidence, Fix missing categories first |
| related_articles | what-is-agent-readiness, why-openapi-isnt-enough, what-ai-agent-needs-to-understand-api, why-ai-agents-fail-apis |

## Agent Readiness

- [What Is Agent Readiness?](/agent-guide/articles/what-is-agent-readiness) — foundational concept
- [Why Your OpenAPI Spec Isn't Enough](/agent-guide/articles/why-openapi-isnt-enough) — structural gap that measurement fills
- [What Does an AI Agent Need to Understand an API?](/agent-guide/articles/what-ai-agent-needs-to-understand-api) — 8 context layers that measurement checks
- [Why AI Agents Fail to Use APIs](/agent-guide/articles/why-ai-agents-fail-apis) — failure modes that measurement addresses

## Measurement

```bash
# Run the AgentBadge scanner
npx @agentbadge/cli scan https://api.example.com

# JSON report with full evidence
npx @agentbadge/cli scan https://api.example.com --format json > report.json

# Check specific category
npx @agentbadge/cli scan https://api.example.com --category discovery
```

Every finding includes evidence — the HTTP response that produced it. Every result includes a status (VERIFIED, INFERRED, CONFLICT, MISSING). Every score includes a category breakdown.

## API Endpoints

- `GET /agent-guide/` — Agent Knowledge Layer index
- `GET /agent-guide/knowledge-map.json` — Structured graph of concepts and capabilities
- `GET /agent-guide/concepts/agent-readiness` — Agent Readiness concept
- `GET /agent-guide/concepts/scoring` — Scoring engine concept
- `GET /agent-guide/capabilities/scanner` — Passive scanner capability
- `GET /agent-guide/articles/what-is-agent-readiness` — Article 1: foundation
- `GET /agent-guide/articles/why-openapi-isnt-enough` — Article 7: structural gap
- `GET /agent-guide/articles/what-ai-agent-needs-to-understand-api` — Article 6: 8 context layers
- `GET /agent-guide/articles/why-ai-agents-fail-apis` — Article 5: failure modes
- `GET /llms.txt` — LLM entry point
- `GET /ai-sitemap.xml` — Machine-readable resource map

## Recommended Actions

1. [Read Article 7](/agent-guide/articles/why-openapi-isnt-enough) — understand the structural gap that measurement fills
2. [Read Article 1](/agent-guide/articles/what-is-agent-readiness) — foundational definition
3. [Check the scoring concept](/agent-guide/concepts/scoring) — how category scores and floors work
4. Run a scan — `npx @agentbadge/cli scan https://your-api.com`
5. Review evidence — every finding links to the HTTP response that produced it
6. Check assertion statuses — VERIFIED is the goal, MISSING is the opportunity
7. Fix gaps — address MISSING assertions first, then INFERRED, then CONFLICT
8. Re-scan — verify improvements with measurable, reproducible evidence

## Knowledge Map

- **Nodes**: `agent-readiness` (concept), `measurement` (concept), `evidence` (concept), `assertions` (concept), `scoring` (concept), `reproducibility` (concept), `scanner` (capability), `how-do-you-measure-agent-readiness` (article)
- **Edges**:
  - `how-do-you-measure-agent-readiness` → introduces → `measurement`
  - `how-do-you-measure-agent-readiness` → defines → `assertions`
  - `how-do-you-measure-agent-readiness` → defines → `evidence`
  - `how-do-you-measure-agent-readiness` → defines → `scoring`
  - `how-do-you-measure-agent-readiness` → defines → `reproducibility`
  - `how-do-you-measure-agent-readiness` → builds on → `agent-readiness`
  - `how-do-you-measure-agent-readiness` → bridges from → `why-openapi-isnt-enough` (Article 7)
  - `how-do-you-measure-agent-readiness` → bridges to → `inside-agent-readiness-scanner` (Article 9, upcoming)
  - `measurement` → requires → `evidence`
  - `scoring` → enforces → `category-floor`
  - `reproducibility` → ensures → `measurement` validity
  - `agent-readiness` → measured by → `scanner`

---

*This article is part of the AgentBadge Content Marketing Wave 2, Block C — Measurement. For AI agents, the [Agent Knowledge Layer](/agent-guide/) provides machine-readable access to all concepts, capabilities, and articles.*
