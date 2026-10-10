---
related_capabilities:
  - ai-agent-architecture
  - blockchain-infrastructure
related_services:
  - ai-agent-consulting
---
# Self-Serve Agent Registration: One POST → ERC-8004 Passport + API Key

## Summary

`POST /api/v1/agents/register` mints an ERC-8004 NFT passport in the canonical
IdentityRegistry on Arc (`eip155:5042`, `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`)
and returns a working `agb_` API key in the same 201 response. No account, no
form, no funded wallet required — the treasury pays mint gas via a dedicated
ops signer (`ARC_OPS_KEY`). Sponsored mode additionally hands the NFT to the
user's own EOA against an EIP-191 intent signature.

## Request / Response

```jsonc
// POST /api/v1/agents/register
{ "name": "my-agent", "endpoint": "https://agent.example.com",
  "capabilities": ["scanner"], "description": "…" }

// 201
{ "agent_id": "eip155:5042:0x8004A169…a432:<tokenId>",
  "registry": "erc-8004", "registry_tx": "0x…",
  "agent_uri": "data:application/json;base64,…",
  "api_key": "agb_<shown once>",
  "tier": "observer",
  "limits": { "free_tier": "10/min per key" },
  "next_call": { "method": "GET", "path": "/api/v1/agents/me" } }
```

- `agent_uri` — base64 data-URI holding the EIP-8004 registration file inline
  in mint calldata (≤2 KB, `truncated` marker on shed); no IPFS dependency
- `api_key` — `agb_` + 32B base64url; SHA-256 stored, shown once

## Observer Tier

Rung 0 of `/api/meta/trust-tiers` (7 levels). Keyed callers get 10 req/min vs
1/min anonymous on the free-tier surface; paid surfaces still x402 for all —
identity, not a discount. `GET /api/v1/agents/me` returns the public record;
`DELETE /api/v1/agents/me` self-revokes with an instant auth-cache bust.

## Sybil Guards

- `regcap:<ip>:<day>` — per-IP daily cap (default 20, `AGENT_REGISTER_DAILY`)
  → `429 register_rate_limited`; cache-backed, in-memory fallback, fail-open
- Mint failure → `502 execution_failed`, no record persisted; unconfigured → 503
- `DELETE /api/v1/admin/agents/:agentId` — admin revoke + cache bust in one
  call; revoked key → `401 agent_key_revoked` on next request

## Sponsored Registration

`POST {name, owner, signature}` — `signature` = owner's EIP-191 intent over
`agentbadge:register:v1\neip155:<chainId>\n<registry>\n<owner>\n<name>`.
Server verifies, ops wallet does `register()` + `transferFrom(ops→owner)` —
NFT lands in user's EOA, treasury pays gas. `sponcap:<day>` global budget
(`REGISTER_SPONSORED_DAILY`, default 50) → `429 sponsored_quota_exceeded`.
Check order: per-IP regcap → signature verify → sponsored budget.
Feature flag: `REGISTER_SPONSORED=1`. Record carries `owner`, `sponsored:true`,
`ownerTx` — visible in `/me`.

## Endpoints

| Need | Endpoint |
|------|----------|
| Register agent | `POST /api/v1/agents/register` |
| Public record / self-revoke | `GET` / `DELETE /api/v1/agents/me` |
| Admin revoke | `DELETE /api/v1/admin/agents/:agentId` |
| Trust ladder | `GET /api/meta/trust-tiers` |
| Error catalog | `GET /api/meta/errors` |

## Verify It

`curl -X POST https://agentbadge.xyz/api/v1/agents/register -H "content-type: application/json" -d '{"name":"probe"}'`
→ use the returned `agb_` key against `GET /api/v1/agents/me` immediately.

## Links

- Blog article: https://agentbadge.xyz/blog/arc-c20-self-serve-registration
- llms.txt: https://agentbadge.xyz/llms.txt
- Error catalog: https://agentbadge.xyz/api/meta/errors
