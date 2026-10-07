# Agent Discovery Surface

EPIC-178. Machine-readable manifests for external agent registries
(smithery, pulsemcp, mcp.so, skills.sh, a2a-registry, …) so they can
index AgentBadge without scraping HTML.

## Endpoints

| Path | Content | Snapshot |
|------|---------|----------|
| `/llms.txt` | concise capability index | `public/llms.txt` |
| `/llms-full.txt` | full surface index | `public/llms-full.txt` |
| `/.well-known/agent-card.json` | A2A agent card | `public/.well-known/` |
| `/.well-known/api-catalog` | API surface map | `public/.well-known/` |
| `/.well-known/erc8004-agent.json` | ERC-8004 descriptor | `public/.well-known/` |
| `/.well-known/mcp/server-card.json` | MCP server card | `public/.well-known/` |
| `/.well-known/agent-evaluation.json` | self-evaluation | `public/.well-known/` |
| `/.well-known/owner-questions.json` | owner FAQ | `public/.well-known/` |
| `/.well-known/security.txt` | security contact | live (Expires field) |
| `/.well-known/did.json` | DID document | live (env-gated) |
| `/.well-known/agent.json` | → redirect to agent-card | — |

Registry: `src/server/lib/agent-discovery/manifests.ts`
(`MANIFEST_REGISTRY`). Entries with `publicPath: ""` are env-dependent
or gated → served live, never snapshotted (D-178-11). `redirectTo`
entries are pure redirects → also never snapshotted.

## Regenerating snapshots

Committed files in `public/` are generated, not hand-edited:

```bash
bun run gen:discovery          # writes public/…
GEN_DISCOVERY_OUT=/tmp/out bun run gen:discovery   # scratch dir
```

Implementation: `scripts/gen-discovery.ts` → `generateAll()` →
`writeDiscoverySnapshots()` (`lib/agent-discovery/snapshot.ts`).

## CI drift-check

`deploy-staging.yml` runs after the Green Gate:

```bash
bun run gen:discovery && git status --porcelain public/  # empty = clean
```

A hand-edited or stale `public/` file fails the workflow. Fix: rerun
`bun run gen:discovery` and commit the result — never patch `public/`
by hand.

## `?src=` attribution (SLICE-178-5)

Every manifest endpoint and `.md` mirror accepts `?src=<registry>`:

- whitelisted values (`smithery`, `pulsemcp`, `mcp.so`, `skills.sh`,
  `a2a-registry`, `glama` — `middleware/src-attribution.ts`) record an
  audit event `discovery-attribution` with `executionId: src:<value>`;
- any other value normalizes to `src:other` (no free-form cardinality);
- absent param → no event, no overhead.

In-memory counter: `srcCounts` map. Durable trail: `auditStore`.

## Markdown negotiation (SLICE-178-4)

`GET /page` with `Accept: text/markdown` → `text/markdown` body.
`GET /page.md` → same content via mirror. Canonical builder:
`lib/agent-discovery/markdown.ts` (`htmlToMarkdown`).

## Dogfood self-scan (SLICE-178-5)

`tests/e2e/discovery-dogfood.test.ts` serves `makeTestApp()` on a local
port and runs `scanDomain` + `RuleEngine` asserting AB-006 (MCP card),
AB-014 (llms.txt), AB-015/016 (homepage meta), AB-017 (ai.txt) are all
`VERIFIED`. It also contract-tests that no manifest path ever returns
401/402/403.

## Adding a SKU for a new paid route (SLICE-179-5)

The paid-services catalog (`GET /api/v1/services`), the bazaar extension
on every 402, and `llms.txt` are all generated from one registry —
`lib/service-catalog`. To ship a new billable endpoint:

1. **Register the SKU** — add an entry in
   `lib/service-catalog/entries/<surface>.ts` (or a new entry file wired
   in `entries/index.ts`). Set `sku_id` (`surface:slug`, immutable once
   published), `endpoint {method,path}`, `price_usd`, and `input_schema`
   — the same JSON schema your handler validates.
2. **Declare bazaar in the gate** — pass
   `bazaarExtensionFor("<sku_id>")` as `extensions` in the payment
   middleware (`paymentForPrice` opts, `bstockFreemium` cfg,
   `createSettleSeam` opts, or MPP `extra`). The emitted
   `inputSchema` is `inputSchemaOf(sku)` verbatim — do not hand-write a
   second schema (D-179-4 no-drift contract).
3. **Register the gate in the coverage test** — add a row to
   `GATE_TABLE` in `tests/e2e/catalog-coverage.test.ts`. The test fails
   if the gate has no SKU or the SKU endpoint resolves to no route.
   Gates that legitimately have no SKU belong in `GATE_EXCEPTIONS` with
   a documented reason (current set: `l402`, `attestation-api`).

Verify: `npx vitest run --config vitest.e2e.config.ts
tests/e2e/catalog-coverage.test.ts tests/e2e/bazaar-shape.test.ts`.
