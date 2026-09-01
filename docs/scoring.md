# Scoring System: Four-Pillar Model (v2)

> **Canonical spec:** [Spec v0.2 §A.7](../EPICS/32-agent-readiness-spec/spec/agent-readiness-spec-v0.2.md)

## Overview

AgentBadge scores sites on a **0–100 scale** using four pillars. Each pillar contains multiple categories, each category contains multiple rules, and each rule produces an assertion with one of five statuses.

## The Four Pillars

| Pillar | Weight | Question | Categories |
|--------|--------|----------|------------|
| Discovery | 20 | Can an agent find you? | discovery, machine-readable, OpenAPI, skills, agents.txt, WebMCP, content negotiation, SEO/AEO |
| Understandability | 25 | Can an agent understand you? | documentation, actionability, accessibility |
| Executability | 30 | Can an agent act on your API? | bot auth, identity, payments, bazaar |
| Verifiability | 25 | Can an agent verify what it observed? | verification, infrastructure, active probing |

## Status Contributions

Each rule assertion produces one of five statuses, each contributing to the score:

| Status | Contribution | Meaning |
|--------|-------------|---------|
| VERIFIED | 1.0 | The rule is satisfied — confirmed by evidence |
| INFERRED | 0.6 | The rule is likely satisfied — inferred from indirect evidence |
| CONFLICT | 0.0 | Evidence contradicts the rule |
| MISSING | 0.0 | No evidence found |
| NOT_APPLICABLE | — | Rule doesn't apply to this site (excluded from scoring) |

> **Note on INFERRED (0.6):** Inference gives partial credit because the signal is present but not definitively confirmed. For example, a sitemap that references an OpenAPI spec suggests the spec exists, but doesn't prove it's valid. The 0.6 weight balances optimism with caution.

## Scoring Formula

### Category Score

```
categoryScore = Σ(assertionContribution) / totalAssertionsInCategory × 100
```

Where `assertionContribution` is 1.0 (VERIFIED), 0.6 (INFERRED), or 0.0 (CONFLICT/MISSING).
NOT_APPLICABLE assertions are excluded from both numerator and denominator.

### Pillar Score

```
pillarScore = Σ(categoryScore × categoryWeight) / Σ(categoryWeight)
```

Each category within a pillar has an equal weight by default (configurable via `DEFAULT_CATEGORY_WEIGHTS`).

### Total Score

```
rawScore = Σ(pillarScore × pillarWeight) / Σ(pillarWeight)
totalScore = min(rawScore, floorCap) if floorTriggered else rawScore
```

Pillar weights: Discovery=20, Understandability=25, Executability=30, Verifiability=25 (Σ=100).

### Floor Cap

The floor cap is **40 points**. It triggers when any assertion with severity "high" in a Discovery or Understandability category has status MISSING or CONFLICT. This prevents a site from scoring well if it fails on fundamental discoverability or documentation.

When triggered: `totalScore = min(rawScore, 40)`.

## v1/v2 Configuration Switch

The scoring model is selected via the ruleset manifest's `scoring.pillars.scoringModel` field:

- **`v2-pillars`** (current): Four-pillar model described above
- **`v1-flat`** (legacy): Flat category-weighted average without pillars or floor caps

The `runScoringEngine` function checks this field and dispatches to the appropriate scoring path.

## Worked Example (from Golden Fixture)

The golden fixture (`tests/fixtures/scoring/golden-assertions.json`) contains 20 assertions across 12 categories with a mix of all statuses, including a floor-triggering case.

**Expected results** (hand-computed in `golden-pillar-score.test.ts`):

- Discovery pillar: 8 assertions, mix of VERIFIED/INFERRED/MISSING → score capped at 40 (floor triggered)
- Understandability pillar: 3 assertions, all VERIFIED → score = 100
- Executability pillar: 4 assertions, mix of VERIFIED/CONFLICT → score varies
- Verifiability pillar: 3 assertions, mix of VERIFIED/NOT_APPLICABLE → score varies
- **Total:** floor-capped at 40, grade = "F"

## Grade Mapping

| Score Range | Grade |
|-------------|-------|
| 90–100 | A |
| 80–89 | B |
| 70–79 | C |
| 60–69 | D |
| 0–59 | F |

## Zero-Drift Principle

The pillar enum is machine-checked for consistency across three surfaces:

1. **Zod schema** (`shared.schema.ts` → `pillarEnum`)
2. **Runtime constant** (`pillar-map.ts` → `PILLARS`)
3. **JSON schema** (`agentbadge-report.schema.json` → `score.pillars.items.properties.pillar.enum`)

The test `tests/unit/spec/pillar-zero-drift.test.ts` asserts all three are identical, in the same order: `discovery → understandability → executability → verifiability`.
