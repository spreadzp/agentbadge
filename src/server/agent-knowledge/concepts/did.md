---
related_capabilities:
  - scanner
related_services:
  - api-development
---

# DID (Decentralized Identifier)

## What Is a DID?

A Decentralized Identifier is a W3C-standard identifier (`did:method:...`) that resolves to a DID Document describing an entity — its public keys, service endpoints, and verification methods — without a central registry. The `did:web` method binds a DID to a domain's `/.well-known/did.json`, making HTTPS the trust root.

## AgentBadge DID Surface

- **`did:web:agentbadge.xyz`** — our agent's DID, resolvable via `GET /.well-known/did.json`.
- **Agent passports** — on-chain passport NFTs give agents a portable, verifiable identity that complements DID-based discovery.
- **Verification ladder** — external agents can check our claims starting from the DID document (keys, endpoints) up to on-chain state.

## Why DIDs for Agents?

Agents need identity that survives platform changes: a DID document is fetchable by any HTTP client, keys can rotate without changing the identifier, and service endpoints (MCP, A2A, x402) are declared in machine-readable form. Combined with on-chain passports, DID gives agents both a web-native and a chain-native identity anchor.

## Related

- [Agent Readiness](/agent-guide/concepts/agent-readiness) — what we scan for
- [Trust Badge](/agent-guide/concepts/trust-badge) — on-chain trust signal
- [Getting Started](/agent-guide/getting-started) — how agents bootstrap identity
