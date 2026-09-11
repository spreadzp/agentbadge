# Changelog

All notable changes to AgentBadge are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.14.0] — 2025-09-14

### Added — KeeperHub On-Chain Recording (EPIC-126)

- **TrustRegistry contract** on Base Sepolia (chain 84532) — records scan results (URL, score, rules passed/total, timestamp) on-chain
- **TrustBadge soulbound NFT** — non-transferable NFT badge for agents that pass the readiness scan; uses `_update` hook to revert transfers
- **AgentPassport NFT on Base** — on-chain passport minted via KeeperHub workflow for verified sites
- **KeeperHub workflow integration** — `record_scan` triggers `record-scan` workflow, `mint_badge` mints TrustBadge + AgentPassport, `workflow_status` checks execution status
- **Live SSE audit trail** — `/audit/stream` endpoint streams on-chain audit events in real-time (Server-Sent Events)
- **Webhook receiver** — `/audit/webhook` accepts KeeperHub callback notifications
- **x402 premium scans** — USDC payment for premium scans that include on-chain recording, badge minting, and audit trail access
- **MCP tools** — `record_scan`, `mint_badge`, `workflow_status`, `audit_events` (4 new tools in keeperhub category)
- **npm package** — `@agentbadge/keeperhub` — TypeScript SDK for KeeperHub MCP API, workflow templates, contract ABIs

### Added — Attestcoin Cross-Chain Verification (EPIC-127)

- **Cross-chain verified task marketplace** — tasks posted on Ethereum Sepolia, verified on Creditcoin CC3 Testnet
- **Attestcoin Protocol integration** — on-chain proof verification using TaskEscrow (Ethereum) and TaskMarketplaceASC + TaskState (Creditcoin) contracts
- **Worker A/B bridge architecture** — Worker A bridges task hashes from Ethereum to Creditcoin, Worker B bridges result hashes back
- **AI agent task lifecycle** — agents monitor, evaluate, claim, process, and complete tasks autonomously
- **IPFS result storage** — task results stored on IPFS with hashes recorded on both chains
- **Live demo page** — `/hackathon/attestcoin` shows real-time task lists, architecture diagrams, and block explorer links
- **REST API endpoints** — `GET /api/attestcoin/tasks`, `GET /api/attestcoin/tasks/:taskIds`, `POST /api/attestcoin/verify`
- **MCP tools** — `verify_cross_chain_task`, `list_verified_tasks`, `get_task_status` (3 new tools in attestcoin category)
- **npm package** — `@agentbadge/attestcoin` — contract ABIs, TypeScript types, SDK wrapper, Worker A/B code, AI agent logic

### Changed — Website Documentation (SLICE-127-24)

- **FAQ** — 17 new Q&A entries across two new categories: "KeeperHub & On-Chain Recording" (10) and "Cross-Chain Verification (Attestcoin)" (7)
- **llms.txt** — Added KeeperHub endpoints table, Attestcoin endpoints table, Multi-Chain Support section, npm Packages section, 7 new MCP tools
- **Agent Card** — Added 5 new capabilities, 2 new skills, 6 new endpoints, multi-chain blockchain config (Base Sepolia, Ethereum Sepolia, Creditcoin Testnet)
- **Agent Guide** — 4 new concept pages: On-Chain Recording, TrustBadge NFT, Cross-Chain Verification, Attestcoin Workers
- **Knowledge Map** — 5 new nodes and 6 new edges connecting KeeperHub and Attestcoin concepts to existing knowledge graph
- **Services Page** — 2 new service entries: KeeperHub On-Chain Recording, Attestcoin Cross-Chain Verification
- **OpenAPI Spec** — Added KeeperHub and Attestcoin API paths

## [0.13.0] — 2025-09-07

### Added — Data Moat / Cross-Scan Corpus (EPIC-103)

- **SLICE-103-1**: Corpus record schema (spec v0.11 §14), PII sweep, corpus extractor
- **SLICE-103-2**: File-backed corpus store (JSONL append-only), PII rejection at write
- **SLICE-103-3**: Aggregation engine (8 functions) + statistical utilities (mean, median, stddev, percentile, bucketize)
- **SLICE-103-4**: Benchmark computation, trend analysis, in-memory benchmark cache
- **SLICE-103-5**: Public benchmark API endpoints (overall, category, pillar, stats) with 1h cache TTL
- **SLICE-103-6**: State of Agent Readiness report generator (markdown + JSON)
- **SLICE-103-7**: CLI commands — `agentbadge benchmarks`, `agentbadge corpus`, `agentbadge report`
- **SLICE-103-8**: Web UI — `/benchmarks` dashboard, `/benchmarks/:category` detail, `/benchmarks/reports` archive, `/benchmarks/reports/:id` viewer
- **SLICE-103-9**: Privacy audit — `auditCorpusForPii()`, golden anonymization fixtures, enhanced PII sweep (FTP URLs, object key scanning)
- **SLICE-103-10**: E2E lifecycle tests, golden benchmark fixtures (55 records), zero-drift verification, version bump

### Changed
- CLI version bumped to 0.13.0
- PII sweep now detects FTP URLs and scans object keys
- `LandingLayout` import path fixed for benchmark pages

## [0.12.0] — 2025-08-XX

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
