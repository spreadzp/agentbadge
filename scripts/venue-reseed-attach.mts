/**
 * Post-OOM reseed: onchain state survived (jobs 3/4/5, provider top-up,
 * offer signature) — only .data/venue.json was wiped. Re-creates local
 * venue records and attaches the ALREADY CONFIRMED tx hashes — zero new
 * chain writes. Status sync pulls real onchain status (completed/
 * submitted/open).
 *
 * Usage:  bun scripts/venue-reseed-attach.mts
 * Env:    DEPLOYER_PRIVATE_KEY (client sig), ARC_EVALUATOR_KEY (offer sig),
 *         BASE_URL (default prod)
 */

import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http, type Hex } from "viem";

const BASE_URL = process.env.BASE_URL ?? "https://agentbadge.xyz";
const RPC = process.env.ARC_MAINNET_RPC_URL ?? "https://rpc.mainnet.arc.io";

function signerOf(keyEnv: string) {
  const k = process.env[keyEnv];
  if (!k || !/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error(`${keyEnv} missing/invalid`);
  const account = privateKeyToAccount(k as Hex);
  return createWalletClient({
    account,
    chain: { id: 5042, name: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } },
    transport: http(RPC, { timeout: 30_000 }),
  });
}

const client = signerOf("DEPLOYER_PRIVATE_KEY");
const evaluator = signerOf("ARC_EVALUATOR_KEY");
const PROVIDER = "0x67d43A4065Dd69165061062B3128EDA50f1F7C96"; // venue provider EOA

async function signedPost(wallet: ReturnType<typeof signerOf>, path: string, body: unknown) {
  const ts = Math.floor(Date.now() / 1000);
  const message = [
    "agentbadge-access:v1",
    `wallet:${wallet.account.address.toLowerCase()}`,
    "method:POST",
    `path:${path}`,
    `timestamp:${ts}`,
  ].join("\n");
  const sig = await wallet.signMessage({ message });
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-wallet": wallet.account.address,
      "x-sig": sig,
      "x-timestamp": String(ts),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json as Record<string, unknown>;
}

async function attachTx(jobId: string, hash: string, phase: string) {
  const res = await fetch(`${BASE_URL}/api/venue/jobs/${jobId}/tx`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hash, phase }),
  });
  const json = (await res.json()) as { job?: { onchainJobId?: number } };
  if (!res.ok) throw new Error(`attach ${phase} ${jobId} → ${res.status}: ${JSON.stringify(json)}`);
  return json.job;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── jobs: re-create records + attach confirmed hashes ──────────────
interface ReseedJob {
  title: string;
  description: string;
  budgetUsdc: number;
  withProvider: boolean;
  txs: { phase: string; hash: string }[];
}

const JOBS: ReseedJob[] = [
  {
    title: "Realtime equities delta — market feed trial",
    description:
      "Deliver a 10-minute sample of the bstock delta feed for AAPL/MSFT " +
      "with timestamps and deltas, delivered as JSONL.",
    budgetUsdc: 0.5,
    withProvider: true,
    txs: [
      { phase: "created", hash: "0xe7daa022d8a99b91bc43120d60d16404537d3a8dc6db200b7d7c2df39b6fb409" },
      { phase: "funded", hash: "0x0de342eb56093cd9fae443636ecb03dba9908a01e9c688fbe651826d5c48a411" },
      { phase: "submitted", hash: "0xdaf4ca70940f870c8b3909e2932bbb04a8e7d94f38d1bfd67098331579e56cf3" },
      { phase: "completed", hash: "0x24eefdae7d450f78c34fedc21ce84d6bb053fb215791cdfa26e5da6e9a10a52a" },
    ],
  },
  {
    title: "Agent-readiness report for venue provider endpoint",
    description:
      "Run the readiness scanner over the provider MCP endpoint and submit " +
      "the compact report hash as the deliverable.",
    budgetUsdc: 0.3,
    withProvider: true,
    txs: [
      { phase: "created", hash: "0xba7c7bd7fa377dfc919399f636e0c2e482dd4cb0c150d72373117c8f6ac8f719" },
      { phase: "funded", hash: "0x66b3e1a097b24122d483c0d48429a5aa5b6a047ea725cfae648fec794419121b" },
      { phase: "submitted", hash: "0x411bcd615dac0ad68057f3adedd9cf729f90b745421075c71347df3d96d99b71" },
    ],
  },
  {
    title: "Open bounty: attest 3 agent-ready sites",
    description:
      "Open-board job — first provider to register can claim it. Deliverable: " +
      "three live attestation links on explorer.arc.io.",
    budgetUsdc: 0.25,
    withProvider: false,
    txs: [
      { phase: "created", hash: "0xb48be0ddef66b54aa9db0e3317893c016d95856f4ca542a274f984b169fdc959" },
    ],
  },
];

for (const spec of JOBS) {
  const created = (await signedPost(client, "/api/venue/jobs", {
    title: spec.title,
    description: spec.description,
    budgetUsdc: spec.budgetUsdc,
    category: "demo",
    ...(spec.withProvider ? { provider: PROVIDER } : {}),
  })) as { job: { jobId: string } };
  const vid = created.job.jobId;
  console.log(`\n── ${spec.title} → ${vid}`);
  for (const t of spec.txs) {
    const job = await attachTx(vid, t.hash, t.phase);
    console.log(`  ${t.phase} attached (onchainJobId=${job?.onchainJobId})`);
  }
  const res = await fetch(`${BASE_URL}/api/venue/jobs/${vid}/status`);
  const json = (await res.json()) as { job?: { status?: string } };
  console.log(`  status → ${json.job?.status}`);
}

// ── offer: bstock (agentId 1354, owned by evaluator EOA) ────────────
const offer = await signedPost(evaluator, "/api/venue/offers", {
  agentId: 1354,
  name: "bstock",
  description:
    "Realtime equities delta tracker — MCP tools surface, priced in USDC. " +
    "Free tier, then x402 per-request.",
  endpoint: "https://agentbadge.xyz/mcp",
  categories: ["market-data", "mcp"],
});
console.log("\noffer:", JSON.stringify(offer).slice(0, 160));

// ── attestations: free tier 1/min → 66s gaps, light targets only ────
const attestationTargets = [
  "https://agentbadge.xyz",
  "https://modelcontextprotocol.io",
];
for (const url of attestationTargets) {
  const res = await fetch(`${BASE_URL}/api/attestations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const json = await res.json().catch(() => ({}));
  console.log(`attestation ${url} → ${res.status}`, JSON.stringify(json).slice(0, 150));
  if (url !== attestationTargets[attestationTargets.length - 1]) await sleep(66_000);
}

console.log("\n── stats:", await (await fetch(`${BASE_URL}/api/venue/stats`)).text());
console.log("done.");
