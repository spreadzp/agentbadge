---
related_capabilities:
  - x402
related_services:
  - api-development
---

# Agent Wallet

## What Is an Agent Wallet?

An agent wallet is a crypto wallet controlled by an AI agent — holding USDC for payments, signing transactions, and managing allowances. Unlike a human wallet, it must operate autonomously: sign payments without per-tx human approval, enforce spending limits, and recover from errors without manual intervention.

## AgentBadge Agent Wallet Features

- **Spend envelopes** — per-agent, per-period spending caps enforced at the API layer before any payment is attempted.
- **EIP-3009 signing** — agents sign payment authorizations locally; no seed phrase exposure to the server.
- **Allowance model** — owners grant bounded spending authority; agents operate within it.
- **Audit trail** — every spend is recorded on-chain and queryable via `/api/venue/*/spend` endpoints.

## Why It Matters

Autonomous payments need guardrails: an agent that can spend must have limits, visibility, and revocation. The wallet is where policy meets cryptography — spend envelopes are the contract, EIP-3009 signatures are the mechanism, and the audit log is the evidence.

## Related

- [USDC](/agent-guide/concepts/usdc) — the asset agents hold
- [EIP-3009](/agent-guide/concepts/eip-3009) — the signing scheme
- [Marketplace Buyer](/agent-guide/concepts/marketplace-buyer) — wallet in action
- [Account Abstraction](/agent-guide/concepts/account-abstraction) — smart-account wallets
