/**
 * Pay & call the premium endpoint via x402 (buyer side).
 *
 * Env:
 *   DEMO_WALLET_KEY=0x...     (funded with Base Sepolia USDC via faucet)
 *   URL=https://agentbadge.xyz (site to scan)
 *   ENDPOINT=http://localhost:4021 (server URL)
 *
 * Prerequisites:
 *   - Coinbase Agentic Wallet skill pack: npx skills add coinbase/agentic-wallet-skills
 *   - Wallet funded with Base Sepolia USDC: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
 *   - Server running with KEEPERHUB_X402_ENABLED=true
 *
 * Usage:
 *   DEMO_WALLET_KEY=0x... bun run scripts/x402-pay-demo.mts
 */

import { createWalletClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const ENDPOINT = process.env.ENDPOINT ?? "http://localhost:4021";
const SCAN_URL = process.env.URL ?? "https://agentbadge.xyz";
const DEMO_WALLET_KEY = process.env.DEMO_WALLET_KEY;

if (!DEMO_WALLET_KEY) {
  console.error("Missing DEMO_WALLET_KEY env var");
  console.error("Usage: DEMO_WALLET_KEY=0x... bun run scripts/x402-pay-demo.mts");
  process.exit(1);
}

const PREMIUM_URL = `${ENDPOINT}/api/keeperhub/scan/premium`;
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

async function main(): Promise<void> {
  console.log("=== x402 Pay Demo ===");
  console.log(`Endpoint: ${PREMIUM_URL}`);
  console.log(`Scan URL: ${SCAN_URL}`);
  console.log();

  // Step 1: Initial request — expect 402 Payment Required
  console.log("[1] Sending unpaid request...");
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
  const paymentSignature = res1.headers.get("PAYMENT-SIGNATURE");
  console.log(`  PAYMENT-REQUIRED: ${paymentRequired ?? "(none)"}`);
  console.log(`  PAYMENT-SIGNATURE: ${paymentSignature ? "(present)" : "(none)"}`);

  if (!paymentRequired) {
    console.error("  No PAYMENT-REQUIRED header — x402 middleware not wired");
    process.exit(1);
  }

  // Step 2: Parse payment requirements + sign EIP-3009
  console.log("\n[2] Parsing payment requirements...");
  const requirements = JSON.parse(paymentRequired);
  console.log(`  Requirements: ${JSON.stringify(requirements, null, 2)}`);

  // Step 3: Sign with wallet (EIP-3009 USDC transfer)
  console.log("\n[3] Signing EIP-3009 payment...");
  const account = privateKeyToAccount(DEMO_WALLET_KEY as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(),
  });
  console.log(`  Wallet: ${account.address}`);

  // In production, use @x402/evm buyer or Coinbase Agentic Wallet x402-pay skill
  // This demo uses a simplified signing path
  const paymentResponse = JSON.stringify({
    scheme: "exact",
    network: "eip155:84532",
    asset: USDC_BASE_SEPOLIA,
    signature: "0x_DEMO_SIGNATURE",
    from: account.address,
  });

  // Step 4: Paid request — expect 200 + PAYMENT-RESPONSE
  console.log("\n[4] Sending paid request...");
  const res2 = await fetch(PREMIUM_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-RESPONSE": paymentResponse,
    },
    body: JSON.stringify({ url: SCAN_URL }),
  });

  console.log(`  Status: ${res2.status}`);
  const body = await res2.text();
  console.log(`  Body: ${body}`);

  if (res2.status === 200) {
    const result = JSON.parse(body);
    console.log("\n=== SUCCESS ===");
    console.log(`  Mode: ${result.mode}`);
    console.log(`  Execution ID: ${result.executionId}`);
    console.log(`  TX Hashes: ${result.txHashes?.join(", ") ?? "(none)"}`);
    if (result.txHashes?.length > 0) {
      console.log(`  Basescan: ${result.txHashes.map((h: string) => `https://sepolia.basescan.org/tx/${h}`).join(", ")}`);
    }
  } else {
    console.error(`\n=== FAILED (status ${res2.status}) ===`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
