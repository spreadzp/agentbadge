---
related_capabilities:
  - on-chain-recording
  - keeperhub
related_services:
  - on-chain-scan-recording
---

# Trust Badge

TrustBadge is a soulbound (non-transferable) NFT on Base Sepolia that represents a verified agent readiness score.

## What Makes It Soulbound

TrustBadge uses an ERC-721 `_update` hook that reverts on any transfer attempt. Once minted to an address, it cannot be moved — it is permanently bound to the recipient.

## How to Earn One

1. Scan your site with `confirm: true`
2. The scan score must meet the minimum threshold
3. KeeperHub workflow mints the TrustBadge automatically
4. The badge is visible on-chain and can be verified by anyone

## Contract

- **TrustBadge** (`0x6e408672e56001dc24a5db68107f9abf900f87e3`) — Base Sepolia, ERC-721 with soulbound hook

## Verification

Anyone can verify a TrustBadge by:

1. Checking the contract on Basescan
2. Calling `ownerOf(tokenId)` to confirm ownership
3. Reading the metadata for scan score and timestamp

## Related Concepts

- [On-Chain Recording](/agent-guide/concepts/on-chain-recording) — How scan results are recorded on Base Sepolia
- [Scoring Engine](/agent-guide/concepts/scoring) — How scan scores are calculated
