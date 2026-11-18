---
related_capabilities:
  - x402
  - scanner
related_services:
  - api-development
---

# Micropayments

## What Are Micropayments?

Micropayments are transactions of fractions of a cent to a few cents — too small for card networks (whose fixed fees exceed the payment) but viable on-chain where fees are sub-cent. For agents, micropayments enable pay-per-request APIs: instead of a monthly subscription or API key, an agent pays $0.001–$0.01 per call, proportional to actual usage.

## Why Arc Makes Them Work

- **Sub-cent gas** — Arc's fee structure keeps a $0.001 transfer economically sensible.
- **USDC settlement** — stable unit of account, no volatility risk on the payment leg.
- **EIP-3009 signatures** — agents authorize payments off-chain; no per-tx gas UX.

## AgentBadge Micropayment Surface

- **x402 endpoints** — EaaS verdicts, total scans, scan packs, marketplace purchases — all priced per call in USDC.
- **402 challenges carry pricing** — agents read exact cost from the challenge before paying (bazaar extension).
- **Free tier preserved** — passive scans and directory browsing stay free; micropayments apply to compute and settlement.

## Related

- [USDC](/agent-guide/concepts/usdc) — the settlement asset
- [x402 Payments](/agent-guide/capabilities/x402) — the protocol
- [EIP-3009](/agent-guide/concepts/eip-3009) — the signature scheme
- [Scan Packs](/agent-guide/concepts/scan-packs) — prepaid scan bundles
