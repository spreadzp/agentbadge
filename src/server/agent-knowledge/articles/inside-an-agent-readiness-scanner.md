---
related_capabilities:
  - scanner
  - ai-agent-architecture
  - cli
related_services:
  - ai-agent-consulting
---
# Inside an Agent Readiness Scanner: Rules, Evidence and Reproducibility

## Summary

How does an agent readiness scanner actually work? This article goes inside the measurement engine: rules, evidence collection, assertion states, scoring with category floors, and reproducibility. The central principle is deterministic before intelligent — HTTP checks first, AI copilot optional. The result is not an opinion but a reproducible measurement: same target + same measurement state + same ruleset version = same result.

## The Measurement Pipeline

```
Rules → Evidence → Assertions → Score → Report
```

Each stage is a distinct step in the pipeline:

1. **Rules** — explicit, versioned measurement definitions
2. **Evidence** — what was found, where it came from, why a rule passed or failed
3. **Assertions** — concrete questions with answers and evidence
4. **Score** — category scores + total, with category floor enforcement
5. **Report** — reproducible artifact with target, ruleset version, timestamp, and hash

## What Is a Rule?

A rule is an explicit, versioned measurement definition. Simplified example:

```text
AB-001
Name: OpenAPI discoverability

Given:
  target = https://example.com

Check:
  GET /.well-known/openapi.json

Pass when:
  HTTP status = 200
  AND response is valid OpenAPI

Evidence:
  URL
  HTTP status
  content type
  content hash

Severity:
  medium
```

A rule is not "The API looks well documented" — it is "This specific machine-readable artifact was found and passed these specific checks."

## Evidence

Evidence is what was found, where it came from, and why the rule passed or failed:

```text
AB-007  OpenAPI discoverability

STATUS: VERIFIED

Evidence:
GET https://api.example.com/openapi.json
HTTP 200
Content-Type: application/json

OpenAPI version:
3.1.0

Confidence:
1.00
```

The chain:

```
HTTP response → Evidence → Assertion → Rule result → Category score → Overall score
```

Evidence is part of the measurement itself, not an optional explanation.

## Assertions

An assertion is a concrete question + answer + evidence:

```json
{
  "rule_id": "AB-007",
  "status": "VERIFIED",
  "target": "https://api.example.com/openapi.json",
  "evidence": {
    "http_status": 200,
    "content_type": "application/json"
  },
  "confidence": 1.0
}
```

The result is not a magic score — it is a set of assertions, each with a status and evidence.

## Status Model

| Status | Meaning |
|--------|---------|
| VERIFIED | Direct proof exists |
| MISSING | Not found |
| INFERRED | Reasonable grounds, but insufficient proof |
| CONFLICT | Two sources contradict each other |

Example CONFLICT: OpenAPI says `POST /refund`, but the Agent Guide says `POST /refund-request`.

"Confidence is not the same thing as verification."

## Deterministic Before Intelligent

| Question | Preferred method |
|----------|-----------------|
| Does `robots.txt` exist? | HTTP request |
| Does sitemap exist? | HTTP request + parser |
| Does OpenAPI exist? | HTTP request + schema validation |
| Is JSON valid? | JSON parser |
| Does declared endpoint exist in another document? | Exact matching |
| What does an undocumented endpoint mean? | AI-assisted inference |
| What does an API capability actually mean? | Human confirmation / assisted review |

AI is a copilot, not a judge. An LLM may interpret ambiguous documentation, but it should not silently decide that an API supports refunds just because the word "refund" appears in the text.

## Scoring with Category Floor

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

Score should explain itself:

```
+8  OpenAPI documentation detected
-12  New authentication issue detected
+0   Discovery unchanged

Result:
76 → 72
```

## Reproducibility

```
Same target + same measurement state + same ruleset version = reproducible result
```

Example report:

```json
{
  "target": "https://api.example.com",
  "ruleset": "agent-readiness-v1.0",
  "scanner_version": "0.1.0",
  "timestamp": "...",
  "assertions": [...],
  "score": {
    "total": 76,
    "categories": {
      "discovery": 18,
      "documentation": 20,
      "authentication": 17,
      "machine_readability": 21
    }
  }
}
```

The score is the output of a defined measurement process, not a mysterious number.

## What AgentBadge Does Not Claim

AgentBadge measures Agent Readiness. It does **not** certify:

- API security
- Business correctness
- Service reliability
- Legal compliance
- Quality of API's business logic
- Whether an agent should trust the company

A high score means "This API satisfied these measurable Agent Readiness criteria" — not "This API is safe."

**Philosophy:** Don't certify. Measure.

## Machine-Readable Fields

| Field | Value |
|-------|-------|
| measurement_pipeline | Rules → Evidence → Assertions → Score → Report |
| rule_structure | rule_id, check type, target, evidence, fix hint, severity |
| evidence_model | What was found, where it came from, why rule passed/failed |
| deterministic_approach | HTTP checks first, AI copilot optional |
| scoring_model | Category scores + total, category floor concept |
| reproducibility_formula | Same target + same measurement state + same ruleset version = same result |
| agentbadge_capabilities | CLI, CI, README badge, marketplace, continuous monitoring |
| what_agentbadge_does_not_claim | Not security, not business correctness, not legal compliance |
| recommended_next_actions | Run scan, open findings, ask 5 questions, check ruleset version |
| related_articles | what-is-agent-readiness, why-ai-agents-fail-apis, what-ai-agent-needs-to-understand-api, why-openapi-isnt-enough, how-do-you-measure-agent-readiness |

## Try It Yourself

Take an API you control. Run a scan. Don't just look at the number. Open the findings. Ask:

1. What rule produced this result?
2. What evidence supports it?
3. Is the assertion VERIFIED, INFERRED, CONFLICT, or MISSING?
4. Which ruleset version was used?
5. Can another implementation reproduce the result?

```bash
npx @agentbadge/cli scan https://api.example.com
```

## API Endpoints

- `GET /agent-guide/` — Agent Knowledge Layer index
- `GET /agent-guide/knowledge-map.json` — Structured graph of concepts and capabilities
- `GET /agent-guide/concepts/agent-readiness` — Agent Readiness concept
- `GET /agent-guide/concepts/scoring` — Scoring engine concept
- `GET /agent-guide/capabilities/scanner` — Passive scanner capability
- `GET /agent-guide/articles/what-is-agent-readiness` — Article 1: foundation
- `GET /agent-guide/articles/how-do-you-measure-agent-readiness` — Article 8: measurement framework
- `GET /agent-guide/articles/why-openapi-isnt-enough` — Article 7: structural gap
- `GET /agent-guide/articles/what-ai-agent-needs-to-understand-api` — Article 6: 8 context layers
- `GET /agent-guide/articles/why-ai-agents-fail-apis` — Article 5: failure modes
- `GET /llms.txt` — LLM entry point
- `GET /ai-sitemap.xml` — Machine-readable resource map

## Knowledge Map

- **Nodes**: `agent-readiness` (concept), `scanner` (capability), `scoring` (concept), `evidence` (concept), `reproducibility` (concept), `ruleset` (concept), `cli` (capability), `inside-agent-readiness-scanner` (article)
- **Edges**:
  - `inside-agent-readiness-scanner` → describes → `scanner`
  - `inside-agent-readiness-scanner` → details → `evidence`
  - `inside-agent-readiness-scanner` → details → `reproducibility`
  - `inside-agent-readiness-scanner` → explains → `scoring`
  - `inside-agent-readiness-scanner` → builds on → `how-do-you-measure-agent-readiness` (Article 8)
  - `scanner` → collects → `evidence`
  - `scanner` → ensures → `reproducibility`
  - `evidence` → enables → `reproducibility`

---

*This article is part of the AgentBadge Content Marketing Wave 2, Block C — Measurement. For AI agents, the [Agent Knowledge Layer](/agent-guide/) provides machine-readable access to all concepts, capabilities, and articles.*
