# Agent Readiness Specification v0.3 (Ruleset 2.1.0)

> **Spec version**: `0.3.0`
> **Ruleset reference**: `agent-readiness@2.1.0`
> **Status**: ACTIVE
> **Supersedes**: `AGENT-READINESS-SPEC-v0.2.md` (Ruleset 1.3.0, LOCKED — preserved for history)
> **Epic**: [EPIC-94: Evidence Engine V2](../94-evidence-engine-v2/EPIC-94-evidence-engine-v2.md)

---

## v0.2 → v0.3 Changelog

| Change | Section | Details |
|---|---|---|
| `MISSING` → `GAP` rename | §4 | `GAP` is canonical V2 status; `MISSING` accepted as legacy input alias (never emitted in new payloads) |
| §12 rewritten — drift killed | §12 | Assertion table now matches ACTUAL code fields (`timestamp`, `source_url`, `reason`, `name`, `fix`) plus V2 additions (`claim`, `verified_at`, `review_level`, `age_days`, `stale`) |
| §12.1 rewritten — evidence union | §12.1 | Evidence object is now the 9-variant discriminated union (http, openapi, json_schema, html, robots, sitemap, github, manual_confirmation, cross) with per-variant fields, PLUS new common fields `captured_at` and `source_class` |
| Source hierarchy | §12.3 (new) | 6-class ranking: runtime (6) > machine_readable_spec (5) > machine_readable_guide (4) > official_docs (3) > website_content (2) > ai_inference (1) |
| Freshness model | §12.4 (new) | `age_days`/`stale` computed at read/display time; per-class default thresholds (runtime 7d, spec 30d, guide 30d, docs 60d, website 14d, inference 1d); manifest override |
| Review routing | §12.5 (new) | `confidence >= 0.80 → automatic`, else `assisted`; `null` for NOT_APPLICABLE; workflow-routing only, never scoring |
| §6.1 boundary extended | §6.1 | Confidence AND its derivatives (`review_level`, `stale`) never touch the score |

---

This document explains **why** the schemas are shaped the way they are.
The schemas define format; this document defines meaning.

Governs: `agentbadge-report.schema.json`, `agentbadge-rule.schema.json`,
`MVP-RULES.md`, and the behavior of the reference `agentbadge` CLI.

---

## 1. Terminology

- **Rule** — a single named check (e.g. `AB-001 robots.txt present`),
  identified by a stable `rule_id`, versioned independently (§3).
- **Assertion** — the result of running one rule against one scanned
  scope at one point in time. A report is a set of assertions.
- **Evidence** — the concrete, machine-checkable fact(s) that justify an
  assertion's status (an HTTP response, a matched OpenAPI operation, a
  byte range in a fetched file). Evidence is never a natural-language
  claim on its own — see §4.
- **Confidence** — a 0.0–1.0 value expressing how certain the rule's
  check logic is about an INFERRED assertion. Confidence is metadata for
  humans and UI, not a scoring input (§6).
- **Claim** — a human-readable statement of what is being checked (V2).
  Derived from rule metadata initially; per-rule semantic claims arrive
  with EPIC-95.
- **Pillar** — a high-level scoring dimension that aggregates one or more
  categories. Four pillars: Discovery, Understandability, Executability,
  Verifiability (§6.6, §A.7).
- **Source class** — a ranking of evidence provenance (V2, §12.3):
  `runtime` > `machine_readable_spec` > `machine_readable_guide` >
  `official_docs` > `website_content` > `ai_inference`.
- **Review level** — routing metadata for the fix pipeline (V2, §12.5):
  `automatic` (confidence ≥ 0.80) or `assisted` (< 0.80); `null` for
  NOT_APPLICABLE. Never a scoring input.
- **Ruleset** — a versioned, named collection of rules plus the category
  weights, pillar weights, and floors used to compute a score from their
  assertions.
- **Scope** — the URL/domain a report describes. One report always
  describes exactly one scope.
- **Report** — the full signed artifact: metadata + assertions + score +
  integrity block, per `agentbadge-report.schema.json`.

---

## 2. Design principle: deterministic before intelligent

Every rule's `check` must be one of: HTTP fetch + parse, schema
validation, exact string/structural match, or cross-evidence comparison
between two already-fetched documents. Nothing in v0.1 relies on an LLM
to **decide** a status. An LLM may be used downstream to explain a
result in plain language or to draft a suggested fix value — but the
fact of GAP/VERIFIED/CONFLICT is always produced by deterministic
code, not a model's judgment call.

The source hierarchy (§12.3) enforces this principle: higher-ranked
deterministic sources (runtime, machine-readable specs) take precedence
over lower-ranked sources (website content, AI inference) in display
ordering and conflict presentation.

---

## 3. Versioning model

Three independent version numbers exist. Do not conflate them.

| Field | Means | Bumped when |
|---|---|---|
| `report.schema_version` | Shape of the report JSON itself (fields, types) | Only on a breaking structural change to the report format |
| `ruleset.version` | The named, semver-versioned bundle of rules + weights (e.g. `agent-readiness@2.1.0`) | Any time a rule is added, removed, or its weight/severity changes |
| `rule.version` | A single rule's own check logic | Any time that rule's check implementation changes |

**Rule version semver meaning:**

- **MAJOR** (e.g. `1.0.0 → 2.0.0`): check logic changes in a way that
  changes what evidence or status it can produce, or its score impact
  changes. A report scored under rule v1 is **not** directly comparable
  to one scored under rule v2 for that rule — the diff view must flag
  this rather than showing a misleading delta.
- **MINOR** (`1.0.0 → 1.1.0`): bug fix that makes the check more
  reliable but does not change its semantic meaning; backward-compatible.
- **PATCH** (`1.0.0 → 1.0.1`): documentation/description text only, no
  logic change.

A report always records the exact `ruleset.version` and, per assertion,
the `rule.version` used, so any consumer can determine whether two
reports are safely comparable.

---

## 4. Assertion status — five states, not two

| Status | Meaning |
|---|---|
| `VERIFIED` | The check ran and found positive, directly-observed evidence (e.g. HTTP 200 + valid schema). Highest score contribution. |
| `INFERRED` | The check found indirect evidence and derived a likely value (e.g. guessing a capability name from an OpenAPI `operationId`). Always carries a `confidence` value and is UI-flagged for human review. |
| `CONFLICT` | Two or more evidence sources disagree about the same subject. See §5 for the exact algorithm — this is never triggered by a single source alone. |
| `GAP` | The check ran, found no evidence, and applicability was not explicitly ruled out. **Canonical V2 name.** `MISSING` is accepted as a legacy input alias when parsing old reports (normalizes to `GAP`); new payloads only ever emit `GAP`. |
| `NOT_APPLICABLE` | The rule's `applicability` predicate explicitly determined this rule does not apply to this scope (e.g. a pricing rule on an API with no billing). |

**Default rule:** if a rule does not define an `applicability` predicate,
the default is that it always applies — an unmet check is `GAP`,
never silently `NOT_APPLICABLE`. `NOT_APPLICABLE` must be an explicit,
positive determination, never an absence of evidence.

**Legacy compatibility:** Old saved reports containing `MISSING` status
values are accepted on input and normalized to `GAP` by the Zod schema
(dual-accept enum). The JSON schema accepts both `GAP` and `MISSING` on
input. New report payloads only ever emit `GAP`. This ensures EPIC-36
integrity (hash chain, Ed25519 signatures) continues to verify old
reports — hash checks raw bytes, parsed consumers normalize.

---

## 5. Conflict detection algorithm (v0.1 scope)

CONFLICT is only ever produced by a `check.type: cross_evidence` rule
comparing **exactly two** already-fetched, already-parsed evidence
sources on a **shared key**.

For the one v0.1 cross-evidence rule (`AB-007`, Guide ↔ OpenAPI
consistency):

```
match_key = (http_method.upper(), path.rstrip('/'))

for each endpoint in agent_guide.endpoints:
    if match_key not in openapi.endpoints:
        → GAP (guide references an endpoint OpenAPI doesn't have)
    elif openapi.endpoints[match_key] differs in declared parameters:
        → CONFLICT, evidence = [guide_entry, openapi_entry]
    else:
        → VERIFIED
```

Explicitly **not** in v0.1: fuzzy path matching, synonym detection,
semantic equivalence (`/refund` vs `/refund-request` is a CONFLICT, not
an auto-resolved match), LLM-based reconciliation. This is intentional —
see EPICS.md Epic 2 for the scope boundary and rationale (this is
effectively an entity-resolution problem and is disproportionately
expensive relative to the rest of v0.1).

---

## 6. Scoring model

### 6.1 Confidence is not a score input

`confidence` is carried on every assertion for UI/human use ("⚠ 72%
confidence — please verify") but **never** multiplies or otherwise
directly determines score. Only `status` (via its scoring weight, §6.2)
and `severity` (via the floor rule, §6.3) determine score contribution.
This is a deliberate anti-gaming boundary: a model expressing high
confidence about an unverifiable claim must never be able to move the
score on its own.

**V2 extension (spec v0.3):** The derivatives of confidence —
`review_level` (§12.5) and `stale` (§12.4) — are ALSO never scoring
inputs. They serve workflow routing and display freshness respectively.
The boundary is: `confidence`, `review_level`, `age_days`, and `stale`
are all metadata for humans/agents/UI, never score contributors.

### 6.2 Category scores

Each rule belongs to exactly one category and has `counted_in_score:
true|false`. Only `counted_in_score: true` assertions contribute.

Per-category score = weighted average across that category's scored
assertions, where each assertion's status maps to a fixed contribution:

| Status | Score contribution |
|---|---|
| VERIFIED | 100% of the assertion's weight |
| INFERRED | 60% of the assertion's weight (capped — reflects "likely but unconfirmed", independent of the specific confidence value) |
| CONFLICT | 0% |
| GAP (was MISSING) | 0% |
| NOT_APPLICABLE | excluded entirely from the category's denominator (does not drag the average down) |

### 6.3 Category floor (anti-gaming)

If any `severity: high` rule in a category resolves to GAP or
CONFLICT, that category's score is capped, and — critically — **the
total score is capped** regardless of how well other categories score.
Default cap: total score ≤ 40 when any high-severity Discovery or
Documentation rule fails. Exact caps per category are configurable in
the ruleset config, not hardcoded in the scoring engine (see EPICS.md
Epic 3 acceptance criteria).

This exists specifically so a site cannot buy a high total score purely
by excelling at easy categories while being completely undiscoverable.

### 6.4 Total score (v1 — category-based)

```
total_v1 = Σ (category_score[i] × category_weight[i])   for all categories
total_v1 = min(total_v1, applicable_category_floor_cap)  if any floor triggered
```

Weights are defined per-ruleset (see `MVP-RULES.md` for v0.1's category
weights), not hardcoded in the scoring engine, so future ruleset versions
can rebalance without a code change.

### 6.5 Severity semantics

| Severity | Meaning | Effect |
|---|---|---|
| `high` | Without this, the API is not usable by agents at all | Triggers category floor (§6.3); triggers alert on regression (Phase 2 monitoring) |
| `medium` | Meaningful degradation, not a hard blocker | No floor effect; counted normally |
| `low` | Informational / nice-to-have | No floor effect; counted normally |

### 6.6 Pillar scores (v2 — pillar-based)

The four-pillar model is an **aggregation layer** over the existing 18
categories. Rules keep their `category`; the pillar is derived via
`rule.pillar ?? CATEGORY_TO_PILLAR[rule.category]` (see §A.8 for the
canonical mapping). No rule files are modified — the mapping is a single
tested function.

**Pillar aggregation formula:**

```
category_score[i]   — unchanged (status contributions × category weights, per §6.2)

pillar_score[p]     = Σ (category_score[i] × w[i]) / Σ (w[i])    for i ∈ pillar p
                      (category weights renormalized WITHIN the pillar)

total_v2            = Σ (pillar_score[p] × pillar_weight[p])     weights 20/25/30/25

total_v1            = Σ (category_score[i] × category_weight[i]) — preserved, config-selectable
```

**Default pillar weights:**

| Pillar | Weight | Question |
|---|---|---|
| `discovery` | 20% | Can an agent find you? |
| `understandability` | 25% | Can an agent understand what you do? |
| `executability` | 30% | Can an agent successfully use you? |
| `verifiability` | 25% | Can an agent trust what you say? |

**Scoring model config switch:**

The ruleset config contains a `scoringModel` field:

| Value | Total score formula |
|---|---|
| `"v1-categories"` | `total_v1` — category-weighted sum (§6.4), backward compatible |
| `"v2-pillars"` | `total_v2` — pillar-weighted sum (§6.6), default for new reports |

Both `total_v1` and `total_v2` are computable from the same assertion
set. The config switch selects which value is placed in `score.total`
in the report envelope. The non-selected total MAY be included as an
additional field for comparison.

**Floor surfacing on pillars:**

Floor semantics (§6.3) carry over unchanged: a `high`-severity
GAP/CONFLICT in `discovery` or `documentation` caps the total
(≤ 40). In v2, the triggered floor is also surfaced on the owning
**pillar** (`floorTriggered: true` in the pillar score object) so the
UI can show *why* a pillar is capped.

Pillar weights, category→pillar mapping, and the `scoringModel` switch
are all defined in the ruleset manifest, never hardcoded in the scoring
engine (same principle as §6.4).

---

## 7. Reproducibility & source state

The reproducibility claim — "same URL + same ruleset version + same
source state → same result" — requires `source_state` to be a fully
captured, hashable object, not just a URL string:

```yaml
source_state:
  url: "https://api.example.com/openapi.json"
  resolved_ip: "1.2.3.4"        # pinned before fetch, prevents DNS rebinding
  fetch_time: "2026-08-04T12:00:01Z"
  request_headers: { "User-Agent": "AgentBadge/0.1" }
  response_snapshot_hash: "sha256:..."
  response_snapshot: <base64>    # the actual fetched bytes
```

Storing the full snapshot (not just its hash) means any third party can
independently re-run the rule engine against the exact same captured
bytes and get the exact same assertion — without needing to trust that
AgentBadge fetched honestly at scan time. This is what makes "same
inputs → same output" a checkable claim rather than an assurance.

---

## 8. Report integrity

- **Canonicalization:** JCS — JSON Canonicalization Scheme, RFC 8785.
  Required before hashing; without it, key-order differences produce
  different hashes for semantically identical reports.
- **`content_hash`:** SHA-256 of the JCS-canonicalized report body
  (everything except the `integrity` block itself).
- **`signature`:** Ed25519 signature over `content_hash`. Signing is
  authorship/integrity, separate from hashing (content correctness) —
  the two are not interchangeable and both are required.
- **History chain:** each report stores `previous_hash` — the
  `content_hash` of the prior report for the same scope, or `null` for
  the first report. A verifier can walk the chain from genesis and
  detect tampering at the point where `previous_hash` no longer matches.
- **Offline verification:** `agentbadge verify-report <file>` must
  succeed using only the report file and a public key obtained from the
  `agent-readiness-spec` repository (see `KEYS.md`) — no call to
  AgentBadge's servers. This is the trust-boundary property: the report
  is independently auditable, not "trust us, we computed this right."
- **Legacy compat (V2):** Old reports containing `MISSING` status values
  continue to verify — the hash is computed over raw bytes, not parsed
  content. Parsed consumers normalize `MISSING` → `GAP` after
  verification succeeds.

---

## 9. Explicit v0.1 scope boundary

To prevent scope creep during implementation, v0.1 explicitly excludes:

- Active/authenticated verification of any endpoint (Phase 2, Epic 8)
- Fuzzy or semantic conflict detection (§5)
- Any GitHub OAuth, PR creation, or automated commits (`agentbadge fix`
  writes a local file only — see EPICS.md Epic 5)
- x402 / payment activity telemetry (Phase 4, separate optionality track)
- Hedera HCS anchoring of report history (optional future enhancement
  to §8's chain, not required for v0.1)
- Any "certification" language or claim — this spec measures, it does
  not certify. Badge and report copy must never use the word
  "certified" or imply a guarantee.

---

## 10. Non-goals (stated for clarity, not because anyone proposed them)

- This is not a security scanner and makes no security claims.
  `robots.txt` compliance is a crawler-behavior signal, not an access
  control mechanism, and must never be described as one.
- This is not a legal certification of API quality or reliability.

---

## 11. Report Envelope Structure

The report is the top-level signed artifact. Every field below is
required unless explicitly marked optional. Field names and types are
normative — the Zod schema (SLICE-32-9) and JSON Schema (SLICE-32-10)
must match exactly.

| Field | Type | Required | Format / Constraint |
|---|---|---|---|
| `report_id` | string | yes | ULID (`^[0-9A-HJKMNP-TV-Z]{26}$`); sortable, unique |
| `schema_version` | string | yes | Literal `"0.1.0"` — version of THIS schema, not the ruleset |
| `ruleset` | object | yes | `{ name: "agent-readiness", version: "<semver>" }` |
| `ruleset.name` | string | yes | Literal `"agent-readiness"` |
| `ruleset.version` | string | yes | Semver `^\d+\.\d+\.\d+$` (e.g. `2.1.0`) |
| `scope` | object | yes | `{ url: "<uri>" }` — one report describes exactly one scope |
| `scope.url` | string | yes | URI format |
| `scanned_at` | string | yes | ISO 8601 date-time |
| `previous_hash` | string\|null | yes | `sha256:<hex>` of prior report for this scope, or `null` for first report |
| `source_state` | array | yes | One entry per fetched resource (see §7) |
| `source_state[].url` | string | yes | URI |
| `source_state[].resolved_ip` | string | yes | IP address pinned before fetch |
| `source_state[].fetch_time` | string | yes | ISO 8601 date-time |
| `source_state[].status_code` | integer | no | HTTP status code |
| `source_state[].request_headers` | object | no | HTTP request headers sent |
| `source_state[].response_snapshot_hash` | string | yes | `^sha256:[0-9a-f]{64}$` |
| `source_state[].response_snapshot` | string | no | Base64-encoded raw response bytes |
| `score` | object | yes | See §11.1 |
| `assertions` | array | yes | Array of assertion objects (see §12) |
| `integrity` | object | yes | Integrity block (see §13) |

### 11.1 Score Sub-Structure

| Field | Type | Required | Format / Constraint |
|---|---|---|---|
| `score.total` | number | yes | 0–100, the overall agent readiness score |
| `score.floor_applied` | string\|null | yes | Name of the category floor rule that capped the total, or `null` if no floor triggered |
| `score.categories` | array | yes | One entry per category (see below) |
| `score.categories[].name` | string | yes | One of the 18 category enum values (see §A.2) |
| `score.categories[].weight` | number | yes | 0–1, category weight from ruleset config |
| `score.categories[].score` | number | yes | 0–100, weighted average for that category |
| `score.pillars` | array | no | Per-pillar scores (v0.2 additive, optional) — see below |
| `score.pillars[].pillar` | string | yes (if pillars present) | One of: `discovery`, `understandability`, `executability`, `verifiability` (see §A.7) |
| `score.pillars[].weight` | number | yes (if pillars present) | 0–100, pillar weight (default 20/25/30/25) |
| `score.pillars[].rawScore` | number | yes (if pillars present) | 0–100, raw pillar score before floor capping |
| `score.pillars[].score` | number | yes (if pillars present) | 0–100, final pillar score after floor capping |
| `score.pillars[].categoryCount` | integer | yes (if pillars present) | Number of categories mapped to this pillar |
| `score.pillars[].applicableCount` | integer | yes (if pillars present) | Number of applicable categories (NOT_APPLICABLE excluded) |
| `score.pillars[].floorTriggered` | boolean | yes (if pillars present) | Whether a floor cap was triggered on this pillar |
| `score.delta` | array | yes | Line-item score changes vs. previous report; empty array for first report |
| `score.delta[].rule_id` | string | yes | Rule ID that changed |
| `score.delta[].change` | number | yes | Score delta (positive or negative) |
| `score.delta[].reason` | string | yes | Human-readable reason for the change |

**`score.categories` is an array of 18 entries**, one per category name,
keyed by `name` (not a map object — the JSON Schema uses an array for
deterministic ordering).

**`score.pillars` is an optional array of 4 entries** (one per pillar),
present when `scoringModel: "v2-pillars"` is active. When absent, the
report uses v1 category-only scoring. When present, all four pillar
entries MUST be included.

---

## 12. Assertion Object Structure

Each entry in the `assertions` array has the following fields. Field
names and types are normative — they match the actual runtime
`Assertion` interface in `assertion-builder.ts`.

### 12.0 Assertion Fields

| Field | Type | Required | Format / Constraint | Since |
|---|---|---|---|---|
| `rule_id` | string | yes | `^AB-[A-Z0-9-]+$` (e.g. `AB-001`, `AB-007`) | v0.1 |
| `rule_version` | string | yes | Semver `^\d+\.\d+\.\d+$` | v0.1 |
| `category` | string (enum) | yes | One of the 18 category values (see §A.2) | v0.1 |
| `status` | string (enum) | yes | One of: `VERIFIED`, `INFERRED`, `CONFLICT`, `GAP`, `NOT_APPLICABLE` (see §4). `MISSING` accepted as legacy input alias. | v0.1 (GAP in v0.3) |
| `severity` | string (enum) | yes | One of: `high`, `medium`, `low` (see §6.5) | v0.1 |
| `counted_in_score` | boolean | yes | If `false`, this assertion does not contribute to score calculation | v0.1 |
| `confidence` | number | yes | 0.0–1.0; **UI-only, never a scoring input** (see §6.1) | v0.1 |
| `evidence` | array | yes | Array of evidence objects (see §12.1) | v0.1 |
| `conflict` | object | no | Present only when `status = CONFLICT` (see §12.2) | v0.1 |
| `timestamp` | string | no | ISO 8601 date-time — assertion BUILD time (distinct from `verified_at`) | v0.1 (code) |
| `source_url` | string\|null | no | Primary source URL for this assertion, if any | v0.1 (code) |
| `reason` | string | no | Human-readable explanation of the status determination | v0.1 (code) |
| `name` | string | no | Human-readable rule name | v0.1 (code) |
| `fix` | object | no | Fix metadata: `{ eligible: boolean, type: string, note?: string }` | v0.1 (code) |
| `claim` | string | no (V2) | Human-readable statement being checked — e.g. "Pricing is machine-readable and discoverable by agents" | v0.3 |
| `verified_at` | string | no (V2) | ISO 8601 date-time — latest evidence `captured_at` (fetch time); falls back to `timestamp` for evidence-less assertions | v0.3 |
| `review_level` | string\|null | no (V2) | `"automatic"` (confidence ≥ 0.80), `"assisted"` (< 0.80), `null` (NOT_APPLICABLE) — see §12.5 | v0.3 |
| `age_days` | number | no (V2) | Days since evidence capture — computed at read/display time, not stored at scan time (see §12.4) | v0.3 |
| `stale` | boolean | no (V2) | Whether evidence is stale per source-class freshness thresholds (see §12.4) | v0.3 |

**Note on "v0.1 (code)" fields:** The original spec v0.1 §12 documented
different fields (`severity`, `counted_in_score`, `conflict` sub-object;
evidence = `{source, detail}`). The actual code emitted `timestamp`,
`source_url`, `reason`, `name`, `fix`, and a 9-variant evidence union.
Spec v0.3 reconciles this drift — the table above documents the ACTUAL
shape. The JSON schema has been updated to match.

### 12.1 Evidence Object — 9-Variant Discriminated Union

Evidence is a discriminated union on the `type` field. Each variant has
its own set of fields. All variants share two new common fields (V2):

**Common fields (all variants):**

| Field | Type | Required | Since |
|---|---|---|---|
| `type` | string (enum) | yes | v0.1 |
| `captured_at` | string (ISO 8601) | no (V2) | v0.3 — propagated from `ResponseSnapshot.fetchedAt` |
| `source_class` | string (enum) | no (V2) | v0.3 — computed via source hierarchy (§12.3) |

**Per-variant fields:**

| Variant | `type` | Fields |
|---|---|---|
| HTTP | `http` | `url`, `status` (int), `headers` (object), `content_hash` (string), `content_type` (string\|null), `resolved_ip` (string\|null) |
| OpenAPI | `openapi` | `url`, `paths` (string[]), `methods` (string[]) |
| JSON Schema | `json_schema` | `url`, `schema_keys` (string[]), `valid` (boolean) |
| HTML | `html` | `url`, `title` (string\|null), `content_hash` (string), `content_type` (string\|null) |
| robots.txt | `robots` | `url`, `status` (int), `allows_all` (boolean), `disallowed_paths` (string[]) |
| sitemap.xml | `sitemap` | `url`, `status` (int), `url_count` (int), `urls` (string[]) |
| GitHub | `github` | `repo` (string), `path` (string), `content_hash` (string), `last_commit` (string) |
| Manual confirmation | `manual_confirmation` | `confirmed_by` (string), `confirmed_at` (string), `note` (string) |
| Cross-evidence | `cross` | `sources` (Evidence[]), `match_keys` (string[]), `conflict_reason` (string) |

**Legacy compat:** The old `{source, detail}` evidence shape is accepted
on input for backward compatibility but never emitted in V2 payloads.

### 12.2 Conflict Sub-Object

Present only when `status = CONFLICT`. Contains exactly 2 entries
describing the disagreeing sides.

| Field | Type | Required | Format / Constraint |
|---|---|---|---|
| `conflict.sides` | array | yes | Exactly 2 entries (minItems: 2, maxItems: 2) |
| `conflict.sides[].source` | string | yes | Evidence source of this side |
| `conflict.sides[].value` | string | yes | The conflicting value from this source |

### 12.3 Source Hierarchy — "deterministic before intelligent"

Evidence is classified into one of six source classes, ranked by
determinism and authority. The class is **computed** (not stored on
rules) via a pure function `(evidence.type, check.type) → source_class`.

| Rank | Source class | Evidence types | Description |
|---|---|---|---|
| 6 | `runtime` | `http` (from probe checks: `http_probe`, `content_parse`, `header_check`) | Live runtime behavior — highest authority |
| 5 | `machine_readable_spec` | `openapi`, `json_schema` | Machine-readable specifications |
| 4 | `machine_readable_guide` | `robots`, `sitemap` | Machine-readable guides |
| 3 | `official_docs` | `github`, `manual_confirmation` | Official documentation / manual verification |
| 2 | `website_content` | `http` (non-probe), `html` | Website content (non-probe HTTP fetches) |
| 1 | `ai_inference` | (reserved — unused in v0.3) | AI-generated evidence (future: EPIC-95) |

**Uses:**
- **Display:** "VERIFIED via OpenAPI spec" vs "Inferred from website content"
- **Conflict presentation:** Higher-rank source listed first
- **`strongestSource(evidence[])` helper:** Returns the highest-ranked source for UI badge
- **Freshness thresholds:** Per-class default staleness windows (see §12.4)

**Mapping rules (simplified):**
- `http` evidence from `http_probe` / `content_parse` / `header_check` checks → `runtime`
- `http` evidence from other check types → `website_content`
- `openapi` / `json_schema` → `machine_readable_spec`
- `robots` / `sitemap` → `machine_readable_guide`
- `github` / `manual_confirmation` → `official_docs`
- `html` → `website_content`
- `cross` → inherits from its strongest sub-source

### 12.4 Freshness Model

Freshness is a **pure function, computed at read/display time** — not
stored at scan time. A live scan is always fresh; staleness matters when
re-serving saved reports, replaying persisted `source_state`, and later
for EPIC-99 regression monitoring.

**`FreshnessChecker.check(assertion, now)` → `{ age_days, stale }`**

- `age_days` = `now - verified_at` in days (computed from the assertion's
  latest evidence `captured_at`, falling back to `timestamp`)
- `stale` = `age_days > threshold[source_class]`

**Default thresholds per source class (days):**

| Source class | Default threshold | Rationale |
|---|---|---|
| `runtime` | 7 | Runtime behavior changes frequently |
| `machine_readable_spec` | 30 | Specs change less often but should be current |
| `machine_readable_guide` | 30 | Guides (robots, sitemap) similar to specs |
| `official_docs` | 60 | Docs can be stale without being wrong |
| `website_content` | 14 | Web content changes frequently |
| `ai_inference` | 1 | AI-generated evidence is highly volatile |

**Manifest override:** The ruleset manifest may include an
`evidence.freshness` section overriding any or all defaults, using the
same config-driven pattern as scoring weights.

### 12.5 Review Routing

`review_level` routes assertions to the appropriate fix pipeline stage
(EPIC-97). It is **workflow metadata, never a scoring input** (extends
the §6.1 boundary).

| Condition | `review_level` | Meaning |
|---|---|---|
| `confidence >= 0.80` | `"automatic"` | Fix can be auto-generated without human review |
| `confidence < 0.80` | `"assisted"` | Fix requires human confirm/edit/reject |
| `status = NOT_APPLICABLE` | `null` | No fix needed — rule doesn't apply |

**Key invariant:** `review_level` is derived from `confidence`, which is
itself never a scoring input. Therefore `review_level` is transitively
never a scoring input. This is guarded by test.

---

## 13. Integrity Block

The `integrity` object is a single object within the report envelope
(not an array). It contains the hash and signature proving the report's
authenticity and tamper resistance.

| Field | Type | Required | Format / Constraint |
|---|---|---|---|
| `integrity.algorithm` | string | yes | Literal `"sha256"` — hash algorithm for content hash |
| `integrity.canonicalization` | string | yes | Literal `"JCS-RFC8785"` — JSON Canonicalization Scheme (RFC 8785) |
| `integrity.content_hash` | string | yes | `^sha256:[0-9a-f]{64}$` — SHA-256 of JCS-canonicalized report body (everything except the `integrity` block itself) |
| `integrity.signature` | object | yes | Ed25519 signature over `content_hash` |
| `integrity.signature.algorithm` | string | yes | Literal `"ed25519"` |
| `integrity.signature.key_id` | string | yes | Identifier of the public key used for verification |
| `integrity.signature.value` | string | yes | Base64-encoded Ed25519 signature over `content_hash` |

**Relationship to report envelope:**
- `assertions` is an array within the report envelope (§11).
- `integrity` is a single object within the report envelope (§11).
- The `integrity` block is excluded from `content_hash` calculation —
  it is computed over everything else, then the signature is applied.

---

## Appendix A — Canonical Enum Reference

This appendix is the single source of truth for all enumerated values
used in the report and rule schemas. SLICE-32-6 (Zod shared enums) must
match these exactly.

### A.1 Assertion Status

| Value | Defined in | Since |
|---|---|---|
| `VERIFIED` | §4 | v0.1 |
| `INFERRED` | §4 | v0.1 |
| `CONFLICT` | §4, §5 | v0.1 |
| `GAP` | §4 | v0.3 (canonical; replaces `MISSING`) |
| `MISSING` | §4 | v0.1 (legacy input alias — accepted on input, never emitted in new payloads) |
| `NOT_APPLICABLE` | §4 | v0.1 |

**Cross-check:** The JSON schema (`agentbadge-report.schema.json`)
accepts both `GAP` and `MISSING` in the status enum. The Zod schema
(`shared.schema.ts`) uses a dual-accept enum that normalizes `MISSING`
→ `GAP` on parse. Zero drift.

### A.2 Category

The category enum has been expanded from the original 5 categories (v0.1)
to the full 18 categories currently in the codebase. This reconciles the
spec ↔ code drift documented in EPIC-93.

| Value | Weight (v0.2) | Floor trigger | Pillar |
|---|---|---|---|
| `discovery` | 15% | any `high` GAP/CONFLICT → total ≤ 40 | discovery |
| `documentation` | 15% | any `high` GAP/CONFLICT → total ≤ 40 | understandability |
| `actionability` | 10% | no floor | understandability |
| `machine_readable` | 10% | no floor | discovery |
| `verification` | 5% | no floor | verifiability |
| `content_negotiation` | 5% | no floor | discovery |
| `payments` | 10% | no floor | executability |
| `bazaar` | 5% | no floor | executability |
| `openapi` | 10% | no floor | discovery |
| `skills` | 5% | no floor | discovery |
| `agents_txt` | 3% | no floor | discovery |
| `webmcp` | 3% | no floor | discovery |
| `identity` | 2% | no floor | executability |
| `bot_auth` | 1% | no floor | executability |
| `infrastructure` | 1% | no floor | verifiability |
| `seo_aeo` | 5% | no floor | discovery |
| `accessibility` | 4% | no floor | understandability |
| `active_probing` | 5% | no floor | verifiability |

**Cross-check:** Identical in `agentbadge-report.schema.json`
(`assertions.items.properties.category.enum`),
`agentbadge-rule.schema.json` (`category.enum`), and
`shared.schema.ts` (`categoryEnum`). Zero drift.

### A.3 Severity

| Value | Effect |
|---|---|
| `high` | Triggers category floor (§6.3); triggers alert on regression |
| `medium` | No floor effect; counted normally |
| `low` | No floor effect; counted normally |

**Note:** `critical` is intentionally excluded from v0.3. The three-level
scale is sufficient for the current ruleset; a `critical` tier may be added
in a future ruleset version (EPIC-95) if warranted.

**Cross-check:** Identical in `agentbadge-report.schema.json`
(`assertions.items.properties.severity.enum`),
`agentbadge-rule.schema.json` (`severity.enum`), and `MVP-RULES.md`
(per-rule Severity fields). Zero drift.

### A.4 Check Type

| Value | Description |
|---|---|
| `http_fetch` | HTTP GET + parse of a specific resource |
| `schema_validation` | Validate a fetched document against a JSON Schema |
| `exact_match` | Compare two fields for exact string/structural equality |
| `cross_evidence` | Compare two already-fetched evidence sources on a shared key (§5) |
| `http_probe` | HTTP request with status/header check |
| `content_parse` | Parse response body for specific content |
| `json_rpc` | JSON-RPC call to MCP endpoint |
| `header_check` | Verify specific HTTP headers |

**Cross-check:** Identical in `agentbadge-rule.schema.json`
(`check.type.enum`) and `shared.schema.ts` (`checkTypeEnum`). Zero drift.

### A.5 Fix Type

| Value | Description |
|---|---|
| `deterministic` | Safe to auto-generate (e.g. scaffold a missing file) |
| `assisted` | Requires human confirm/edit/reject — never auto-applied |
| `none` | Not fixable by AgentBadge |

**Cross-check:** Identical in `agentbadge-rule.schema.json`
(`fix.type.enum`) and `MVP-RULES.md` (per-rule Fix fields). Zero drift.

### A.6 Cross-Check Results

All grep comparisons between spec, `MVP-RULES.md`, and draft JSON Schemas
(`agentbadge-report.schema.json`, `agentbadge-rule.schema.json`) completed
with **zero undocumented deviations**. The only intentional deviation
from the slice specification is the exclusion of `critical` from the
severity enum (see A.3 note).

### A.7 Pillar

The pillar enum is introduced in v0.2 as the high-level scoring dimension
that aggregates categories. Each category maps to exactly one pillar
(see §A.8).

| Value | Weight | Question | Categories |
|---|---|---|---|
| `discovery` | 20% | Can an agent find you? | 8 categories |
| `understandability` | 25% | Can an agent understand what you do? | 3 categories |
| `executability` | 30% | Can an agent successfully use you? | 4 categories |
| `verifiability` | 25% | Can an agent trust what you say? | 3 categories |

**Cross-check:** Identical in `agentbadge-report.schema.json`
(`score.properties.pillars.items.properties.pillar.enum`),
`agentbadge-rule.schema.json` (`pillar.enum`), and
`shared.schema.ts` (`pillarEnum`). Zero drift.

### A.8 Category → Pillar Mapping

This is the canonical mapping from each of the 18 categories to exactly
one pillar. The mapping is defined in the ruleset manifest and tested
for completeness (18/18 categories, zero orphans).

| Category | Pillar |
|---|---|
| `discovery` | `discovery` |
| `machine_readable` | `discovery` |
| `openapi` | `discovery` |
| `skills` | `discovery` |
| `agents_txt` | `discovery` |
| `webmcp` | `discovery` |
| `content_negotiation` | `discovery` |
| `seo_aeo` | `discovery` |
| `documentation` | `understandability` |
| `actionability` | `understandability` |
| `accessibility` | `understandability` |
| `bot_auth` | `executability` |
| `identity` | `executability` |
| `payments` | `executability` |
| `bazaar` | `executability` |
| `verification` | `verifiability` |
| `infrastructure` | `verifiability` |
| `active_probing` | `verifiability` |

**Totals:** discovery = 8 categories, understandability = 3 categories,
executability = 4 categories, verifiability = 3 categories. 18/18 mapped.

**Rule-level override:** A rule MAY specify `pillar` as an optional
override. If present, it takes precedence over the category→pillar
mapping. If absent, `pillar(rule) = CATEGORY_TO_PILLAR[rule.category]`.

**Cross-check:** Validated in `pillar-map.ts` with a test asserting
18/18 coverage and zero orphans.

### A.9 Source Class (v0.3)

The source class enum ranks evidence provenance by determinism and
authority (see §12.3).

| Value | Rank | Description |
|---|---|---|
| `runtime` | 6 | Live runtime behavior (probe checks) |
| `machine_readable_spec` | 5 | OpenAPI, JSON Schema |
| `machine_readable_guide` | 4 | robots.txt, sitemap.xml |
| `official_docs` | 3 | GitHub, manual confirmation |
| `website_content` | 2 | HTTP (non-probe), HTML |
| `ai_inference` | 1 | AI-generated evidence (reserved, unused in v0.3) |

**Cross-check:** Identical in `agentbadge-report.schema.json`
(`$defs.evidence.properties.source_class.enum`) and the source hierarchy
module (`source-hierarchy.ts`, to be created in SLICE-94-3). Zero drift.

### A.10 Review Level (v0.3)

The review level enum routes assertions to the fix pipeline (see §12.5).

| Value | Condition | Meaning |
|---|---|---|
| `automatic` | `confidence >= 0.80` | Fix can be auto-generated |
| `assisted` | `confidence < 0.80` | Fix requires human review |
| `null` | `status = NOT_APPLICABLE` | No fix needed |

**Cross-check:** Identical in `agentbadge-report.schema.json`
(`assertions.items.properties.review_level`) and the review level policy
module (to be created in SLICE-94-5). Zero drift.
