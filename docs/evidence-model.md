# Evidence Model — Agent Readiness Spec v0.3

> **Canonical spec**: [`AGENT-READINESS-SPEC-v0.3.md`](../EPICS/32-agent-readiness-spec/spec/AGENT-READINESS-SPEC-v0.3.md)
> **Ruleset**: `agent-readiness@2.1.0`
> **Epic**: [EPIC-94: Evidence Engine V2](../EPICS/94-evidence-engine-v2/EPIC-94-evidence-engine-v2.md)

---

## Overview

Every AgentBadge scan produces **assertions** — one per rule. Each assertion is
backed by **evidence**: concrete, machine-checkable facts (HTTP responses,
OpenAPI operations, sitemap entries, etc.) that justify the assertion's status.

This document explains the evidence model in plain language. For the normative
specification, see the canonical spec linked above.

---

## Assertion Statuses

| Status | Meaning | When emitted |
|---|---|---|
| `VERIFIED` | Direct evidence confirms the rule | HTTP 200 on target URL, valid schema, etc. |
| `INFERRED` | Indirect evidence supports the rule | OpenAPI implies endpoints exist; HTML implies content |
| `CONFLICT` | Two sources disagree | Cross-evidence comparison finds mismatch |
| `GAP` | No evidence found (or evidence doesn't confirm) | Rule target not found, no matching evidence |
| `NOT_APPLICABLE` | Rule doesn't apply to this scope | e.g. pricing rule on a free site |

> **Note**: `MISSING` is accepted as a legacy input alias but never emitted in
> V2 payloads. It normalizes to `GAP` via `statusInputSchema`.

---

## The Claim / Proof Shape

Every V2 assertion carries:

- **`claim`** — a human-readable statement of what is being checked
  (e.g. "Pricing is machine-readable and discoverable by agents")
- **`evidence`** — an array of evidence objects that prove or disprove the claim
- **`verified_at`** — ISO 8601 timestamp of when evidence was captured
- **`review_level`** — routing metadata: `"automatic"` or `"assisted"`

The assertion is the **verdict** (status + confidence); the evidence is the
**proof**. A `GAP` assertion has an empty evidence array — the claim is stated
but unproven.

---

## Evidence Variants (9-Type Discriminated Union)

| Type | Key fields | Source class |
|---|---|---|
| `http` | `url`, `status`, `headers`, `content_hash` | `runtime` (probe checks) or `website_content` |
| `openapi` | `url`, `paths`, `methods` | `machine_readable_spec` |
| `json_schema` | `url`, `schema_keys`, `valid` | `machine_readable_spec` |
| `html` | `url`, `title`, `content_hash` | `website_content` |
| `robots` | `url`, `status`, `allows_all`, `disallowed_paths` | `machine_readable_guide` |
| `sitemap` | `url`, `status`, `url_count`, `urls` | `machine_readable_guide` |
| `github` | `repo`, `path`, `content_hash`, `last_commit` | `official_docs` |
| `manual_confirmation` | `confirmed_by`, `confirmed_at`, `note` | `official_docs` |
| `cross` | `sources[]`, `match_keys`, `conflict_reason` | Inherits from strongest sub-source |

All variants share two common V2 fields:
- `captured_at` — ISO 8601 timestamp of when the evidence was fetched
- `source_class` — computed via the source hierarchy (not stored on rules)

---

## Source Hierarchy — "Deterministic Before Intelligent"

Evidence is classified into one of six ranked source classes. Higher rank =
more authoritative and deterministic.

| Rank | Source class | Evidence types | Description |
|---|---|---|---|
| 6 | `runtime` | `http` (from probe checks) | Live runtime behavior — highest authority |
| 5 | `machine_readable_spec` | `openapi`, `json_schema` | Machine-readable specifications |
| 4 | `machine_readable_guide` | `robots`, `sitemap` | Machine-readable guides |
| 3 | `official_docs` | `github`, `manual_confirmation` | Official documentation / manual verification |
| 2 | `website_content` | `http` (non-probe), `html` | Website content |
| 1 | `ai_inference` | (reserved, unused in v0.3) | AI-generated evidence (future: EPIC-95) |

**Design principle**: Deterministic evidence (runtime, specs) always outranks
intelligent evidence (AI inference). An LLM may *explain* a result, but the
*fact* of VERIFIED/GAP/CONFLICT is always produced by deterministic code.

The `strongestSource(evidence[])` helper returns the highest-ranked evidence
for UI badge display ("VERIFIED via OpenAPI spec" vs "Inferred from website
content").

---

## Freshness Model

Freshness is computed at **read/display time**, not stored at scan time. A
live scan is always fresh; staleness matters when re-serving saved reports.

**`checkFreshness(assertion, now)` → `{ age_days, stale }`**

- `age_days` = days since `verified_at`
- `stale` = `age_days > threshold[source_class]`

Default thresholds per source class:

| Source class | Threshold | Rationale |
|---|---|---|
| `runtime` | 7 days | Runtime behavior changes frequently |
| `machine_readable_spec` | 30 days | Specs change less often but should be current |
| `machine_readable_guide` | 30 days | Guides (robots, sitemap) similar to specs |
| `official_docs` | 60 days | Docs can be stale without being wrong |
| `website_content` | 14 days | Web content changes frequently |
| `ai_inference` | 1 day | AI-generated evidence is highly volatile |

---

## Review Routing

`review_level` routes assertions to the appropriate fix pipeline stage. It is
**workflow metadata, never a scoring input**.

| Condition | `review_level` | Meaning |
|---|---|---|
| `confidence >= 0.80` | `"automatic"` | Fix can be auto-generated without human review |
| `confidence < 0.80` | `"assisted"` | Fix requires human confirm/edit/reject |
| `status = NOT_APPLICABLE` | `null` | No fix needed — rule doesn't apply |

**Key invariant**: `review_level` is derived from `confidence`, which is itself
never a scoring input. Therefore `review_level` is transitively never a scoring
input. This is guarded by test.

---

## Worked Examples

### VERIFIED via spec

Rule: `AB-006` — MCP server descriptor present

1. Scanner fetches `https://example.com/.well-known/mcp.json` → HTTP 200
2. Evidence: `{ type: "http", url: "...", status: 200, captured_at: "2024-..." }`
3. Status: `VERIFIED` (direct evidence, 2xx on target)
4. Source class: `website_content` (non-probe HTTP)
5. Claim: "MCP server descriptor is accessible"
6. Confidence: 1.0 → review_level: `"automatic"`

### GAP

Rule: `AB-010` — Pricing endpoint present

1. Scanner fetches `https://example.com/pricing.json` → HTTP 404
2. Evidence: `[]` (no matching evidence — 404 doesn't confirm)
3. Status: `GAP`
4. Claim: "Pricing is machine-readable and discoverable by agents"
5. Confidence: 0.9 → review_level: `"automatic"`

### CONFLICT

Rule: `AB-007` — Cross-evidence: sitemap URLs match robots.txt disallow rules

1. Scanner fetches both `robots.txt` and `sitemap.xml`
2. Cross-evidence comparison: sitemap lists a URL that robots.txt disallows
3. Evidence: `{ type: "cross", sources: [...], conflict_reason: "sitemap lists /private but robots.txt disallows it" }`
4. Status: `CONFLICT`
5. Claim: "Sitemap and robots.txt are consistent"
6. Confidence: 0.95 → review_level: `"automatic"`

---

## Zero-Drift Guarantee

The [evidence-zero-drift test](../tests/unit/spec/evidence-zero-drift.test.ts)
machine-checks that the spec and code agree on:

1. Status enum (GAP present, MISSING absent from output)
2. Evidence variant type names (9-variant union)
3. `SOURCE_CLASS_RANK` classes and ranks
4. `DEFAULT_FRESHNESS_THRESHOLDS` values
5. `REVIEW_CONFIDENCE_THRESHOLD` (0.80)

If the spec or code changes, the test fails — preventing silent drift.
