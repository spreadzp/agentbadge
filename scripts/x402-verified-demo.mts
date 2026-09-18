/**
 * SLICE-129-23: Verified-vs-raw demo — buyer decision log (D23).
 *
 * Fetches both demo endpoints unpaid, decodes the two 402 challenges,
 * compares identity extensions, and prints a readable decision trail
 * for article screenshots. Optionally pays the verified endpoint when
 * DEMO_WALLET_KEY is set (real x402 payment via @x402/fetch).
 *
 * Usage:
 *   bun run scripts/x402-verified-demo.mts                 # compare 402s only
 *   DEMO_WALLET_KEY=0x… bun run scripts/x402-verified-demo.mts  # + pay verified
 *
 * Env:
 *   ENDPOINT=http://localhost:4021   server URL
 *   DEMO_WALLET_KEY=0x…              buyer key (optional — enables payment)
 */

import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

const ENDPOINT = process.env.ENDPOINT ?? "http://localhost:4021";
const VERIFIED = `${ENDPOINT}/api/demo/verified-data`;
const RAW = `${ENDPOINT}/api/demo/raw-data`;

function decode402(res: Response) {
  const h = res.headers.get("PAYMENT-REQUIRED");
  if (!h) return null;
  return JSON.parse(Buffer.from(h, "base64").toString("utf-8"));
}

function line(s = "") {
  console.log(s);
}

async function challenge(url: string, label: string) {
  const res = await fetch(url);
  const pr = decode402(res);
  line(`── ${label}`);
  line(`   GET ${url}`);
  line(`   → ${res.status}`);
  if (!pr) {
    line("   ✗ no PAYMENT-REQUIRED header");
    return null;
  }
  const prices = pr.accepts.map(
    (a: { amount: string; network: string; scheme: string }) =>
      `${a.scheme}@${a.network}=${a.amount}`,
  );
  line(`   accepts: ${pr.accepts.length} option(s)`);
  for (const p of prices) line(`     · ${p}`);
  const ext = pr.extensions?.agentbadge;
  if (ext) {
    line(`   ✓ identity extension (agentbadge):`);
    line(`     passportTokenId: ${ext.passportTokenId}`);
    if (ext.readinessScore !== undefined)
      line(`     readinessScore: ${ext.readinessScore}`);
    if (ext.verifyUrl) line(`     verifyUrl: ${ext.verifyUrl}`);
  } else {
    line(`   ✗ no identity extension — seller unverified`);
  }
  line();
  return pr;
}

line("════════════════════════════════════════════════════════");
line(" x402 verified-seller demo — comparing two paid endpoints");
line("════════════════════════════════════════════════════════");
line();

const v = await challenge(VERIFIED, "VERIFIED seller (/api/demo/verified-data)");
const r = await challenge(RAW, "RAW seller (/api/demo/raw-data)");

line("── DECISION");
const samePrice =
  v && r && JSON.stringify(v.accepts.map((a: { amount: string }) => a.amount).sort()) ===
    JSON.stringify(r.accepts.map((a: { amount: string }) => a.amount).sort());
line(`   identical pricing: ${samePrice ? "yes" : "NO — abort"}`);
const vHasExt = Boolean(v?.extensions?.agentbadge);
const rHasExt = Boolean(r?.extensions?.agentbadge);
line(`   verified has identity ext: ${vHasExt}`);
line(`   raw has identity ext:      ${rHasExt}`);
if (vHasExt && !rHasExt) {
  line(`   → paying VERIFIED endpoint (trust signal present)`);
} else {
  line(`   → cannot distinguish sellers — aborting`);
  process.exit(1);
}
line();

const key = process.env.DEMO_WALLET_KEY as `0x${string}` | undefined;
if (!key) {
  line("── PAYMENT SKIPPED (set DEMO_WALLET_KEY to pay for real)");
  process.exit(0);
}

line("── PAYING verified endpoint");
const account = privateKeyToAccount(key);
const signer = toClientEvmSigner(
  account,
  createPublicClient({ chain: baseSepolia, transport: http() }),
);
const client = new x402Client().register(
  "eip155:*",
  new ExactEvmScheme(signer),
);
const paidFetch = wrapFetchWithPayment(fetch, client);
const res = await paidFetch(VERIFIED);
line(`   → ${res.status}`);
if (res.ok) {
  const body = await res.json();
  line(`   data: ${JSON.stringify(body)}`);
  const settle = res.headers.get("PAYMENT-RESPONSE");
  if (settle) {
    line(`   settlement: ${Buffer.from(settle, "base64").toString("utf-8")}`);
  }
  line();
  line("✓ demo complete — paid verified seller");
} else {
  line(`   ✗ payment failed: ${await res.text()}`);
  process.exit(1);
}
