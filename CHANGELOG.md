# Changelog

All notable changes to AgentBadge are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] — 2025-01-15

### Added — Semantic Layer (EPIC-95)

- **15 semantic rules** (AB-146 through AB-160) across 7 new categories:
  - `pricing` — pricing discoverability + consistency across sources
  - `rate_limits` — machine-readable rate limit declarations
  - `error_semantics` — 4xx/5xx error response schemas in OpenAPI
  - `retry_semantics` — idempotency-key and Retry-After documentation
  - `sandbox` — test environment availability for agents
  - `versioning` — API version + deprecation policy
  - `agent_policy` — machine-readable AI agent usage policy
  - Plus: operation descriptions, parameter semantics, examples, capability list, business constraints, support path, authentication clarity
- **`semantic_validation` check type** — pure deterministic functions parsing structured sources (OpenAPI JSON, agent-guide JSON, llms.txt, agents.txt). No LLM — reproducible and auditable.
- **`critical` severity** — new severity tier for conditions where agents physically cannot proceed (e.g. auth absent). Triggers total score cap ≤ 30 via `criticalFloorCap` config.
- **`display_question` field** — GAP findings now surface as agent-framed questions ("What does a call cost?") instead of opaque rule IDs.
- **BLOCKER surfacing** — critical-severity GAPs appear as BLOCKERs in report payload and UI.
- **Three-valued semantics** — VERIFIED (fully met), INFERRED (partially met, rendered with "partial" chip), GAP (not met).
- **Rich API fixture** (`tests/fixtures/semantic/rich-api/`) — "Stripe-lite" target producing a known mix of VERIFIED/INFERRED/GAP outcomes.
- **V1-vs-V2 delta test** — proves ≥3 semantic findings invisible to the pre-95 ruleset; pillar scores differ.
- **Golden semantic scan test** — 15 per-rule status assertions frozen against fixture; regression-proof.
- **Zero-drift test** — machine-checked agreement between spec v0.4 Appendix A and code enums (25 categories, 4 severities, 9 check types, 25/25 pillar mapping).
- **Semantic explainer doc** (`docs/semantic-checks.md`) — agent question per check, three-valued semantics, critical floor, deterministic boundary.
- **Rules catalog** — 15 new rule entries with icons, descriptions, examples, severity badges.

### Changed

- **Category weights aligned to spec v0.4 §A.2** — v0.4 categories now use spec-canonical weights (pricing=3, rate_limits=3, error_semantics=3, retry_semantics=2, sandbox=1, versioning=2, agent_policy=2). Previous values were higher and unsynchronized with the spec.
- **Scores shift for content-poor targets** — APIs with missing descriptions, no error schemas, no pricing info, or no auth schemes now score lower. The V1-vs-V2 delta test documents this: V2 total < V1 total when semantic gaps are counted.
- **Ruleset manifest version** — bumped to 1.4.0 (SLICE-95-8).

### Backward Compatibility

- **Payloads are additive** — new fields (`severity`, `display_question`, `semantic_outcome`) are optional in the report schema. Existing consumers ignore unknown fields.
- **`critical` is a new enum value** — accepted everywhere severity parses. Old consumers that only handle `high`/`medium`/`low` will treat `critical` as unknown (no crash, just unstyled).
- **No breaking changes to existing rules** — all pre-95 rules (AB-001..AB-145) continue to function identically.

## [0.6.0] — 2024-12-01

### Added — Evidence Contract (EPIC-94)

- Evidence model with `source_url`, `fetched_at`, `body_hash`, `content_type`
- Report integrity: content hash + signature
- Spec v0.3 payload contract test

### Added — Unified Scoring (EPIC-93)

- Four pillars: Discovery, Understandability, Executability, Verifiability
- Category→pillar mapping (18 categories)
- Pillar-weighted scoring with renormalization
- CLI `--json-api` output with pillar breakdown
