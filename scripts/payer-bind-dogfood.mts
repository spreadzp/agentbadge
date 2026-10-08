#!/usr/bin/env bun
/**
 * SLICE-171-6: payer-bind dogfood — live snipe test on a paid route.
 *
 * Flow (real chain, real server):
 *   1. probe PAY_URL → 402 → pick the arc self-settle accepts entry
 *   2. victim broadcasts USDC `transfer` to payTo on Arc → txHash
 *      (any client-broadcast method emitting Transfer(to=payTo) works)
 *   3. ATTACKER crafts payment-signature with the VICTIM's txHash +
 *      attacker's own X-Sig → expect 403, replay slot stays intact
 *   4. VICTIM sends the correctly-bound request → expect 200 + content
 *   5. VICTIM retries the same txHash → expect 402 replay
 *
 * Env:
 *   ENDPOINT     — server base URL (default http://localhost:4021)
 *   PAYER_KEY    — 0x-privkey, the buyer (needs Arc USDC + gas)
 *   ATTACKER_KEY — 0x-privkey, the sniper (no funds needed)
 *   PAY_URL      — paid route (default /api/keeperhub/scan/premium)
 *   PAY_METHOD   — HTTP method (default POST)
 *   PAY_BODY     — JSON body (default {"url":"https://agentbadge.xyz"})
 *   ARC_RPC_URL  — override (default ARC_TESTNET.rpcUrl)
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ARC_TESTNET,
  buildPayerChallenge,
} from "@agentbadge/circle-payments";

const ENDPOINT = process.env.ENDPOINT ?? "http://localhost:4021";
const PAY_URL = process.env.PAY_URL ?? "/api/keeperhub/scan/premium";
const METHOD = (process.env.PAY_METHOD ?? "POST").toUpperCase();
const BODY = process.env.PAY_BODY ?? '{"url":"https://agentbadge.xyz"}';
const RPC = process.env.ARC_RPC_URL ?? ARC_TESTNET.rpcUrl;
const PATH = PAY_URL.split("?")[0];

const payerKey = process.env.PAYER_KEY as `0x${string}` | undefined;
const attackerKey = process.env.ATTACKER_KEY as `0x${string}` | undefined;
if (!payerKey || !attackerKey) {
  console.error("PAYER_KEY and ATTACKER_KEY are required (0x-prefixed)");
  process.exit(1);
}
const victim = privateKeyToAccount(payerKey);
const attacker = privateKeyToAccount(attackerKey);

const chain = defineChain({
  id: ARC_TESTNET.chainId,
  name: ARC_TESTNET.name,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const publicClient = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({
  account: victim,
  chain,
  transport: http(RPC),
});

const USDC_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const fail = (msg: string): never => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const ok = (msg: string) => console.log(`✓ ${msg}`);

async function boundHeaders(
  signer: typeof victim,
  paymentB64: string,
  txHash: string,
): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signer.signMessage({
    message: buildPayerChallenge({
      wallet: signer.address,
      method: METHOD,
      path: PATH,
      payRef: txHash,
      timestamp,
    }),
  });
  return {
    "content-type": "application/json",
    "payment-signature": paymentB64,
    "x-wallet": signer.address,
    "x-sig": signature,
    "x-timestamp": String(timestamp),
  };
}

async function hit(
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const res = await fetch(ENDPOINT + PAY_URL, {
    method: METHOD,
    headers,
    ...(METHOD !== "GET" ? { body: BODY } : {}),
  });
  return { status: res.status, body: await res.text() };
}

// ── 1. probe → pick the arc self-settle accepts entry ──────────────────
console.log(`=== payer-bind dogfood @ ${ENDPOINT}${PAY_URL} ===`);
const probe = await hit({ "content-type": "application/json" });
if (probe.status !== 402) fail(`expected 402 probe, got ${probe.status}`);
const payReq = probe.body.match(/^\s*$/)
  ? {}
  : JSON.parse(probe.body);
const hdrB64 = await fetch(ENDPOINT + PAY_URL, {
  method: METHOD,
  headers: { "content-type": "application/json" },
  ...(METHOD !== "GET" ? { body: BODY } : {}),
}).then((r) => r.headers.get("payment-required"));
const hdrJson = hdrB64
  ? JSON.parse(Buffer.from(hdrB64, "base64").toString())
  : {};
const accepts = (hdrJson.accepts ?? payReq.accepts ?? []) as Array<{
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
}>;
const arcEntry = accepts.find(
  (a) => a.scheme === "eip3009-client-broadcast",
);
if (!arcEntry) fail("no eip3009-client-broadcast accepts entry advertised");
ok(`402 advertised: ${arcEntry.amount} USDC → ${arcEntry.payTo}`);

// ── 2. victim broadcasts the payment → txHash ──────────────────────────
const txHash = await wallet.writeContract({
  address: ARC_TESTNET.usdc,
  abi: USDC_ABI,
  functionName: "transfer",
  args: [arcEntry.payTo as `0x${string}`, BigInt(arcEntry.amount)],
});
ok(`broadcast ${txHash}`);
await publicClient.waitForTransactionReceipt({ hash: txHash });
ok(`mined on ${ARC_TESTNET.name} (chainId ${chain.id})`);

const paymentB64 = Buffer.from(
  JSON.stringify({
    x402Version: 2,
    accepted: arcEntry,
    payload: { txHash },
  }),
).toString("base64");

// ── 3. ATTACKER snipe — victim's txHash + attacker's signature ─────────
const snipe = await hit(await boundHeaders(attacker, paymentB64, txHash));
if (snipe.status !== 403) {
  fail(`snipe expected 403, got ${snipe.status}: ${snipe.body.slice(0, 200)}`);
}
ok(`snipe rejected 403: ${snipe.body.slice(0, 120)}`);

// ── 4. VICTIM legit bound request — slot must be intact ────────────────
const legit = await hit(await boundHeaders(victim, paymentB64, txHash));
if (legit.status !== 200) {
  fail(`legit expected 200, got ${legit.status}: ${legit.body.slice(0, 200)}`);
}
ok(`legit grant 200: ${legit.body.slice(0, 120)}`);

// ── 5. replay — slot consumed by the real payment ──────────────────────
const replay = await hit(await boundHeaders(victim, paymentB64, txHash));
if (replay.status !== 402) {
  fail(`replay expected 402, got ${replay.status}`);
}
ok(`replay rejected 402: ${replay.body.slice(0, 120)}`);

console.log("=== dogfood done: snipe blocked, grant issued, replay deduped ===");
