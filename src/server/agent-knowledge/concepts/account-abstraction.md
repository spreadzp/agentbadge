---
related_capabilities:
  - scanner
related_services:
  - agent-marketplace
---

# Account Abstraction — Buying with a Smart Contract Account

An agent can operate as an **ERC-4337 smart contract account (SCA)** on Arc
Testnet instead of a raw EOA. The SCA holds USDC, self-pays gas from an
EntryPoint deposit, and holds the service pass — the pass mints to the **SCA
address**, so the account itself is the buyer identity.

## What's supported on Arc Testnet (chainId 5042002)

- **Bundler** — Pimlico: `https://api.pimlico.io/v2/5042002/rpc?apikey=$PIMLICO_API_KEY`
- **EntryPoint v0.6** — `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`
- **SimpleAccountFactory v0.6** — `0x9406Cc6185a346906296840746125a0E44976454`
  (the v0.7 factory is **not** deployed on Arc — use EntryPoint v0.6)
- **Account** — `toSimpleSmartAccount` from `permissionless.js`; counterfactual
  address until the first UserOp deploys it.

## Funding the SCA

1. **USDC** — plain `USDC.transfer(scaAddress, amount)` to the counterfactual
   address (ERC-20 `0x3600000000000000000000000000000000000000`, 6 decimals).
2. **Gas** — self-pay via an EntryPoint deposit:
   `EntryPoint.depositTo(scaAddress)` with native USDC (18 decimals). The
   bundler draws gas from this deposit. (A paymaster is the alternative.)

## The honest limitation: no ERC-1271

The SimpleAccount implementation deployed on Arc **lacks `isValidSignature`** —
it cannot answer ERC-1271. Two consequences:

- **EIP-3009 `transferWithAuthorization` from the SCA fails** — the token's
  `ecrecover` on the signature returns an EOA, not the contract, so the
  authorization is rejected. A contract wallet can't "sign" an EIP-3009 the way
  an EOA does.
- **Challenge signatures for API auth fail** — `isValidSignature` reverts.

### The session-key pattern (the workaround)

The SCA's **owner EOA acts as its session key**:

- **Payment** — instead of signing an EIP-3009, the SCA **executes
  `USDC.transfer(payTo, amount)` itself via a UserOp**. The `Transfer` event's
  `from` is the SCA, so the marketplace mints the pass to `payer = SCA`. The
  account still pays for the pass and self-pays gas — full AA via *execution*
  rather than a contract signature.
- **API auth** — the owner `personal_sign`s the challenge and sends
  `X-Agent-Wallet = <scaAddress>`. `verifyPassSignature` falls back: for a
  contract wallet whose `isValidSignature` fails, it recovers the signer and
  accepts iff `recovered == SCA.owner()`. The owner controls the account by
  design, so it's a sound session key.

```
EOA owner ──signs UserOp──▶ SCA ──executes──▶ USDC.transfer(payTo) ──▶ pass → SCA
EOA owner ──personal_sign──▶ challenge ──▶ seller checks recovered == SCA.owner()
```

## What already works (1271/6492)

`verifyPassSignature` supports ERC-1271 and ERC-6492 natively — an account that
*does* implement `isValidSignature` (or a counterfactual 6492 signature) is
verified directly, no session key needed. The session-key path is only the
fallback for accounts without 1271.

## Reference

- Buyer impl: `hackathon/agents/aa-buyer/` (`create-account.ts`, `fund.ts`,
  `buy.ts`, `call.ts`, `status.ts`)
- Verifier fallback: `@agentbadge/pass-auth` `verifyPassSignature`

## Related Concepts

- [Marketplace Buyer](/agent-guide/concepts/marketplace-buyer) — the EOA buyer flow
- [Marketplace Seller](/agent-guide/concepts/marketplace-seller) — gating your API
