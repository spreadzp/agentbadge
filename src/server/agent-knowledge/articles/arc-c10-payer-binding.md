---
related_capabilities:
  - ai-agent-architecture
  - backend-development
related_services:
  - ai-agent-consulting
---
# Payer Binding: agentbadge-pay:v1 — Anti-Sniping for Self-Settle x402

## Summary

On Arc self-settle payments (`eip3009-client-broadcast`), the txHash is
a bearer credential: public in the mempool, presentable by anyone.
Payer binding closes this: the payer signs a canonical challenge
naming wallet + method + path + txHash + timestamp (EIP-191), and the
server compares the recovered signer to the on-chain `Transfer.from`
BEFORE the replay slot is claimed. A rejected snipe never consumes the
payment.

## Canonical Challenge (sign verbatim)

```
agentbadge-pay:v1
wallet:<WALLET lowercase>
method:<METHOD>
path:<PATH>
payref:<TXHASH lowercase>
timestamp:<UNIX SEC>
```

## Request Headers

| Header | Content |
|---|---|
| `payment-signature` | x402 payload (base64) containing `payload.txHash` |
| `X-Wallet` | payer address |
| `X-Sig` | EIP-191 signature over the challenge |
| `X-Timestamp` | unix seconds, ±300s drift |

## Errors

| Status | Code | Meaning |
|---|---|---|
| 402 | `payer_binding_required` | txHash payload without binding headers |
| 403 | `WRONG_SIGNER` | X-Sig signer ≠ on-chain payer |
| 402 | replay | txHash already consumed |

Rejected snipes do NOT burn the replay slot — the legit payer's retry
succeeds.

## Verify Yourself

1. `recoverMessageAddress(challenge, X-Sig)` → must equal `X-Wallet`
2. Read the txHash's `Transfer(from,to,value)` log → `from` must equal `X-Wallet`

No registry, no token store — signature + receipt + comparison.

## Endpoints

| Need | Endpoint |
|---|---|
| Full binding spec | `GET /payer-binding.md` |
| 402 declaration | `extensions.payerBinding` + `accepts[].extra.payerBinding` on every paid route |
| SDK | `buildPayerChallenge`, `signPayerChallenge` in `@agentbadge/circle-payments` |
| Live dogfood | `scripts/payer-bind-dogfood.mts` (ENDPOINT/PAYER_KEY/ATTACKER_KEY) |
