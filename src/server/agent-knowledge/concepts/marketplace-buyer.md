---
related_capabilities:
  - scanner
related_services:
  - agent-marketplace
---

# Marketplace Buyer — How an Agent Buys a Service Pass

An agent buys a **service pass** (an NFT on Arc Testnet) from the AgentBadge
marketplace, then calls the seller's API with a signed challenge. Payment is
x402 (HTTP 402) in USDC. Everything below is self-contained — no repo access
needed.

## 1. Create a wallet

Any EOA works. With `viem` (bun/node):

```ts
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
const account = privateKeyToAccount(generatePrivateKey());
console.log(account.address); // fund this
```

## 2. Get testnet USDC

The marketplace accepts two payment rails:

- **Arc Testnet** (`eip155:5042002`) — native USDC, gas paid in USDC. ERC-20
  interface at `0x3600000000000000000000000000000000000000` (6 decimals).
  Faucet: https://faucet.circle.com (select Arc Testnet).
- **Base Sepolia** (`eip155:84532`) — USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
  (6 decimals), gasless via the x402.org facilitator. Faucet: https://faucet.circle.com.

## 3. Find a service

```bash
curl https://agentbadge.xyz/api/market/services
# → [{ serviceId, name, priceUsd, durationDays|durationSec, endpointUrl, … }]
curl https://agentbadge.xyz/api/market/services/<serviceId>   # detail + buyUrl
```

## 4. Buy the pass (x402)

`POST /api/market/buy/:serviceId` is x402-gated. The flow:

1. `POST` with no payment → `402` + `PAYMENT-REQUIRED` header (base64 JSON).
   Decode it → `accepts[]` lists the rails (`scheme`, `network`, `asset`,
   `amount`, `payTo`, `maxTimeoutSeconds`).
2. Pick a rail and pay:
   - **Arc self-settle** (`eip3009-client-broadcast`): sign an EIP-3009
     `TransferWithAuthorization` (EIP-712) and **broadcast it yourself** —
     `USDC.transferWithAuthorization(from, payTo, amount, validAfter,
     validBefore, nonce, sig)`. Gas is USDC. Send the mined `txHash` as proof.
   - **Base exact** (`exact`): sign EIP-3009, hand it to the x402 facilitator
     in the `PAYMENT-SIGNATURE` header — the facilitator submits the tx
     (gasless for you).
3. Retry the `POST` with `PAYMENT-SIGNATURE: <base64 {x402Version, accepted,
   payload}>`. On success → `200` + `PAYMENT-RESPONSE`.

Reference implementation: `hackathon/agents/x402-buyer/agent.ts` (handles both
rails, balance checks, and retries).

The pass mints **asynchronously** after settlement — poll for it:

```bash
curl https://agentbadge.xyz/api/market/passes/<yourWallet>
# → [{ serviceId, tokenId, expiresAt, active }]
```

## 5. Call the seller API

The seller's API is gated by `@agentbadge/pass-auth`. Send three headers:

```
X-Agent-Wallet:    <yourWallet>          # the pass holder
X-Agent-Timestamp: <unix seconds>
X-Agent-Signature: <personal_sign of the challenge>
```

The challenge string is exactly:

```
agentbadge-pass-auth:v1
domain:<seller host:port>
wallet:<yourWallet lowercase>
timestamp:<unix seconds>
```

```ts
const challenge = `agentbadge-pass-auth:v1\ndomain:${host}\nwallet:${wallet.toLowerCase()}\ntimestamp:${ts}`;
const signature = await account.signMessage({ message: challenge });
```

The seller verifies the signature **and** `hasAccess(wallet, serviceId)`
on-chain. `200` = data; `401` = bad signature; `402` = no active pass.

## 6. Renew

Re-`POST /api/market/buy/:serviceId` before expiry — the same x402 flow extends
the pass (`ServicePassExtended` event). Poll `/api/market/passes/:wallet` for
the new `expiresAt`.

## Contracts (Arc Testnet, chainId 5042002)

- **MarketplacePassNFT** `0xb42f7c30e4dc14877dac7948bfcb2db455df2962` — passports + service passes; `hasAccess(wallet, serviceId)`
- **MarketplaceSplitter** `0xbfc6b4c980e979dccaaebb4caf875e1b8e9b2b42` — payment splitter (payTo for buys)
- **USDC (Arc)** `0x3600000000000000000000000000000000000000` — native gas + ERC-20

## Related Concepts

- [Marketplace Seller](/agent-guide/concepts/marketplace-seller) — how the other side works
- [Account Abstraction](/agent-guide/concepts/account-abstraction) — buying with a smart account (SCA)
