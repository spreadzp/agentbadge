# Arc Mainnet — live transaction links (SLICE-151-6, 2026-09-30)

Chain: **Arc Mainnet** `eip155:5042` · Explorer: https://explorer.arc.io ·
RPC: `https://rpc.blockdaemon.mainnet.arc.io` (official geo-blocked).

Smoke report: `artifacts/smoke-report-arc-mainnet-1790755225476.json` — all 6 phases green.

## Deploys (SLICE-151-4/5)

| Contract | Address | Deploy tx |
| -------- | ------- | --------- |
| ACPCore (ERC-8183) | `0x680C35daCfaB41688E243c566632e92d266189bf` | — (SLICE-151-4 ledger) |
| AgentEventLog | `0x1bb6A87D18cbd4285b4d383F88f10a1Ed01B4700` | https://explorer.arc.io/tx/0x2dc4d3d7807afc37b09dd5da6f14cd9b73643799fd7ad83493eb1a9cfeebf036 |
| AgentPassportNFT (ABP) | `0xd226824e66e6aac7104579840506e268886a8169` | https://explorer.arc.io/tx/0x84a2efe8b1b1f6d9e0cd97d4696b7ca44a610edb042dc138f0690f716731e247 |
| AccessPassNFT (ABAP) | `0x68ca4d1a9ff24f86328f2fb3a30d81e503d367f5` | https://explorer.arc.io/tx/0xdc22b57ebb1e186fbe26456353432034a7b1e7b5d037bb87400e5613b14eec70 |

Ledger of record: `contracts/deployments/arc-mainnet.json`.

## Smoke run — `arc-smoke.ts --network arc-mainnet`

### x402 self-settle (EIP-3009)
- 0.01 USDC client→operator: https://explorer.arc.io/tx/0x9634e0fe2e3d0be9cba620b381e423360d0c5ef2c1cc0c33975bc3c314cacf05

### ERC-8183 job cycle (jobId=2 → Completed)
- evaluator gas top-up: https://explorer.arc.io/tx/0x28c0fa5c2a370a239c9eb7f8e606589792b18d526d01e0ed5346083d62853cf2
- createJob: https://explorer.arc.io/tx/0x9b398e8675e824fcca5e0a57ae99533209b085579001b14d2e394f7d6e732a79
- setBudget: https://explorer.arc.io/tx/0x6dc29469ee03a0a4619d4116a71513f1588a7e979881d662b1a67d66818131d0
- approve (USDC): https://explorer.arc.io/tx/0xb745a8f167d8511237be0421d3f1941eaf41288efe474036276b5446ad55e0b1
- fund: https://explorer.arc.io/tx/0xd0ddfae734f9ce27338b16fe70d6cf1ce88d0c11756a01cb58873fe141a17026
- submit: https://explorer.arc.io/tx/0xdad74cfb1c1eb3249dcfb333aeffb676c6d09a2ff1c2e072f03ac2dc62470b81
- complete (evaluator verdict=approve, escrow released): https://explorer.arc.io/tx/0xecfbdec88f951633368f5ac289ef69be6c4df4cba9495eeab292cfe3e503dd51

### ERC-8004 feedback
- registerMirror agentId=346: https://explorer.arc.io/tx/0x833dcd488326ef255d6ab8d6bf617cb7870df90a2a31f07156d9b92c2e205799
- giveFeedback score=90 tag1=job-2: https://explorer.arc.io/tx/0x53bc4420e941f498ed8230cb1b4d90a9d8f51c8dfb55ab26452b38f7d9ef7b3f

### Memo
- BeforeMemo memoIndex=634: https://explorer.arc.io/tx/0x69a728c4270e821526a59c26517fbda33640333bf3c3952a9a76d6250811c9ee

### Provider gate
- `ownerOf(346)` = operator ✓ · `ownerOf(bogus)` reverts ✓ (read-only, no tx)

## Live attestation (agentbadge.xyz → mainnet)

`POST /api/attestations { "url": "https://agentbadge.xyz" }` → score 68.4 "needs-work",
agentId=346, network `eip155:5042`. Visible on https://agentbadge.xyz/attestations.

- giveFeedback (evaluator EOA 0xEAF8…2ba2): https://explorer.arc.io/tx/0x459315bc7ac7bb4efd9553b8f645b8d717b6f44eaac083ba3ce1a7e49cae44f7
- memo (reportHash + ASCII summary): https://explorer.arc.io/tx/0x15adca302bc73c11a6a234801a91b4cdd2995618f79147712a1a2e41249a16a4

## Spend log (budget ≤ $1)

| Item | USDC |
| ---- | ---- |
| client funding (0xB42f…23b0) | 0.50 |
| evaluator top-up, smoke (0xb4d4…692B) | 0.30 |
| evaluator top-up, attestation EOA (0xEAF8…2ba2) | 0.15 |
| gas consumed (13 txs, ~0.01–0.015 each) | ~0.15 |
| **Total allocated** | **~1.10** (residual balances remain in wallets — reusable) |

Net consumed ≈ gas only (~0.15); the rest is working balance retained by client/evaluator wallets.

## Code changes this run required

- `src/escrow/erc8183.ts` — dual-ABI: `ERC8183_ACP_ABI` + `variant: "circle"|"acp"` on
  `Erc8183Config`. ACPCore (our deploy) differs from Circle's testnet impl:
  `fund(jobId, expectedBudget, optParams)`, `submit/complete/reject` take `bytes`,
  `getJob` returns bare `Job` struct (no id/description, has token), `JobCreated`
  indexes `evaluator` not `provider`. `extractJobId` now tries both event ABIs.
- `scripts/arc-smoke.ts` — `erc8183Variant` per network ("acp" mainnet / "circle" testnet).
- `hackathon/server` — `routes/index.ts`: attestation wiring honors `ARC_MAINNET_ENABLED`
  (chain, rpc, registries, explorer switch together); `arc-attestation.ts`: score rounded
  to int for `int256` feedback (scanner can return fractional scores).
- `@agentbadge/circle-payments` published as **0.1.7** (needed by server for
  `ARC_MAINNET`/`ARC_MAINNET_CONTRACTS` exports).

## x402 payments live-verified (SLICE-151-7, 2026-09-30)

MarketplacePassNFT (bstock ServicePass registry):
`0xf8756ce4400c76f1c31b72216c391e1c46cc2c03` —
deploy https://explorer.arc.io/tx/0x1253d6a97bb85515e33dff03d2a10e4ecbee65137bcaf708ece76b9a5e3eb97f

On-chain setup: seller passport #1 minted to operator
`0xcdd23d104AA4C10DE65F4DD0571eDfeC0458699d`; service
`bstock-delta-realtime` registered — `serviceIdFor(1, "bstock-delta-realtime")`
= `0x2ef7218adb1efdf4768114dc3be8cc985fe1bff5bb97d26f594a5de1b400ffff`
(passportId=1, price=$5, active=true).

### x402 self-settle payments (eip3009-client-broadcast, eip155:5042)

| Flow | Amount | Payer → payTo | Tx |
| ---- | ------ | ------------- | -- |
| attestation `POST /api/attestations` | $0.25 | operator → treasury `0x9a66…95A5` | https://explorer.arc.io/tx/0xc384421cca2cc3e83454145ecd3969e44ee37b78b4bbaf56a204591ac31f1fa1 |
| bstock `/mcp/bstock/tools` | $0.05 (test price; prod $5) | operator → treasury | https://explorer.arc.io/tx/0x463207d0bf2b548df129b58febd792f9323eacf446fcb26e8fe3f0c9f9c79e2f |

Verified end-to-end:
- attestation: `PAYMENT-REQUIRED` 402 → EIP-3009 tx → `PAYMENT-SIGNATURE` →
  verify+settle → 200 + `PAYMENT-RESPONSE`; replay of same txHash → 402.
- bstock: bearer-auth + free tier → 402 (eip155:5042, eip3009-client-broadcast)
  → paid request → 200 + `PAYMENT-RESPONSE`; `mintServicePass` minted pass to
  payer — `hasAccess(0xcdd2…8699d, 0x2ef7218adb1e…) = true` on-chain.

Known gotcha fixed: mint failures in `bstock-freemium` were silently swallowed —
now `logger.error` on catch (an `UnknownService` revert from a stale serviceId
was only diagnosable by replaying the contract call manually).

## Production verification (agentbadge.xyz, Fly.io — 2026-09-30)

Deployed with `BSTOCK_ARC_NETWORK=eip155:5042`, `BSTOCK_NFT=0xf875…2c03`,
`ATTESTATION_X402_ENABLED=true`, `ARC_MAINNET_ENABLED=true`.

- `POST /api/attestations` → req1 200 (free tier) / req2 **402**
  (eip155:5042, $0.25, payTo treasury). Free request wrote on-chain:
  feedbackTx `0xd25ee6371ebb3846ff29b5d61435f15bb6469af739f7bdcc8799e0fb9f6c6796`
  + memoTx `0xcff94a6ae8af3938c934a704646ae64ac504b0e57b74b67fa31e38205188ad5c`
  — https://explorer.arc.io/tx/0xd25ee6371ebb3846ff29b5d61435f15bb6469af739f7bdcc8799e0fb9f6c6796
- `GET /mcp/bstock/tools` → 401 no-token / 200 free / **402**
  (eip155:5042, $5, payTo treasury)
- Rollout incident: `CACHE_URL=valkey://localhost` leaked to prod via secrets
  push → `cache.incr` fail-open → free tier never 402'd. Fixed via
  `flyctl secrets unset CACHE_ENABLED CACHE_BACKEND CACHE_URL` → in-memory
  buckets on single machine.
