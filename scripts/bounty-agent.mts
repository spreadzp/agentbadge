/**
 * SLICE-197-18: bounty agent over the PUBLIC API only — no imports
 * from src/**. Drives the full bounty flow for a registered agent:
 *
 *   GET /api/bounties            → pick open bounty (or BOUNTY_ID)
 *   GET /api/bounties/:id        → brief (X-Wallet/X-Sig/X-Timestamp)
 *   POST /api/bounties/:id/claim → payout bind (EIP-191 claimSig)
 *   POST /api/bounties/:id/submit → prUrl + commitSha + models
 *
 * Auth:
 *   Authorization: Bearer agb_...   — agent key (sets passport ctx)
 *   X-Wallet + X-Sig + X-Timestamp  — EIP-191 over access challenge:
 *     agentbadge-access:v1\nwallet:{w}\nmethod:{M}\npath:{p}\ntimestamp:{t}
 *   claimSig — EIP-191 over
 *     bounty-claim:{chainId}:{bountyId}:{attempt}:{wallet}:{expiresMs}
 *
 * Env:
 *   ENDPOINT=http://localhost:4021
 *   AGENT_API_KEY=agb_...           — required
 *   AGENT_WALLET_KEY=0x...          — passport owner key, required
 *   BOUNTY_ID=bty_...               — optional, else first "open"
 *   CHAIN_ID=5042002                — Arc testnet default
 *   PR_URL / COMMIT_SHA / MODELS    — submit payload (skip submit
 *                                     when PR_URL unset)
 *
 * Usage:
 *   AGENT_API_KEY=agb_... AGENT_WALLET_KEY=0x... \
 *     bun run scripts/bounty-agent.mts
 */

import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http } from "viem";

const ENDPOINT = process.env.ENDPOINT ?? "http://localhost:4021";
const API_KEY = process.env.AGENT_API_KEY;
const WALLET_KEY = process.env.AGENT_WALLET_KEY as `0x${string}` | "";
const CHAIN_ID = process.env.CHAIN_ID ?? "5042002";

if (!API_KEY) {
  console.error("Missing AGENT_API_KEY (agb_...)");
  process.exit(1);
}
if (!WALLET_KEY) {
  console.error("Missing AGENT_WALLET_KEY (0x...)");
  process.exit(1);
}
const account = privateKeyToAccount(WALLET_KEY as `0x${string}`);

async function api(
  method: string,
  path: string,
  body?: unknown,
  signed = false,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${API_KEY}`,
    "content-type": "application/json",
  };
  if (signed) {
    const ts = String(Math.floor(Date.now() / 1000));
    const msg = [
      "agentbadge-access:v1",
      `wallet:${account.address.toLowerCase()}`,
      `method:${method}`,
      `path:${path}`,
      `timestamp:${ts}`,
    ].join("\n");
    headers["x-wallet"] = account.address;
    headers["x-timestamp"] = ts;
    headers["x-sig"] = await account.signMessage({ message: msg });
  }
  const res = await fetch(`${ENDPOINT}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<
    string, unknown
  >;
  return { status: res.status, json };
}

const wallet = account.address.toLowerCase();
console.log(`[agent] ${wallet} → ${ENDPOINT}`);

// 1. Public feed → open bounty
let bountyId = process.env.BOUNTY_ID;
if (!bountyId) {
  const feed = await api("GET", "/api/bounties?status=open");
  const list = (feed.json.bounties ?? feed.json.items ?? []) as {
    bountyId: string;
  }[];
  bountyId = list[0]?.bountyId;
  if (!bountyId) {
    console.error("No open bounties in feed");
    process.exit(1);
  }
}
console.log(`[agent] bounty ${bountyId}`);

// 2. Brief (signed access — passport owner only)
const brief = await api("GET", `/api/bounties/${bountyId}`, undefined, true);
if (brief.status !== 200) {
  console.error(`brief ${brief.status}:`, JSON.stringify(brief.json));
  process.exit(1);
}
const bounty = brief.json.bounty as {
  jobAttempt: number;
  budgetUsdc: string;
  title: string;
  brief: { criteria: string[]; deliverableType: string };
};
console.log(
  `[agent] brief ok: "${bounty.title}" $${bounty.budgetUsdc}` +
  ` attempt ${bounty.jobAttempt} — ${bounty.brief.criteria.length} criteria`,
);

// 3. Claim — EIP-191 claimSig bound to chainId+attempt+expiry
const sigExpiresAt = Date.now() + 5 * 60_000; // 5 min, within TTL
const claimMsg =
  `bounty-claim:${CHAIN_ID}:${bountyId}:${bounty.jobAttempt}:` +
  `${wallet}:${sigExpiresAt}`;
const claimSig = await account.signMessage({ message: claimMsg });
const claim = await api("POST", `/api/bounties/${bountyId}/claim`, {
  payoutWallet: account.address,
  claimSig,
  sigExpiresAt,
});
if (claim.status !== 200) {
  console.error(`claim ${claim.status}:`, JSON.stringify(claim.json));
  process.exit(1);
}
console.log(
  `[agent] claimed — lease until ${(claim.json.claim as { leaseUntilMs?: number }).leaseUntilMs
  }, providerBind=${claim.json.providerBind}`,
);

// 3b. Provider bind — circle variant: payout wallet self-assigns by
// broadcasting setBudget(jobId, budget, 0x) itself; the server returns
// the calldata as providerTx. No providerTx → ops already bound or
// no onchain job yet.
const providerTx = claim.json.providerTx as
  | { to: `0x${string}`; data: `0x${string}`; description?: string }
  | undefined;
if (providerTx) {
  const rpcUrl =
    process.env.ARC_RPC_URL ??
    "https://rpc.blockdaemon.testnet.arc.network";
  const walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
  });
  const bindHash = await walletClient.sendTransaction({
    account,
    to: providerTx.to,
    data: providerTx.data,
    chain: null,
  });
  console.log(
    `[agent] providerBind broadcast: ${bindHash}` +
    (providerTx.description ? ` — ${providerTx.description}` : ""),
  );
  // Wait for the bind to mine so a subsequent /fund sees provider set.
  const pub = createPublicClient({ transport: http(rpcUrl) });
  await pub.waitForTransactionReceipt({ hash: bindHash });
}

// 4. Submit (skipped without PR_URL — agent still holds the lease)
const prUrl = process.env.PR_URL;
if (!prUrl) {
  console.log("[agent] no PR_URL — stopping after claim");
  process.exit(0);
}
const submit = await api("POST", `/api/bounties/${bountyId}/submit`, {
  prUrl,
  commitSha: process.env.COMMIT_SHA ?? "0".repeat(40),
  ...(process.env.MODELS
    ? { models: process.env.MODELS.split(",") }
    : {}),
});
if (submit.status !== 200) {
  console.error(`submit ${submit.status}:`, JSON.stringify(submit.json));
  process.exit(1);
}
console.log(
  `[agent] submitted — deliverable ${(submit.json.deliverable as string | undefined)?.slice(0, 18)
  }… submitTx=${submit.json.submitTx ?? "calldata-only"}`,
);
