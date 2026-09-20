/**
 * EPIC-137 live demo — full access-pass cycle on real testnets.
 *
 *   1. Unpaid POST /api/total-scan → 402 + price
 *   2. x402 payment (EIP-3009 USDC, Base Sepolia) → settle → mint on Arc
 *   3. Query AccessPassNFT on Arc Testnet (5042002): tokenId, classMask, expiresAt
 *   4. Signed call (X-Wallet/X-Sig/X-Timestamp, EIP-191 challenge) → 200, no payment
 *
 * Env:
 *   DEMO_WALLET_KEY=0x...  — funded with Base Sepolia USDC (buyer/agent wallet)
 *   ENDPOINT=http://localhost:4021
 *   URL=https://example.com — scan target
 *   PACKS=page-meta-seo — comma-separated bundle ids (default: page-meta-seo)
 *
 * Usage: DEMO_WALLET_KEY=0x... bun run scripts/x402-access-pass-demo.mts
 */

import { createPublicClient, http, formatUnits, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";

const ENDPOINT = process.env.ENDPOINT ?? "http://localhost:4021";
const SCAN_URL = process.env.URL ?? "https://example.com";
const PACKS = (process.env.PACKS ?? "page-meta-seo").split(",");
const BASE_RPC = process.env.RPC_URL ?? "https://sepolia.base.org";
const ARC_RPC = process.env.ARC_RPC_URL ?? "https://rpc.blockdaemon.testnet.arc.network";
const PASS_ADDR = (process.env.ACCESS_PASS_NFT ?? "0x0a6fd3401283b005b9248f5701438e44d23b5445") as `0x${string}`;
const DEMO_WALLET_KEY = (process.env.DEMO_WALLET_KEY ?? process.env.PRIVATE_KEY) as `0x${string}` | undefined;

if (!DEMO_WALLET_KEY) {
  console.error("Missing DEMO_WALLET_KEY env var");
  process.exit(1);
}

const TOTAL_SCAN = `${ENDPOINT}/api/total-scan`;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const account = privateKeyToAccount(DEMO_WALLET_KEY);
const baseClient = createPublicClient({ chain: baseSepolia, transport: http(BASE_RPC) });
const arcClient = createPublicClient({ transport: http(ARC_RPC) });

const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const PASS_ABI = parseAbi([
  "function hasAccess(address w, uint8 cls) view returns (bool)",
  "function passOf(address w, uint8 cls) view returns (uint256)",
  "function classMask(uint256 id) view returns (uint8)",
  "function expiresAt(uint256 id) view returns (uint64)",
]);

const usdcBalance = () =>
  baseClient.readContract({ address: USDC, abi: ERC20, functionName: "balanceOf", args: [account.address] })
    .then((v) => formatUnits(v, 6));

async function arcPassInfo() {
  const out: Record<string, unknown> = {};
  for (const [name, cls] of [["MEDIUM", 1], ["HEAVY", 2], ["FULL", 4]] as const) {
    const id = await arcClient.readContract({ address: PASS_ADDR, abi: PASS_ABI, functionName: "passOf", args: [account.address, cls] });
    if (id > 0n) {
      const mask = await arcClient.readContract({ address: PASS_ADDR, abi: PASS_ABI, functionName: "classMask", args: [id] });
      const exp = await arcClient.readContract({ address: PASS_ADDR, abi: PASS_ABI, functionName: "expiresAt", args: [id] });
      const ok = await arcClient.readContract({ address: PASS_ADDR, abi: PASS_ABI, functionName: "hasAccess", args: [account.address, cls] });
      out[name] = { tokenId: id.toString(), classMask: mask, expiresAt: new Date(Number(exp) * 1000).toISOString(), hasAccess: ok };
    }
  }
  return out;
}

function buildChallenge(ts: number) {
  return [
    "agentbadge-access:v1",
    `wallet:${account.address.toLowerCase()}`,
    "method:POST",
    "path:/api/total-scan",
    `timestamp:${ts}`,
  ].join("\n");
}

async function main() {
  console.log("=== EPIC-137 live demo: x402 pay → mint on Arc → signed call ===");
  console.log(`Endpoint:  ${TOTAL_SCAN}`);
  console.log(`Scan URL:  ${SCAN_URL}  packs: ${PACKS.join(",")}`);
  console.log(`Wallet:    ${account.address}`);
  console.log(`Pass NFT:  ${PASS_ADDR} (Arc Testnet 5042002)`);
  console.log();

  // [0] balances + pass state BEFORE
  const before = await usdcBalance();
  console.log(`[0] USDC on Base Sepolia: ${before}`);
  const passBefore = await arcPassInfo();
  console.log(`[0] Pass on Arc BEFORE: ${Object.keys(passBefore).length ? JSON.stringify(passBefore) : "none"}`);

  // [1] unpaid → 402
  console.log("\n[1] Unpaid request → expect 402");
  const res1 = await fetch(TOTAL_SCAN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: SCAN_URL, packs: PACKS }),
  });
  const body1 = await res1.json().catch(() => ({}));
  console.log(`  Status: ${res1.status}  totalPrice: ${JSON.stringify((body1 as any).totalPrice)}`);
  if (res1.status !== 402) {
    console.error(`  Expected 402, got ${res1.status}: ${JSON.stringify(body1)}`);
    process.exit(1);
  }

  // [2] pay via x402 — fire in background, watch chain for settle + mint
  console.log("\n[2] Paying via x402 (EIP-3009 USDC on Base Sepolia)...");
  const signer = toClientEvmSigner(account, baseClient);
  const client = new x402Client().register("eip155:84532", new ExactEvmScheme(signer));
  const fetchWithPay = wrapFetchWithPayment(fetch, client);
  const paidRequest = fetchWithPay(TOTAL_SCAN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: SCAN_URL, packs: PACKS }),
    signal: AbortSignal.timeout(600_000),
  }).catch((e) => ({ __error: e } as const));

  const fromBlock = await baseClient.getBlockNumber();
  let payTx: string | undefined;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const now = await usdcBalance();
    if (Number(now) < Number(before)) {
      const logs = await baseClient.getLogs({
        address: USDC,
        event: parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"])[0],
        args: { from: account.address },
        fromBlock,
      });
      payTx = logs[logs.length - 1]?.transactionHash;
      console.log(`  Settled! ${before} → ${now} USDC`);
      console.log(`  Payment tx: ${payTx}`);
      console.log(`  https://sepolia.basescan.org/tx/${payTx}`);
      break;
    }
  }
  if (!payTx) {
    console.error("  Payment did not settle within 120s");
    process.exit(1);
  }

  // [3] wait for mint on Arc — poll passOf until nonzero
  console.log("\n[3] Waiting for AccessPassNFT mint on Arc...");
  let pass: Record<string, unknown> = {};
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    pass = await arcPassInfo();
    if (Object.keys(pass).length) break;
  }
  if (!Object.keys(pass).length) {
    console.error("  No pass minted within 90s — check server logs for access-pass-mint");
    process.exit(1);
  }
  console.log(`  Pass minted on Arc: ${JSON.stringify(pass, null, 2)}`);
  console.log(`  https://testnet.arcscan.app/address/${PASS_ADDR}`);

  // [4] signed call — no payment, just the challenge signature
  console.log("\n[4] Signed call (X-Wallet/X-Sig/X-Timestamp) → expect 200, no payment");
  const ts = Math.floor(Date.now() / 1000);
  const sig = await account.signMessage({ message: buildChallenge(ts) });
  const res4 = await fetch(TOTAL_SCAN, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Wallet": account.address,
      "X-Sig": sig,
      "X-Timestamp": String(ts),
    },
    body: JSON.stringify({ url: SCAN_URL, packs: PACKS }),
  });
  console.log(`  Status: ${res4.status}`);
  if (res4.status !== 200) {
    console.error(`  Expected 200, got ${res4.status}: ${await res4.text()}`);
    process.exit(1);
  }
  // read first SSE events then stop — scan continues server-side
  const reader = res4.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (let i = 0; i < 12; i++) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    if (buf.split("\n").filter((l) => l.startsWith("event:")).length >= 4) break;
  }
  await reader.cancel();
  console.log("  First SSE events:");
  for (const line of buf.split("\n").filter((l) => l.startsWith("event:") || l.startsWith("data:")).slice(0, 8)) {
    console.log(`    ${line.slice(0, 140)}`);
  }

  console.log("\n=== DONE: pay → mint on Arc → signed call → 200 ===");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
