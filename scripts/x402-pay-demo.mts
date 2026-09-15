/**
 * Pay & call the premium endpoint via x402 (buyer side) — REAL EIP-3009 payment.
 *
 * Shows the full payment evidence trail for demo recording:
 *   USDC balance before → 402 challenge → signed payment → 200 + tx hashes → balance after
 *
 * Env:
 *   DEMO_WALLET_KEY=0x...   (or PRIVATE_KEY) — funded with Base Sepolia USDC
 *   URL=https://agentbadge.xyz  (site to scan)
 *   ENDPOINT=http://localhost:4021  (server URL)
 *   RPC_URL=https://sepolia.base.org  (optional Base Sepolia RPC)
 *
 * Usage:
 *   DEMO_WALLET_KEY=0x... bun run scripts/x402-pay-demo.mts
 */

import { createPublicClient, http, formatUnits, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";

const ENDPOINT = process.env.ENDPOINT ?? "http://localhost:4021";
const SCAN_URL = process.env.URL ?? "https://agentbadge.xyz";
const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";
const DEMO_WALLET_KEY = (process.env.DEMO_WALLET_KEY ?? process.env.PRIVATE_KEY) as `0x${string}` | undefined;

if (!DEMO_WALLET_KEY) {
  console.error("Missing DEMO_WALLET_KEY (or PRIVATE_KEY) env var");
  console.error("Usage: DEMO_WALLET_KEY=0x... bun run scripts/x402-pay-demo.mts");
  process.exit(1);
}

const PREMIUM_URL = `${ENDPOINT}/api/keeperhub/scan/premium`;
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

async function main(): Promise<void> {
  console.log("=== x402 Pay Demo — REAL EIP-3009 payment ===");
  console.log(`Endpoint:  ${PREMIUM_URL}`);
  console.log(`Scan URL:  ${SCAN_URL}`);
  console.log(`Wallet:    ${account.address}`);
  console.log(`Basescan:  https://sepolia.basescan.org/address/${account.address}`);
  console.log();

  // Step 0: USDC balance BEFORE
  const before = await usdcBalance();
  console.log(`[0] USDC balance BEFORE: ${before} USDC`);

  // Step 1: Unpaid request — expect 402 Payment Required
  console.log("\n[1] Sending unpaid request...");
  const res1 = await fetch(PREMIUM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: SCAN_URL }),
  });
  console.log(`  Status: ${res1.status}`);

  if (res1.status !== 402) {
    console.error(`  Expected 402, got ${res1.status}`);
    console.error(`  Body: ${await res1.text()}`);
    process.exit(1);
  }

  const paymentRequired = res1.headers.get("PAYMENT-REQUIRED");
  console.log(`  PAYMENT-REQUIRED: ${paymentRequired ?? "(none)"}`);
  if (!paymentRequired) {
    console.error("  No PAYMENT-REQUIRED header — x402 middleware not wired");
    process.exit(1);
  }

  // Step 2: Pay via real EIP-3009 signature (wrapFetchWithPayment handles 402→sign→retry)
  console.log("\n[2] Paying via x402 (EIP-3009 gasless USDC signature)...");
  const signer = toClientEvmSigner(account, publicClient);
  const client = new x402Client().register("eip155:84532", new ExactEvmScheme(signer));
  const fetchWithPay = wrapFetchWithPayment(fetch, client);

  // Fire the paid request in the background — the premium handler runs the full
  // scan + KeeperHub workflow synchronously (~7min). With paymentFlow:"upfront"
  // the USDC settles on-chain within ~2s, so we prove payment from the chain
  // instead of blocking on the HTTP response.
  const paidRequest = fetchWithPay(PREMIUM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: SCAN_URL }),
    signal: AbortSignal.timeout(900_000),
  }).catch((e) => ({ __error: e } as const));

  // Step 2a: watch the chain — balance delta + settlement tx appear within seconds
  console.log("  Watching chain for settlement (payment settles before the scan runs)...");
  const fromBlock = await publicClient.getBlockNumber();
  let settledTx: string | undefined;
  let after = before;
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    after = await usdcBalance();
    if (Number(after) < Number(before)) {
      // find the USDC Transfer out of our wallet since fromBlock
      const logs = await publicClient.getLogs({
        address: USDC_BASE_SEPOLIA,
        event: parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"])[0],
        args: { from: account.address },
        fromBlock,
      });
      settledTx = logs[logs.length - 1]?.transactionHash;
      break;
    }
  }

  if (Number(after) < Number(before)) {
    console.log(`\n[3] PAYMENT SETTLED ON-CHAIN`);
    console.log(`    USDC balance: ${before} → ${after}  (spent ${(Number(before) - Number(after)).toFixed(6)} USDC)`);
    if (settledTx) {
      console.log(`    Settlement TX: ${settledTx}`);
      console.log(`    Basescan:      https://sepolia.basescan.org/tx/${settledTx}`);
    }
  } else {
    console.log("  (no on-chain debit detected yet — still waiting)");
  }

  // Step 4: await the premium response (scan + KeeperHub recording)
  console.log("\n[4] Waiting for premium scan + KeeperHub recording (runs async, ~few min)...");
  const res2 = await paidRequest;
  if ("__error" in res2) {
    console.error(`  Paid request failed: ${res2.__error instanceof Error ? res2.__error.message : String(res2.__error)}`);
    console.error("  (payment already settled on-chain — see TX above)");
    process.exit(1);
  }

  console.log(`  Status: ${res2.status}`);
  const paymentResponse = res2.headers.get("PAYMENT-RESPONSE");
  if (paymentResponse) {
    try {
      const decoded = JSON.parse(atob(paymentResponse));
      console.log(`  PAYMENT-RESPONSE: ${JSON.stringify(decoded, null, 2)}`);
    } catch {
      console.log(`  PAYMENT-RESPONSE: ${paymentResponse}`);
    }
  }

  const body = await res2.text();
  console.log(`  Body: ${body}`);

  if (res2.status !== 200) {
    console.error(`\n=== FAILED (status ${res2.status}) ===`);
    process.exit(1);
  }

  const result = JSON.parse(body);
  console.log("\n=== SUCCESS ===");
  console.log(`  Mode: ${result.mode}`);
  console.log(`  Execution ID: ${result.executionId}`);
  console.log(`  TX Hashes: ${result.txHashes?.join(", ") ?? "(none)"}`);
  if (result.txHashes?.length > 0) {
    for (const h of result.txHashes as string[]) {
      console.log(`  Basescan: https://sepolia.basescan.org/tx/${h}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
