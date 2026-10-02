/**
 * SLICE-154-7: minimal EaaS client — the 10-minute DX demo.
 *
 *   requestVerdict()  — POST /api/eaas/verdicts with x402 auto-pay
 *   verifyArtifact()  — OFFLINE EIP-712 verify: no server trust needed
 *
 * Usage:
 *   EAAS_WALLET_KEY=0x... bun run examples/eaas-client.ts \
 *     --endpoint http://localhost:4021 --policy deliverable-present
 */
import { verifyTypedData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";

/** Mirrors lib/eaas/verdict.ts — kept local so this file is self-contained. */
const VERDICT_DOMAIN = {
  name: "AgentBadgeVerdict",
  version: "1",
  verifyingContract: "0x0000000000000000000000000000000000000000" as Hex,
};
const VERDICT_TYPES = {
  VerdictArtifact: [
    { name: "verdictId", type: "bytes32" },
    { name: "kind", type: "string" },
    { name: "policy", type: "string" },
    { name: "deliverableHash", type: "bytes32" },
    { name: "reason", type: "string" },
    { name: "reasonHash", type: "bytes32" },
    { name: "evidenceHash", type: "bytes32" },
    { name: "evaluator", type: "address" },
    { name: "issuedAt", type: "string" },
    { name: "chainId", type: "uint256" },
  ],
} as const;

export interface VerdictArtifact {
  verdictId: Hex; kind: string; policy: string; deliverableHash: Hex;
  reason: string; reasonHash: Hex; evidenceHash: Hex; evaluator: Hex;
  chainId: number; issuedAt: string; signature: Hex;
}

export async function requestVerdict(opts: {
  endpoint: string;
  policy: string;
  deliverable?: unknown;         // inline data OR deliverableUri (scan)
  deliverableUri?: string;
  expectedHash?: Hex;
  walletKey?: `0x${string}`;     // pays via x402; omit → 402 response body
  payChain?: `${string}:${string}`; // x402 rail (default Base Sepolia)
  fetchFn?: typeof fetch;
}): Promise<{ artifact?: VerdictArtifact; status: number; body: unknown }> {
  const doFetch = opts.walletKey && !opts.fetchFn
    ? wrapFetchWithPayment(
        fetch,
        new x402Client().register(
          opts.payChain ?? "eip155:84532",
          new ExactEvmScheme(toClientEvmSigner(privateKeyToAccount(opts.walletKey))),
        ),
      )
    : (opts.fetchFn ?? fetch);
  const res = await doFetch(`${opts.endpoint}/api/eaas/verdicts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      policy: opts.policy,
      ...(opts.deliverable !== undefined
        ? { deliverable: { data: opts.deliverable } }
        : { deliverable: { uri: opts.deliverableUri } }),
      ...(opts.expectedHash ? { expectedHash: opts.expectedHash } : {}),
    }),
  });
  const body = (await res.json()) as { artifact?: VerdictArtifact };
  return { artifact: body.artifact, status: res.status, body };
}

/** Offline EIP-712 recover — true iff signature matches artifact.evaluator. */
export async function verifyArtifact(a: VerdictArtifact): Promise<boolean> {
  return verifyTypedData({
    address: a.evaluator,
    domain: { ...VERDICT_DOMAIN, chainId: a.chainId },
    types: VERDICT_TYPES,
    primaryType: "VerdictArtifact",
    message: {
      verdictId: a.verdictId, kind: a.kind, policy: a.policy,
      deliverableHash: a.deliverableHash, reason: a.reason,
      reasonHash: a.reasonHash, evidenceHash: a.evidenceHash,
      evaluator: a.evaluator, issuedAt: a.issuedAt,
      chainId: BigInt(a.chainId),
    },
    signature: a.signature,
  });
}

/* ------------------------------ demo CLI ------------------------------- */
if (import.meta.main) {
  const arg = (n: string) => process.argv[process.argv.indexOf(n) + 1];
  const endpoint = arg("--endpoint") ?? "http://localhost:4021";
  const policy = arg("--policy") ?? "deliverable-present";
  const res = await requestVerdict({
    endpoint,
    policy,
    ...(arg("--scan-url") ? { deliverableUri: arg("--scan-url") } : {}),
    ...(policy !== "readiness-scan"
      ? { deliverable: { demo: "eaas-client", ts: Date.now() } }
      : {}),
    ...(process.env.EAAS_WALLET_KEY
      ? { walletKey: process.env.EAAS_WALLET_KEY as `0x${string}` }
      : {}),
  });
  console.log("→", res.status, JSON.stringify(res.body, null, 2).slice(0, 800));
  if (res.artifact) {
    console.log(
      `\nOffline verify: ${(await verifyArtifact(res.artifact)) ? "VALID ✓" : "INVALID ✗"}`,
    );
    console.log(`Verify URL: ${endpoint}/api/eaas/verdicts/${res.artifact.verdictId}/verify`);
  }
}
