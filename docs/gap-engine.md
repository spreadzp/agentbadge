# Gap Engine

The Gap Engine is the "what's missing" layer of AgentBadge. After the rule engine runs and produces assertions (VERIFIED, INFERRED, CONFLICT, GAP, NOT_APPLICABLE), the gap engine distills those assertions into a prioritized, actionable list of gaps — things an AI agent needs but your API doesn't provide.

## Why gaps?

A scan produces 30+ assertions. A user asking "what should I fix first?" needs a shorter, prioritized list. The gap engine groups assertions by what's missing for an AI agent, not by rule pass/fail.

## The 4 gap types

| Type | Meaning | Example |
|---|---|---|
| `documentation` | An artifact is absent — nothing to read | No `llms.txt`, no `agent-guide.json` |
| `semantic` | Artifact exists but doesn't answer the agent's question | OpenAPI spec has no error responses |
| `capability` | The service itself lacks what agents need | No OAuth2 bot auth, no sandbox |
| `evidence` | Sources disagree (CONFLICT) | robots.txt allows bots but server returns 403 |

### Derivation rules

The engine derives gaps from assertion statuses:

| Assertion status | Derives gap? | Gap type |
|---|---|---|
| `GAP` | Yes | `rule.gap_type` ?? `DEFAULT_GAP_TYPE_BY_CATEGORY[category]` |
| `CONFLICT` | Yes | `evidence` (always — sources disagree) |
| `VERIFIED` | No | — |
| `INFERRED` | No | Partial evidence exists; flagging would be noise |
| `NOT_APPLICABLE` | No | Rule doesn't apply to this scope |

### Grouping

One gap per `(type, category)`. When multiple rules in the same category produce GAP assertions, they merge into a single gap with `frequency` = count of contributing rules and `related_rules` listing all rule IDs.

### gap_id format

```
gap:{type}:{category}
```

Examples: `gap:documentation:discovery`, `gap:semantic:pricing`, `gap:capability:bot_auth`

**Stability guarantee:** The same `(type, category)` pair always produces the same `gap_id`, regardless of which specific rules contribute. This enables:
- **Rescan diff** (EPIC-97): compare gap lists between scans by `gap_id`
- **Continuous monitoring** (EPIC-99): track gap appearance/disappearance over time
- **Fix pipeline** (EPIC-97): deterministic gap identity for fix targeting

Regex: `^gap:(documentation|semantic|capability|evidence):[a-z_]+$`

## Priority function

Priority is derived from three inputs — **severity**, **impact**, and **frequency** — with a critical floor and clamp.

```
base      = map(max contributing severity):
             critical -> CRITICAL
             high     -> HIGH
             medium   -> MEDIUM
             low      -> LOW

impact    = category weight share within its pillar
             top quartile within pillar    -> +1 level
             bottom quartile within pillar -> -1 level

frequency = count of distinct contributing rules
             >= 3 -> +1 level

floor     = any contributing rule severity = critical -> CRITICAL (never lowered)
result    = clamp(base +/- adjustments, LOW..CRITICAL)
```

Every input is recorded in `priority_reason` for explainability.

### Worked example

```
Gap: gap:semantic:documentation
Contributing rules: AB-146 (high), AB-147 (medium), AB-148 (medium)

Max severity -> base = HIGH
Category weight: documentation=5, pillar total=25 -> share=0.20
  0.20 <= 0.25 -> bottom quartile -> -1 level -> MEDIUM
Frequency = 3 -> +1 level -> HIGH
Floor: no critical -> not applied
Clamp: HIGH (within LOW..CRITICAL)

priority = HIGH
priority_reason = "severity=high; impact 0.20 bottom-quartile (-1); frequency 3 (+1); floor=not applied; clamp=HIGH"
```

## Fix hints

Fix hints label the expected fix approach. They are **labels only** — execution is EPIC-97's responsibility.

| Gap type | Default fix hint | Rationale |
|---|---|---|
| `documentation` | `deterministic` | Artifact generators exist (llms.txt, agent-guide template) — auto-generate |
| `semantic` | `assisted` | LLM can draft improved descriptions, human review needed |
| `capability` | `manual` | Service change required (add sandbox, implement OAuth2) |
| `evidence` | `manual` | Source reconciliation required — human investigation |

**Rule-level override:** A rule may declare `fix_hint` in its definition, overriding the type-based default. This allows, e.g., a `documentation` gap that requires `manual` fix.

**`fix_artifacts`** lists candidate targets for the fix — e.g. `["agent-guide.json", "llms.txt"]` for a documentation gap. These are hints for EPIC-97's fix pipeline.

## EPIC-97 handoff

The gap engine produces the data; EPIC-97 consumes it:

1. **Rescan diff:** Compare gap lists by `gap_id` between scans. Gaps that disappear = fixed. New gaps = regression.
2. **Fix pipeline:** Use `fix_hint` to route to the right fixer:
   - `deterministic` → auto-generate artifact (e.g., llms.txt from OpenAPI)
   - `assisted` → LLM drafts improved content, human reviews
   - `manual` → create issue ticket with `fix_artifacts` as targets
3. **Monitoring:** Track gap counts over time, alert on new CRITICAL gaps.

The rescan-stability proof test is in `tests/e2e/gap-id-stability.e2e.test.ts` — it verifies gap IDs are stable across rescans and that only the relevant gap disappears when a fixture is mutated.

## Pipeline overview

```
RuleEngine.run(sourceState)
  → assertions[]
  → deriveGaps(assertions, rules)        // GAP/CONFLICT → gap candidates
  → prioritizeGaps(gaps, weights, severities)  // severity + impact + frequency
  → annotateFixReadiness(gaps, rules)    // fix_hint + fix_artifacts
  → summarizeGaps(gaps)                  // counts by priority, type
```

All functions are pure — no I/O, no LLM. The entire pipeline is deterministic and explainable.

## Code locations

- `src/agent-readiness/gap-engine/gap-engine.ts` — `deriveGaps()`, `summarizeGaps()`
- `src/agent-readiness/gap-engine/gap-priority.ts` — `prioritizeGaps()`
- `src/agent-readiness/gap-engine/gap-fix-hints.ts` — `annotateFixReadiness()`
- `src/agent-readiness/gap-engine/gap-types.ts` — `Gap` interface, `DEFAULT_GAP_TYPE_BY_CATEGORY`, `FIX_HINT_BY_GAP_TYPE`
- `src/agent-readiness/shared.schema.ts` — `gapTypeEnum`, `gapPriorityEnum`, `fixHintEnum`
