/**
 * SLICE-153-7 dogfood: business venue `agentbadge-ops` on live mainnet.
 *
 * Flow (all against BASE_URL):
 *   1. POST /api/venue/instances — create business venue (owner = DEPLOYER),
 *      trial plan expected (ARC_BV_FREE_TRIAL_DAYS).
 *   2. POST …/members — add provider wallet (role provider).
 *   3. POST …/jobs — private job (privateDetails off-chain, commitment onchain).
 *   4. Onchain lifecycle: createJob → setBudget → fund → submitResult →
 *      completeJob (evaluator); attach each tx via /api/venue/jobs/:id/tx.
 *   5. POST …/verify-commitment — PUBLIC hash-compare (no venue access).
 *   6. POST /api/venue/jobs/:id/rate — client rating (giveFeedback calldata,
 *      client broadcasts, phase "rated").
 *   7. GET …/export?format=json|csv — admin sig; local sha256 manifest check.
 *
 * Roles: owner/client = DEPLOYER_PRIVATE_KEY; provider = ARC_EVALUATOR_KEY
 * (owns bstock agentId 1354 → providerAgentId set → rating works);
 * evaluator = "server" policy (same EOA).
 *
 * Usage:  bun scripts/venue-biz-dogfood.mts      (full cycle, new job)
 *         JOB_ID=vj_… bun scripts/venue-biz-dogfood.mts  (verify+export only)
 * Env:    DEPLOYER_PRIVATE_KEY, ARC_EVALUATOR_KEY
 *         ARC_MAINNET_RPC_URL (default blockdaemon), BASE_URL (default prod)
 */

import { createHash } from "node:crypto";
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
import { privateKeyToAccount } from "viem/accounts";
import {
  ARC_MAINNET,
  ARC_MAINNET_CONTRACTS,
  createErc8183,
  type ReadClient,
  type WriteClient,
} from "@agentbadge/circle-payments";

// ── env / clients ──────────────────────────────────────────────────
const BASE_URL = process.env.BASE_URL ?? "https://agentbadge.xyz";
const VENUE_SLUG = process.env.VENUE_SLUG ?? "agentbadge-ops";
const RPC = process.env.ARC_MAINNET_RPC_URL ?? ARC_MAINNET.rpcUrl;
const chain = defineChain({
  id: ARC_MAINNET.chainId,
  name: ARC_MAINNET.name,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const pub = createPublicClient({ chain, transport: http(RPC, { timeout: 30_000 }) });
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
function writerOf(keyEnv: string): WriteClient {
  const w = signerOf(keyEnv);
  return {
    writeContract: (args) =>
      w.writeContract({ ...args, ...GAS } as Parameters<typeof w.writeContract>[0]),
  };
}

const client = signerOf("DEPLOYER_PRIVATE_KEY");   // venue owner + job client
const clientW = writerOf("DEPLOYER_PRIVATE_KEY");
const evaluator = signerOf("ARC_EVALUATOR_KEY");   // venue provider + job evaluator
const evaluatorW = writerOf("ARC_EVALUATOR_KEY");

const acp = createErc8183({
  read: pub as ReadClient,
  usdc: ARC_MAINNET.usdc,
  contract: ARC_MAINNET_CONTRACTS.agenticCommerce,
  variant: "acp",
});

const wait = (h: Hex) => pub.waitForTransactionReceipt({ hash: h });
const link = (h: string) => `${ARC_MAINNET.explorerUrl}/tx/${h}`;

// ── signed venue API (EIP-191 over agentbadge-access challenge) ────
async function signedFetch(
  wallet: ReturnType<typeof signerOf>,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
) {
  const ts = Math.floor(Date.now() / 1000);
  const message = [
    "agentbadge-access:v1",
    `wallet:${wallet.account.address.toLowerCase()}`,
    `method:${method}`,
    `path:${path}`,
    `timestamp:${ts}`,
  ].join("\n");
  const sig = await wallet.signMessage({ message });
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-wallet": wallet.account.address,
      "x-sig": sig,
      "x-timestamp": String(ts),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { _raw: text }; }
}
const signedPost = (w: ReturnType<typeof signerOf>, p: string, b: unknown) =>
  signedFetch(w, "POST", p, b);

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

/** Recursively key-sorted deep copy — mirrors export canon(). */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>).sort()
        .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

// ── run ────────────────────────────────────────────────────────────
console.log("owner/client:", client.account.address);
console.log("provider   :", evaluator.account.address, "(bstock agentId 1354)");

// 1. create business venue (idempotent on slug)
let venueId = "";
let venueSlug = VENUE_SLUG;
try {
  const created = await signedPost(client, "/api/venue/instances", {
    name: "AgentBadge Ops",
    slug: VENUE_SLUG,
    description:
      "Internal ops venue — private jobs for the agentbadge agent fleet.",
    clientPolicy: "members",
    evaluator: "server",
  }) as { venue: { id: string; slug: string; subscription?: { plan?: string; expiresAt?: number } }; trial: boolean };
  venueId = created.venue.id;
  venueSlug = created.venue.slug;
  console.log(`\nvenue created: ${venueSlug} (${venueId}) trial=${created.trial}`,
    `expiresAt=${created.venue.subscription?.expiresAt}`);
} catch (e) {
  if (!String(e).includes("already taken")) throw e;
  console.log("\nvenue slug already taken — reusing existing");
  const meta = (await (await fetch(`${BASE_URL}/api/venue/instances/${VENUE_SLUG}`)).json()) as
    { venue: { id: string; slug: string } };
  venueId = meta.venue.id;
  venueSlug = meta.venue.slug;
  console.log(`venue: ${venueSlug} (${venueId})`);
}

// 2. add provider member (provider+ can claim/submit on business venues)
try {
  const m = await signedPost(client, `/api/venue/instances/${venueSlug}/members`, {
    wallet: evaluator.account.address,
    role: "provider",
  });
  console.log("member added:", JSON.stringify(m));
} catch (e) {
  console.log("member add:", String(e).slice(0, 160), "(continuing — may already exist)");
}

// 3-6. private job lifecycle — skipped when JOB_ID is supplied.
const descriptionFull =
  "Internal: deliver a 5-minute bstock delta sample for AAPL over the venue " +
  "API, JSONL, plus the endpoint latency summary. Deliverable is the sha256 " +
  "of the JSONL file sent to ops chat.";
const terms = "payment on complete verdict; 0.25 USDC; private venue scope";
const jobIdFinal = process.env.JOB_ID ?? "";
if (jobIdFinal) {
  console.log(`\nJOB_ID=${jobIdFinal} — skipping job lifecycle`);
} else {
  const created = (await signedPost(client, `/api/venue/instances/${venueSlug}/jobs`, {
    title: "bstock delta sample — private ops run",
    description: "ops-internal: bstock delta sample (see private terms)",
    category: "ops",
    budgetUsdc: 0.25,
    provider: evaluator.account.address,
    privateDetails: { descriptionFull, terms },
  })) as { job: { jobId: string }; txs: { createJob: { to: Hex; data: Hex } } };
  const vid = created.job.jobId;
  console.log(`\njob created: ${vid}`);

  const createTxHash = await client.sendTransaction({
    to: created.txs.createJob.to,
    data: created.txs.createJob.data,
    ...GAS,
  });
  await wait(createTxHash);
  const job = await attachTx(vid, createTxHash, "created");
  console.log(`  created  ${link(createTxHash)}  onchainJobId=${job?.onchainJobId}`);
  if (job?.onchainJobId == null) throw new Error("onchainJobId not resolved");
  const jid = BigInt(job.onchainJobId);

  const amount = parseUnits("0.25", 6);
  const budgetHash = await acp.setBudget(evaluatorW, { jobId: jid, amount });
  await wait(budgetHash);
  console.log(`  setBudget ${link(budgetHash)}`);

  const { approveTx, fundTx } = await acp.fundJob(clientW, { jobId: jid, amount });
  await wait(fundTx);
  await attachTx(vid, fundTx, "funded");
  console.log(`  funded   ${link(fundTx)} (approve ${link(approveTx)})`);

  const deliverableHash = keccak256(toBytes(`deliverable:${descriptionFull}`));
  const submitHash = await acp.submitResult(evaluatorW, { jobId: jid, deliverableHash });
  await wait(submitHash);
  await attachTx(vid, submitHash, "submitted");
  console.log(`  submit   ${link(submitHash)}`);

  const reason = keccak256(toBytes("verdict:bstock-delta-sample:pass"));
  const completeHash = await acp.completeJob(evaluatorW, { jobId: jid, reason });
  await wait(completeHash);
  await attachTx(vid, completeHash, "completed");
  console.log(`  complete ${link(completeHash)}`);

  // 6. client rating (subjective ERC-8004 channel)
  try {
    const rated = (await signedPost(client, `/api/venue/jobs/${vid}/rate`, {
      score: 5,
      comment: "on-time, exact deliverable",
    })) as { tx: { to: Hex; data: Hex } };
    const rateHash = await client.sendTransaction({
      to: rated.tx.to,
      data: rated.tx.data,
      ...GAS,
    });
    await wait(rateHash);
    await attachTx(vid, rateHash, "rated");
    console.log(`  rated    ${link(rateHash)}`);
  } catch (e) {
    console.log("rating skipped:", String(e).slice(0, 160));
  }
}

// 5. verify-commitment — PUBLIC, no venue access needed
if (jobIdFinal) {
  const vc = await fetch(
    `${BASE_URL}/api/venue/instances/${venueSlug}/jobs/${jobIdFinal}/verify-commitment`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ descriptionFull, terms }),
    },
  );
  console.log("\nverify-commitment:", vc.status, await vc.text());
}

// 7. audit export (admin+ sig) + local manifest verification
const exportPath = `/api/venue/instances/${venueSlug}/export`;
const ex = (await signedFetch(client, "GET", exportPath)) as Record<string, unknown> & {
  manifest?: { canonicalJsonSha256?: string; counts?: Record<string, number> };
  anchor?: { to: string; data: string; description: string };
};
const { manifest, anchor, ...payload } = ex;
const localHash = createHash("sha256").update(JSON.stringify(canon(payload))).digest("hex");
console.log("\nexport manifest:", manifest?.canonicalJsonSha256);
console.log("local recompute:", localHash,
  localHash === manifest?.canonicalJsonSha256 ? "MATCH ✓" : "MISMATCH ✗");
console.log("counts:", JSON.stringify(manifest?.counts));
if (anchor) console.log("memo anchor calldata present:", anchor.description);

// CSV variant — query not signed (path-only challenge)
const csvText = await signedFetch(client, "GET", exportPath + "?format=csv")
  .then((r) => String(r._raw ?? "")).catch(() => "");
// signedFetch parses JSON; CSV path breaks it → raw fetch with sig
const csvRes = await (async () => {
  const ts = Math.floor(Date.now() / 1000);
  const message = [
    "agentbadge-access:v1",
    `wallet:${client.account.address.toLowerCase()}`,
    "method:GET",
    `path:${exportPath}`,
    `timestamp:${ts}`,
  ].join("\n");
  const sig = await client.signMessage({ message });
  return fetch(`${BASE_URL}${exportPath}?format=csv`, {
    headers: {
      "x-wallet": client.account.address,
      "x-sig": sig,
      "x-timestamp": String(ts),
    },
  });
})();
const csv = await csvRes.text();
console.log(`\nexport csv ${csvRes.status} (${csv.length} bytes):\n${csv.slice(0, 800)}`);

console.log("\n── business stats:",
  await (await fetch(`${BASE_URL}/api/venue/stats?kind=business`)).text());
console.log("done.");
