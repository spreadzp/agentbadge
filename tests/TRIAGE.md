# SLICE-86-1: Test Suite Triage

**Generated:** 2026-08-26
**Vitest run:** `bunx vitest run --run`
**Result:** 102 failed | 311 passed (413 suites), 412 failed tests | 4294 passed | 9 skipped

## Typecheck Summary

**147 TS errors** across src/ and tests/

| Error code | Count | Category |
| --- | --- | --- |
| TS2345 | 64 | Mock<Procedure> vs typeof fetch; string vs HcsMessageReceipt |
| TS2322 | 51 | HcsMessageReceipt not assignable to string; missing properties |
| TS2304 | 14 | Cannot find name 'c' (well-known.ts) |
| TS2339 | 7 | Property doesn't exist on type |
| TS2741 | 5 | Missing properties in type |
| TS2739 | 2 | Missing properties in object literal |
| TS2367 | 1 | Unintentional comparison ('SKIPPED' vs status union) |
| TS2307 | 1 | Cannot find module |
| TS18048 | 1 | Possibly undefined |
| TS18047 | 1 | Possibly null/undefined |

## Classification

### Class (a): bun:test imports — 22 suites, 0 tests collected

Mechanical rewrite `bun:test` → `vitest` imports. `mock` → `vi.fn()`, `beforeAll/afterAll` stay same.

| Suite | Notes |
| --- | --- |
| tests/agents/cli.test.ts | uses `mock` |
| tests/agents/csv-parser.test.ts | simple |
| tests/agents/edge-cases.test.ts | simple |
| tests/agents/integration/full-lifecycle.test.ts | simple |
| tests/agents/ipfs-uploader.test.ts | uses `mock`, `beforeEach`, `afterEach` |
| tests/agents/medical-agent.test.ts | uses `mock` |
| tests/agents/report/json-report.test.ts | simple |
| tests/agents/self-correcting-loop.test.ts | uses `mock`, `beforeEach` |
| tests/artifact-sync.test.ts | simple |
| tests/e2e/agent-discovery.e2e.test.ts | NOT bun:test — process.exit error (class d) |
| tests/e2e/demo-flow-27.test.ts | uses `beforeAll`, `afterAll` |
| tests/mcp/dataset.tools.test.ts | uses `mock`, `beforeEach` |
| tests/routes/agent-guide.test.ts | simple |
| tests/routes/demo-mode.test.ts | uses `beforeAll`, `afterAll` |
| tests/routes/medical-guide.test.ts | simple |
| tests/scripts/seed-medical-tasks.test.ts | uses `mock`, `beforeEach`, `afterEach` |
| tests/views/datahub-links.test.ts | simple |
| tests/views/escrow-panel.test.ts | simple |
| tests/views/jsonld-price-sync.test.ts | simple |
| tests/views/single-h1.test.ts | simple |
| tests/views/title-tags.test.ts | simple |
| tests/views/verification-panel.test.ts | simple |

### Class (b): Stale mocks — ~10 suites

`Mock<Procedure>` not assignable to `typeof fetch` — fetchers tests pass `vi.fn()` where `typeof fetch` expected.

Affected: `tests/unit/fetchers/a2a-fetcher.test.ts`, `bot-auth-fetcher.test.ts`, `homepage-meta-fetcher.test.ts`, `identity-fetcher.test.ts`, `infrastructure-fetcher.test.ts`, `mcp-probe-fetcher.test.ts`

Fix: cast `vi.fn() as unknown as typeof fetch` or use proper mock typing.

### Class (c): Behavior drift — ~60+ suites

Assertion failures where test expectations don't match current behavior. Major clusters:

- **Marketplace routes** (50 failures): `marketplace-routes.test.ts` — likely HcsMessageReceipt return type change
- **A2A tools** (8+9+9 failures): `a2a-mcp-tools`, `a2a-routes`, `a2a-signed` — messaging behavior changed
- **Market escrow** (13+7+9 failures): `market-cancel-increase-reward`, `market-claim-escrow`, `market-complete-verification` — escrow flow changes
- **Integration** (19+7+15 failures): `agentgrade-100`, `escrow-lifecycle`, `isitagentready-endpoints`
- **E2E** (20+7+6 failures): `crawler-simulation`, `marketplace.e2e`, `signature-payment`

### Class (d): Genuinely obsolete / broken — 2 suites

- `tests/e2e/agent-discovery.e2e.test.ts` — calls `process.exit(1)` during config validation, crashes under vitest
- `tests/e2e/isitagentready-score.test.ts` — 240s timeout, likely real network calls

## Fix Plan

1. **Class (a):** Codemod `bun:test` → `vitest` (22 files, mechanical)
2. **Class (b):** Fix mock typing (6 files, `as unknown as typeof fetch`)
3. **Class (c):** Triage per-suite after (a)+(b) reduce noise
4. **Class (d):** Exclude or fix individually

## Progress

- [x] Class (a): bun:test → vitest (21 files converted)
- [x] Class (b): stale mock typing (resolved after bun:test fix)
- [x] src TS errors fixed: 0 src errors (was 25)
- [ ] Class (c): behavior drift triage (87 suites still failing)
- [ ] Class (d): obsolete suite exclusion (1 suite: agent-discovery.e2e)
