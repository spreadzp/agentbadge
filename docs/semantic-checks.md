# Semantic Checks — Agent Readiness Layer

> **Spec:** [AGENT-READINESS-SPEC-v0.4.md](../docs/EPICS/32-agent-readiness-spec/spec/AGENT-READINESS-SPEC-v0.4.md), Appendix A
> **Rules:** AB-146 through AB-160 (15 rules, registered in ruleset v1.4.0)
> **Proof artifact:** `tests/unit/rules/semantic-golden-scan.test.ts` + `tests/unit/rules/semantic-layer-value.test.ts`

## What the semantic layer does

The semantic layer answers **questions agents ask but can't find answers to** in structured sources. Before v0.4, AgentBadge could verify *whether a file exists* (e.g. `openapi.json` is present) but not *whether the file is useful* (e.g. does every operation have a description? are error responses documented?).

The semantic layer bridges that gap with **pure deterministic functions** — no LLM, no heuristic guessing. Each checker parses structured sources (OpenAPI JSON, agent-guide JSON, llms.txt, agents.txt) and evaluates a specific criterion.

## The agent question each check answers

| Rule | Category | Question | What it checks |
|------|----------|----------|----------------|
| AB-146 | actionability | "What does each API operation do?" | Every OpenAPI operation has a description or summary |
| AB-147 | documentation | "What parameters does each operation accept?" | Parameters have descriptions with constraints |
| AB-148 | documentation | "What does a valid request and response look like?" | Examples present in OpenAPI operations |
| AB-149 | error_semantics | "What errors can occur and what do they mean?" | 4xx/5xx response schemas declared |
| AB-150 | pricing | "What does a call cost?" | Pricing info discoverable in guide or llms.txt |
| AB-151 | rate_limits | "How many calls can I make per minute?" | Rate limits in machine-readable form |
| AB-152 | verification | "Are pricing and rate limits consistent across all sources?" | No conflicting pricing/limits across sources |
| AB-153 | bot_auth | "How do I authenticate to use this API?" | Security schemes declared in OpenAPI |
| AB-154 | retry_semantics | "Can I safely retry a failed request?" | Idempotency-Key or Retry-After documented |
| AB-155 | versioning | "What version of the API am I using and is it stable?" | API version + deprecation policy present |
| AB-156 | sandbox | "Is there a sandbox where I can test calls safely?" | Sandbox/test environment documented in guide |
| AB-157 | agent_policy | "Am I allowed to use this API as an AI agent?" | Machine-readable agent policy (agents.txt) |
| AB-158 | discovery | "What can this API do and which endpoints should I use?" | Capabilities list in agent-guide |
| AB-159 | actionability | "What business rules constrain each action?" | Business constraints documented (refund windows, cancellation rules) |
| AB-160 | documentation | "Where do I get help if something goes wrong?" | Support path declared in guide |

## Three-valued semantics

Each check produces one of three outcomes:

- **VERIFIED** — The criterion is fully met. The agent can proceed with confidence.
- **INFERRED** — The criterion is partially met. Some evidence exists but is incomplete (e.g. some operations have descriptions, others don't). Rendered with a "partial" chip in the UI.
- **GAP** — The criterion is not met. The agent cannot answer the question from available sources.

A fourth outcome, **no_source**, occurs when the primary source itself is missing (e.g. no OpenAPI spec at all).

## Critical severity and the floor

AB-153 (authentication clarity) is the only rule with `severity: "critical"` in v1.4.0. When an agent cannot determine how to authenticate, it **physically cannot proceed** — no other capability matters.

The critical floor enforces this: if any critical-severity rule is GAP, the total score is capped at **≤ 30** regardless of how well other categories score. This is configurable via `criticalFloorCap` in the ruleset config.

## The "deterministic only — no LLM" boundary

All 15 semantic checkers are **pure functions** that parse structured sources:

1. **OpenAPI JSON** → parsed for operation descriptions, parameter schemas, examples, error responses, security schemes
2. **agent-guide JSON** → parsed for capabilities, pricing, sandbox, support, constraints
3. **llms.txt** → parsed for prose pricing/support mentions
4. **agents.txt** → parsed for machine-readable agent policy

No external API calls, no LLM inference, no probabilistic reasoning. The same input always produces the same output. This is a deliberate design constraint — semantic checks must be **reproducible and auditable**.

## Rich fixture example (Stripe-lite)

The test fixture at `tests/fixtures/semantic/rich-api/source-state.ts` simulates a "Stripe-lite" API with:

- **OpenAPI** with 4 operations (some with descriptions, some without; examples on some endpoints; no error schemas; no security schemes)
- **agent-guide** with capabilities array, pricing note, sandbox URL, support email, business constraints
- **llms.txt** with prose pricing and support info
- **agents.txt** with AI-agent access rules

### Expected outcomes from the golden scan test:

| Status | Count | Rules |
|--------|-------|-------|
| VERIFIED | 5 | AB-148, AB-150, AB-156, AB-158, AB-159, AB-160 |
| INFERRED | 3 | AB-146, AB-147, AB-155 |
| GAP | 7 | AB-149, AB-151, AB-152, AB-153, AB-154, AB-157 |

The V1-vs-V2 delta test (`semantic-layer-value.test.ts`) proves that without semantic rules, none of these findings are visible — the pre-95 ruleset only checks file presence, not content quality.

## Zero-drift enforcement

The zero-drift test (`tests/unit/spec/semantic-zero-drift.test.ts`) machine-checks agreement between:

- Spec v0.4 §A.2 category enum (25 values) ↔ `categoryEnum` in `shared.schema.ts`
- Spec v0.4 §A.3 severity enum (4 values including `critical`) ↔ `severityEnum`
- Spec v0.4 §A.4 check type enum (9 values including `semantic_validation`) ↔ `checkTypeEnum`
- Every semantic rule's `check.semantic` ID exists in `SEMANTIC_CHECKERS` registry
- `DEFAULT_CATEGORY_WEIGHTS` covers all 25 categories with spec-matching values
- `CATEGORY_TO_PILLAR` maps all 25 categories (8 discovery, 5 understandability, 8 executability, 4 verifiability)
