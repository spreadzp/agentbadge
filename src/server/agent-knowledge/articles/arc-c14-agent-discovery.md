---
related_capabilities:
  - ai-agent-architecture
  - api-design
related_services:
  - ai-agent-consulting
---
# Agent Discovery Surface: .well-known Manifests + llms.txt

## Summary

agentbadge.xyz serves a fully generated machine-readable discovery
layer: 11 manifests under `/.well-known/` plus a generated
`llms.txt` sitemap. Nothing is hand-edited — every manifest is a
projection of live sources (openapi.ts, route config, blog-data.ts,
SKU catalog) built into a manifest registry at boot; CI fails on
drift (`git diff --exit-code` on regenerated snapshots, golden tests
for env-dependent manifests).

## Live Manifests (all 200 OK, no auth)

```
/.well-known/agent-card.json        A2A v1.0 — provider, skills[],
                                    supportedInterfaces[], x402
                                    securityScheme
/.well-known/api-catalog            RFC 9727 application/linkset+json
/.well-known/erc8004-agent.json     EIP-8004 registration-v1
/.well-known/mcp/server-card.json   MCP capabilities + tools
/.well-known/agent-evaluation.json  verification ladder (claims→refs)
/.well-known/owner-questions.json   operator/jurisdiction/contact
/.well-known/did.json               did:web:agentbadge.xyz document
/.well-known/did-configuration.json VC-JWT DomainLinkageCredential
                                    (EdDSA, iss==sub==DID, exp +1y)
/.well-known/jwks.json              Ed25519 key set (kid
                                    agentbadge-2026-1)
/.well-known/security.txt           RFC 9116, Expires generated +1y
/llms.txt, /llms-full.txt           llmstxt.org convention, generated
```

Legacy `/.well-known/agent.json` → `301` → `agent-card.json`.
`ai-plugin.json` is deliberately absent — ChatGPT Plugins EOL 2024.

## Generation Model

- `src/server/lib/agent-discovery/` — sources → manifests registry
- `src/server/routes/discovery.ts` — thin routes serving registry
- `bun run gen:discovery` — build-time snapshots under
  `public/.well-known/` + `public/llms*.txt`
- Boot-time: env-dependent manifests generate into the registry
  (one source of truth, zero drift); statics are snapshot files
- CI: regenerate + `git diff --exit-code` catches any drift

## Markdown Negotiation

`Accept: text/markdown` on any page → markdown representation.
Blog articles carry `.md` mirrors (`/blog/<slug>.md` → 200
`text/markdown`). Canonical page stays HTML; `<link
rel="alternate" type="text/markdown">` advertises the twin.

## Verification Ladder (agent-evaluation.json)

Claims ordered by check-cost, each `{claim, action, ref}`:
- `5s` — on-chain deployment (Arc explorer) + agent card
- `60s` — manifest validity, live OpenAPI, refusal contract
- deeper — dogfood transactions, audit trails

`owner-questions.json` answers enterprise due-diligence
(operator, jurisdiction, contact) in machine-readable form.

## Dogfood Gate

The 142-rule readiness scanner (agentbadge-scan) runs against
agentbadge.xyz itself in CI — AB-006 (mcp server-card), AB-014
(llms.txt), AB-015/016 (JSON-LD/OG), AB-017 (ai.txt). 100% pass
required; a broken manifest fails the deploy.

## Verify

```bash
curl -s https://agentbadge.xyz/.well-known/agent-card.json | jq
curl -sH "Accept: text/markdown" https://agentbadge.xyz/blog
npx agentbadge-scan agentbadge.xyz
```
