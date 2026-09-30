/**
 * SLICE-151-6/12 mainnet venue seed (D-F13): populates /market on prod
 * with a real ERC-8183 lifecycle — 3 EOAs, real txs, real API calls.
 *
 * Roles: client = DEPLOYER_PRIVATE_KEY (0xcdd23d…), provider = NEW EOA
 * (VENUE_PROVIDER_KEY — generated on first run, save it to .env),
 * evaluator = ARC_EVALUATOR_KEY (oracle 0xEAF85d…, owns bstock agentId 1354).
 *
 * Status spread: 1 completed + 1 submitted + 1 open (open-board, no provider).
 * Offers: bstock offer signed by its agentId owner (evaluator EOA).
 * Attestations: POST /api/attestations spaced >60s (free tier 1/min).
 *
 * Usage:  bun scripts/venue-seed-mainnet.mts
 * Env:    DEPLOYER_PRIVATE_KEY, ARC_EVALUATOR_KEY, VENUE_PROVIDER_KEY
 *         ARC_MAINNET_RPC_URL (default blockdaemon), BASE_URL (default prod)
 */

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseUnits,
  toBytes,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  ARC_MAINNET,
  ARC_MAINNET_CONTRACTS,
  createErc8183,
  type ReadClient,
  type WriteClient,
} from "@agentbadge/circle-payments";

// ── env / clients ──────────────────────────────────────────────────
const BASE_URL = process.env.BASE_URL ?? "https://agentbadge.xyz";
const RPC = process.env.ARC_MAINNET_RPC_URL ?? ARC_MAINNET.rpcUrl;
const chain = defineChain({
  id: ARC_MAINNET.chainId,
  name: ARC_MAINNET.name,
  // Native gas token on Arc is USDC at 18 decimals (ERC-20 USDC = 6).
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const pub = createPublicClient({ chain, transport: http(RPC, { timeout: 30_000 }) });

// Arc gas: 20 Gwei floor + 1 Gwei priority per docs.arc.io (same as
// scripts/arc-commerce-demo.mts) — writes without them hang/fail.
const ARC_MIN_FEE = 20_000_000_000n;
const ARC_TIP = 1_000_000_000n;
const GAS = { maxFeePerGas: ARC_MIN_FEE, maxPriorityFeePerGas: ARC_TIP } as const;

function accountFrom(keyEnv: string) {
  const k = process.env[keyEnv];
  if (!k || !/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error(`${keyEnv} missing/invalid`);
  return privateKeyToAccount(k as Hex);
}

function signerOf(keyEnv: string) {
  return createWalletClient({
    account: accountFrom(keyEnv),
    chain,
    transport: http(RPC, { timeout: 30_000 }),
  });
}

/** WriteClient for erc8183 helpers — every writeContract carries Arc gas. */
function writerOf(keyEnv: string): WriteClient {
  const w = signerOf(keyEnv);
  return {
    writeContract: (args) =>
      w.writeContract({ ...args, ...GAS } as Parameters<typeof w.writeContract>[0]),
  };
}

const client = signerOf("DEPLOYER_PRIVATE_KEY");
const clientW = writerOf("DEPLOYER_PRIVATE_KEY");
const evaluator = signerOf("ARC_EVALUATOR_KEY");
const evaluatorW = writerOf("ARC_EVALUATOR_KEY");

const providerKey = process.env.VENUE_PROVIDER_KEY as Hex | undefined;
if (!providerKey || !/^0x[0-9a-fA-F]{64}$/.test(providerKey)) {
  const fresh = generatePrivateKey();
  const addr = privateKeyToAccount(fresh).address;
  console.log("No VENUE_PROVIDER_KEY — generated a new provider EOA:");
  console.log(`  address: ${addr}`);
  console.log(`  key:     ${fresh}`);
  console.log("Add VENUE_PROVIDER_KEY=<key> to hackathon/server/.env and re-run.");
  process.exit(0);
}
const provider = signerOf("VENUE_PROVIDER_KEY");
const providerW = writerOf("VENUE_PROVIDER_KEY");

const acp = createErc8183({
  read: pub as ReadClient,
  usdc: ARC_MAINNET.usdc,
  contract: ARC_MAINNET_CONTRACTS.agenticCommerce,
  variant: "acp",
});

const wait = (h: Hex) => pub.waitForTransactionReceipt({ hash: h });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const link = (h: string) => `${ARC_MAINNET.explorerUrl}/tx/${h}`;

// ── signed venue API calls (EIP-191 over agentbadge-access challenge) ──
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
  const json = (await res.json()) as { job?: { onchainJobId?: number; status?: string } };
  if (!res.ok) throw new Error(`attach ${phase} → ${res.status}: ${JSON.stringify(json)}`);
  return json.job;
}

async function syncStatus(jobId: string) {
  const res = await fetch(`${BASE_URL}/api/venue/jobs/${jobId}/status`);
  const json = (await res.json()) as { job?: { status?: string } };
  return json.job?.status;
}

// ── venue job lifecycle ────────────────────────────────────────────
interface SeedJob {
  title: string;
  description: string;
  budgetUsdc: number;
  withProvider: boolean;
  driveTo: "created" | "submitted" | "completed";
}

async function seedJob(spec: SeedJob) {
  console.log(`\n── ${spec.title} → ${spec.driveTo}`);
  const created = (await signedPost(client, "/api/venue/jobs", {
    title: spec.title,
    description: spec.description,
    budgetUsdc: spec.budgetUsdc,
    category: "demo",
    ...(spec.withProvider ? { provider: provider.account.address } : {}),
  })) as { job: { jobId: string }; txs: { createJob: { to: Hex; data: Hex } } };
  const vid = created.job.jobId;

  const createHash = await client.sendTransaction({
    to: created.txs.createJob.to,
    data: created.txs.createJob.data,
    ...GAS,
  });
  await wait(createHash);
  const job = await attachTx(vid, createHash, "created");
  console.log(`  created  ${link(createHash)}  onchainJobId=${job?.onchainJobId}`);
  if (job?.onchainJobId == null) throw new Error("onchainJobId not resolved from receipt");
  const jid = BigInt(job.onchainJobId);

  if (spec.driveTo === "created") return { vid, jid };

  const amount = parseUnits(String(spec.budgetUsdc), 6);
  const budgetHash = await acp.setBudget(providerW, { jobId: jid, amount });
  await wait(budgetHash);
  console.log(`  setBudget ${link(budgetHash)}`);

  const { approveTx, fundTx } = await acp.fundJob(clientW, { jobId: jid, amount });
  await wait(fundTx);
  await attachTx(vid, fundTx, "funded");
  console.log(`  funded   ${link(fundTx)} (approve ${link(approveTx)})`);

  const deliverableHash = keccak256(toBytes(`deliverable:${spec.title}`));
  const submitHash = await acp.submitResult(providerW, { jobId: jid, deliverableHash });
  await wait(submitHash);
  await attachTx(vid, submitHash, "submitted");
  console.log(`  submit   ${link(submitHash)}`);

  if (spec.driveTo === "submitted") return { vid, jid };

  const reason = keccak256(toBytes(`verdict:${spec.title}:pass`));
  const completeHash = await acp.completeJob(evaluatorW, { jobId: jid, reason });
  await wait(completeHash);
  await attachTx(vid, completeHash, "completed");
  console.log(`  complete ${link(completeHash)}`);
  return { vid, jid };
}

// ── run ────────────────────────────────────────────────────────────
console.log("client   :", client.account.address);
console.log("provider :", provider.account.address);
console.log("evaluator:", evaluator.account.address);

// 0. provider gas top-up (native USDC, 18 dec)
const minProvider = parseUnits("0.10", 18);
const providerBal = await pub.getBalance({ address: provider.account.address });
if (providerBal < minProvider) {
  const topUp = await client.sendTransaction({
    to: provider.account.address,
    value: parseUnits("0.5", 18) - providerBal,
    ...GAS,
  });
  await wait(topUp);
  console.log(`provider topped up → ${link(topUp)}`);
} else {
  console.log(`provider balance OK (${providerBal})`);
}

const evaluatorBal = await pub.getBalance({ address: evaluator.account.address });
if (evaluatorBal < parseUnits("0.05", 18)) {
  const topUp = await client.sendTransaction({
    to: evaluator.account.address,
    value: parseUnits("0.1", 18),
    ...GAS,
  });
  await wait(topUp);
  console.log(`evaluator topped up → ${link(topUp)}`);
}

// 1. jobs — 1 completed + 1 submitted + 1 open
await seedJob({
  title: "Realtime equities delta — market feed trial",
  description:
    "Deliver a 10-minute sample of the bstock delta feed for AAPL/MSFT " +
    "with timestamps and deltas, delivered as JSONL.",
  budgetUsdc: 0.5,
  withProvider: true,
  driveTo: "completed",
});
await seedJob({
  title: "Agent-readiness report for venue provider endpoint",
  description:
    "Run the readiness scanner over the provider MCP endpoint and submit " +
    "the compact report hash as the deliverable.",
  budgetUsdc: 0.3,
  withProvider: true,
  driveTo: "submitted",
});
await seedJob({
  title: "Open bounty: attest 3 agent-ready sites",
  description:
    "Open-board job — first provider to register can claim it. Deliverable: " +
    "three live attestation links on explorer.arc.io.",
  budgetUsdc: 0.25,
  withProvider: false,
  driveTo: "created",
});

// 2. bstock provider offer — signed by the wallet owning agentId 1354
const offer = await signedPost(evaluator, "/api/venue/offers", {
  agentId: 1354,
  name: "bstock",
  description:
    "Realtime equities delta tracker — MCP tools surface, priced in USDC. " +
    "Free tier, then x402 per-request.",
  endpoint: "https://agentbadge.xyz/mcp",
  categories: ["market-data", "mcp"],
});
console.log("\noffer registered:", JSON.stringify(offer));

// 3. attestations — 1 free/min → space them out
const attestationTargets = [
  "https://agentbadge.xyz",
  "https://modelcontextprotocol.io",
  "https://stripe.com",
];
for (const url of attestationTargets) {
  const res = await fetch(`${BASE_URL}/api/attestations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const json = await res.json().catch(() => ({}));
  console.log(`attestation ${url} → ${res.status}`, JSON.stringify(json).slice(0, 200));
  if (url !== attestationTargets[attestationTargets.length - 1]) await sleep(66_000);
}

// 4. final sync + summary
for (const j of await (await fetch(`${BASE_URL}/api/venue/jobs`)).json()
  .then((r: { jobs?: { jobId: string }[] }) => r.jobs ?? [])) {
  const status = await syncStatus(j.jobId);
  console.log(`sync ${j.jobId} → ${status}`);
}
console.log("\n── stats:", await (await fetch(`${BASE_URL}/api/venue/stats`)).text());
console.log("done.");
