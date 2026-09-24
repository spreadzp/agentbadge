/**
 * SLICE-136-2: paid call to POST /api/total-scan on prod — verifies the full
 * x402 pipeline: 402 → EIP-3009 sign → settle on Base Sepolia → response
 * headers (PAYMENT-RESPONSE, EXTENSION-RESPONSES with bazaar.status).
 *
 * Env:
 *   DEMO_WALLET_KEY=0x...  — funded with Base Sepolia USDC (from .env)
 *   ENDPOINT=https://agentbadge.xyz  (default prod)
 *   SCAN_URL=https://agentbadge.xyz  (target site to scan)
 *   PACKS=discovery-crawling         (optional, comma-separated — cheaper)
 *
 * Usage:
 *   set -a; source .env; set +a; bun run scripts/x402-total-scan-settle.mts
 */

import { createPublicClient, http, formatUnits, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";

const ENDPOINT = process.env.ENDPOINT ?? "https://agentbadge.xyz";
const SCAN_URL = process.env.SCAN_URL ?? "https://agentbadge.xyz";
const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";
const PACKS = process.env.PACKS?.split(",").map((s) => s.trim()).filter(Boolean);
const DEMO_WALLET_KEY = (process.env.DEMO_WALLET_KEY ?? process.env.PRIVATE_KEY) as `0x${string}` | undefined;
if (!DEMO_WALLET_KEY) {
  console.error("Missing DEMO_WALLET_KEY (or PRIVATE_KEY) env var");
  process.exit(1);
}

const SCAN_ENDPOINT = `${ENDPOINT}/api/total-scan`;
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const ERC20_BALANCE_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);
const account = privateKeyToAccount(DEMO_WALLET_KEY);
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });

async function usdcBalance(): Promise<string> {
  const raw = await publicClient.readContract({
    address: USDC_BASE_SEPOLIA,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });
  return formatUnits(raw, 6);
}

function decodeB64(h: string | null): unknown {
  if (!h) return null;
  try { return JSON.parse(Buffer.from(h, "base64").toString()); } catch { return h; }
}

async function main(): Promise<void> {
  console.log("=== SLICE-136-2: paid /api/total-scan on prod ===");
  console.log(`Endpoint: ${SCAN_ENDPOINT}`);
  console.log(`Scan URL: ${SCAN_URL}`);
  console.log(`Packs:    ${PACKS?.join(",") ?? "(none — full scan $4.50)"}`);
  console.log(`Wallet:   ${account.address}\n`);

  const before = await usdcBalance();
  console.log(`[0] USDC balance BEFORE: ${before}`);

  // Step 1: unpaid → 402 + inspect payment-required payload
  const body = JSON.stringify(PACKS?.length ? { url: SCAN_URL, packs: PACKS } : { url: SCAN_URL });
  const res1 = await fetch(SCAN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  console.log(`\n[1] Unpaid → ${res1.status}`);
  if (res1.status !== 402) {
    console.error(`  Expected 402, body: ${await res1.text()}`);
    process.exit(1);
  }
  const pr = decodeB64(res1.headers.get("payment-required")) as {
    accepts?: { amount: string; payTo: string }[];
    extensions?: Record<string, unknown>;
  } | null;
  console.log(`  accepts[0].amount: ${pr?.accepts?.[0]?.amount} (atomic USDC)`);
  console.log(`  accepts[0].payTo:  ${pr?.accepts?.[0]?.payTo}`);
  console.log(`  extensions keys:   ${Object.keys(pr?.extensions ?? {}).join(",")}`);

  // Step 2: paid request — read headers as soon as response starts
  console.log("\n[2] Paying via x402 (EIP-3009)...");
  const signer = toClientEvmSigner(account, publicClient);
  const client = new x402Client().register("eip155:84532", new ExactEvmScheme(signer));
  const fetchWithPay = wrapFetchWithPayment(fetch, client);

  const res2 = await fetchWithPay(SCAN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(120_000),
  });

  console.log(`\n[3] Paid response: ${res2.status}`);
  const paymentResponse = decodeB64(res2.headers.get("payment-response"));
  const extensionResponses = decodeB64(res2.headers.get("extension-responses"));
  console.log("  PAYMENT-RESPONSE:", JSON.stringify(paymentResponse, null, 2)?.slice(0, 1200));
  console.log("  EXTENSION-RESPONSES:", JSON.stringify(extensionResponses, null, 2)?.slice(0, 2000));

  // Don't consume the whole SSE stream — first bytes are enough for proof
  const reader = res2.body?.getReader();
  if (reader) {
    const { value } = await reader.read();
    console.log(`\n[4] First SSE chunk: ${new TextDecoder().decode(value).slice(0, 300)}`);
    await reader.cancel();
  }

  const after = await usdcBalance();
  console.log(`\n[5] USDC balance: ${before} → ${after} (spent ${(Number(before) - Number(after)).toFixed(6)})`);
}

main().catch((e) => {
  console.error("Fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
