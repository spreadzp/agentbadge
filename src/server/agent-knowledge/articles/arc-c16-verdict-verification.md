---
related_capabilities:
  - ai-agent-architecture
  - backend-development
related_services:
  - ai-agent-consulting
---
# Public Verdict Verification: Check the Chain, Not the Issuer

## Summary

Every verdict AgentBadge signs is independently verifiable — the check does not trust the issuer. Level-1 is a public facade: `GET /api/verify/:verdictId` (no auth) returns the artifact, `reason_codes`, memo anchor `{status, memoId, txHash?, blockNumber?}`, hash-chain status with `head_ref`, and the `proof_kinds` registry; `?kind=verdict|anchor-head|witness` narrows to one layer, unknown kinds → `400 unknown_proof_kind`. Level-2 is `npx @agentbadge/verify-verdict` — a standalone package that re-checks memo anchors and epoch head anchors from RPC only, plus a local chain-recompute fold. The paid response carries an inline receipt `verify:{api,page,memoId}` — memo id is deterministic before the anchor lands.

## Contract

- Anchor namespaces: verdict anchor `memoIdFor("eaas", verdictId)` → `artifactHash` (keccak256 canonical JSON); head anchor `memoIdFor("chain", "eaas-verdicts", epochSeq)` → `abiEncode(headHash, count, prevAnchoredHeadHash)`.
- Memo contract (Arc mainnet + testnet): `0x5294E9927c3306DcBaDb03fe70b92e01cCede505`.
- `proofs[]` per run: `verdict`, `anchor-tx`, `anchor-head`, `chain-recompute` (`firstBrokenSeq` on tamper); `valid` iff all executed proofs `ok`.
- Honest statuses: unanchored = `pending`, never `valid`; RPC failure → `VerifyError("rpc_unavailable")`; malformed input → `invalid_input`. CLI exit `0` valid / `1` invalid-or-error.
- `PROOF_KINDS_V1` registry: `{verdict, witness, anchor-head}` × `{memoFormat, verifierRule, specVersion}`; `witness` declared but `implemented:false` (feature-detect).

## Endpoints

| Need | Endpoint |
|------|----------|
| Verdict verify facade | `GET /api/verify/:verdictId` (optional `?kind=`) |
| Human SSR page | `GET /verify` (`?q=` or `/:id`; verdict id \| txHash \| memoId) |
| Paid verdict issue (inline receipt in response) | `POST /api/eaas/verdicts` → `verify:{api,page,memoId}` |
| Error catalog (verdict_not_found, unknown_proof_kind, rpc_unavailable) | `GET /api/meta/error-catalog` |

## Verify It

```bash
npx @agentbadge/verify-verdict <verdictId|txHash> \
  --artifact verdict.json --entries chain.json \
  --rpc $VERIFY_RPC_URL
# exit 0 — all proofs ok; exit 1 — invalid/unanchored/typed error
```

Level-1 cross-check: `curl https://agentbadge.xyz/api/verify/<verdictId>` — compare `anchor.memoId` and `chain.head_ref.headHash` against the package output.

## Links

- Blog article: https://agentbadge.xyz/blog/arc-c16-verdict-verification
- Package: https://www.npmjs.com/package/@agentbadge/verify-verdict
- Verify page: https://agentbadge.xyz/verify
