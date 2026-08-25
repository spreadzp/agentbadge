# EPIC-48: CLI Feature Parity

**Goal:** Enhance CLI to match agentgrade-cli features — 70+ checks, 17 categories, JSON output, improvement guides, badge generation, robots.txt generator.

**Status:** Blocked by EPIC-47

## Blocks

- **A: Schema** (slice 48-1) — http_probe, content_parse, payments/identity/infrastructure categories
- **B: Fetchers** (slices 48-2 to 48-11) — 10 new fetchers
- **C: Rules** (slices 48-12 to 48-19) — 46 new rules AB-015 through AB-060
- **D: Orchestrator** (slice 48-20) — register all fetchers + rules + update scoring
- **E: CLI UX** (slices 48-21 to 48-22) — --json-api, --category, --format, --threshold
- **F: Generation** (slices 48-23 to 48-25) — improvement guide, robots.txt generator, badge SVG
- **G: Testing** (slices 48-26 to 48-28) — unit tests, E2E parity test

## Source Documents

- Full EPIC: `docs/EPICS/48-cli-feature-parity/EPIC-48-cli-feature-parity.md`
- SPEC: `docs/CONCURENTS/agent-grade/docs-for-epics/SPEC-02-cli-feature-parity.md`
