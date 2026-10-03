/**
 * SLICE-155-9: x402 client paying via Arc self-settle with x-wallet
 * attribution — drives the agent-wallet envelope end-to-end on a live
 * server (localhost:4021 or any ENDPOINT).
 *
 * Flow:
 *   1. POST unpaid → 402 + payment-required (accepts[])
 *   2. pick `eip3009-client-broadcast` on eip155:5042002
 *   3. EIP-712 sign TransferWithAuthorization (USDC domain on Arc)
 *   4. broadcast transferWithAuthorization on Arc testnet → txHash
 *   5. retry POST with PAYMENT-SIGNATURE={payload:{txHash}} + x-wallet
 *   6. print status / ledger-relevant bits; non-zero exit on failure
 *
 * Env:
 *   AGENT_WALLET_KEY=0x...  — payer key (funded USDC on Arc testnet)
 *   ENDPOINT=http://localhost:4021
 *   PAY_URL=/api/eaas/verdicts   — gated endpoint to pay for
 *   BODY={"policy":"deliverable-present","deliverable":{"data":{"ok":1}}}
 *   ARC_RPC=https://rpc.blockdaemon.testnet.arc.network
 *
 * Usage:
 *   AGENT_WALLET_KEY=0x... bun run scripts/agent-wallet-x402-pay.mts
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  encodeAbiParameters,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ENDPOINT = process.env.ENDPOINT ?? "http://localhost:4021";
const PAY_URL = process.env.PAY_URL ?? "/api/eaas/verdicts";
const ARC_RPC =
  process.env.ARC_RPC ?? "https://rpc.blockdaemon.testnet.arc.network";
const BODY =
  process.env.BODY ??
  '{"policy":"deliverable-present","deliverable":{"data":{"ok":1}}}';
const AGENT_WALLET_KEY = process.env.AGENT_WALLET_KEY as
  | `0x${string}`
  | undefined;

if (!AGENT_WALLET_KEY) {
  console.error("Missing AGENT_WALLET_KEY env var");
  process.exit(1);
}

const ARC_TESTNET = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
} as const;

const account = privateKeyToAccount(AGENT_WALLET_KEY);
const publicClient = createPublicClient({
  chain: ARC_TESTNET,
  transport: http(ARC_RPC),
});
const walletClient = createWalletClient({
  account,
  chain: ARC_TESTNET,
  transport: http(ARC_RPC),
});

const TWA_ABI = [
  {
    name: "transferWithAuthorization",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

interface AcceptEntry {
  scheme: string;
  network: string;
  asset: `0x${string}`;
  amount: string;
  payTo: `0x${string}`;
  maxTimeoutSeconds?: number;
  extra?: { name?: string; version?: string };
}

function decodeB64(h: string | null): unknown {
  if (!h) return null;
  try {
    return JSON.parse(Buffer.from(h, "base64").toString());
  } catch {
    return h;
  }
}

async function post(paymentSignature?: string): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-wallet": account.address,
  };
  if (paymentSignature) headers["payment-signature"] = paymentSignature;
  return fetch(`${ENDPOINT}${PAY_URL}`, {
    method: "POST",
    headers,
    body: BODY,
  });
}

async function main(): Promise<void> {
  console.log("=== agent-wallet x402 pay (arc self-settle) ===");
  console.log(`Endpoint: ${ENDPOINT}${PAY_URL}`);
  console.log(`Payer (x-wallet): ${account.address}`);

  // [1] unpaid → 402 + requirements
  const res1 = await post();
  if (res1.status !== 402) {
    console.error(`expected 402, got ${res1.status}`);
    console.error(await res1.text());
    process.exit(1);
  }
  const pr = decodeB64(res1.headers.get("payment-required")) as {
    accepts?: AcceptEntry[];
  } | null;
  const accepts = pr?.accepts ?? [];
  const arc = accepts.find(
    (a) =>
      a.scheme === "eip3009-client-broadcast" &&
      a.network === "eip155:5042002",
  );
  if (!arc) {
    console.error(
      "no eip3009-client-broadcast accept on eip155:5042002; got:",
      accepts.map((a) => `${a.scheme}@${a.network}`).join(", "),
    );
    process.exit(1);
  }
  const amountUsd = Number(arc.amount) / 1e6;
  console.log(
    `[1] 402 → price $${amountUsd} → payTo ${arc.payTo} asset ${arc.asset}`,
  );

  // [2] sign EIP-3009 authorization
  const nonce = keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [account.address, BigInt(Date.now()), BigInt(arc.amount)],
    ),
  );
  const now = Math.floor(Date.now() / 1000);
  const validBefore = BigInt(now + (arc.maxTimeoutSeconds ?? 300));
  const authorization = {
    from: account.address,
    to: arc.payTo,
    value: BigInt(arc.amount),
    validAfter: 0n,
    validBefore,
    nonce,
  };
  const signature = await account.signTypedData({
    domain: {
      name: arc.extra?.name ?? "USDC",
      version: arc.extra?.version ?? "2",
      chainId: ARC_TESTNET.id,
      verifyingContract: arc.asset,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: authorization,
  });
  console.log("[2] EIP-3009 signed");

  // [3] broadcast transferWithAuthorization ourselves (self-settle)
  const txHash = await walletClient.writeContract({
    address: arc.asset,
    abi: TWA_ABI,
    functionName: "transferWithAuthorization",
    args: [
      authorization.from,
      authorization.to,
      authorization.value,
      authorization.validAfter,
      authorization.validBefore,
      authorization.nonce,
      signature as Hex,
    ],
  });
  console.log(`[3] broadcast txHash: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  if (receipt.status !== "success") {
    console.error(`tx reverted: ${txHash}`);
    process.exit(1);
  }
  console.log(`    status: success (block ${receipt.blockNumber})`);

  // [4] retry with txHash as payment proof + x-wallet attribution
  const paymentPayload = {
    x402Version: 2,
    scheme: arc.scheme,
    network: arc.network,
    accepted: arc,
    payload: { txHash },
  };
  const res2 = await post(
    Buffer.from(JSON.stringify(paymentPayload)).toString("base64"),
  );
  const bodyText = await res2.text();
  console.log(`\n[4] paid response: ${res2.status}`);
  console.log(`    ${bodyText.slice(0, 600)}`);

  const settle = decodeB64(res2.headers.get("payment-response")) as
    | { transaction?: string; payer?: string }
    | null;
  if (settle?.transaction) {
    console.log(`    settled tx: ${settle.transaction}`);
  }

  if (res2.status === 402) {
    // spend_cap deny — exit 0, it's a *successful evidence capture*
    console.log(
      "\n✓ envelope deny captured (402 spend_cap — check audit feed)",
    );
    return;
  }
  if (!res2.ok) {
    console.error(`\n✗ unexpected status ${res2.status}`);
    process.exit(1);
  }
  console.log("\n✓ settled — ledger entry should carry txHash");
}

main().catch((e) => {
  console.error("Fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
