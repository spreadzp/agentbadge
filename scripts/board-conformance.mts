/**
 * SLICE-201-4 (EPIC-201, track A — главный гейт эпика): conformance e2e.
 * A "foreign" agent (fresh EVM key, self-serve registration — no demo wallets)
 * walks the full deal cycle against a running server on Arc testnet:
 *
 *   register → find → create-task(ops) → terms → claim → execute → submit →
 *   qa(ops) → review(reviewer) → done → receipt(EIP-712 verify) → payment(onchain)
 *
 * Every step is asserted and timed; a failing step aborts with a reproducible
 * report (step, HTTP status, body). Output:
 *   docs/EPICS/201-agent-economy-interface/CONFORMANCE-REPORT.md (+ out JSON)
 *
 * Usage:
 *   bun scripts/board-conformance.mts [--dry-run] [--boot]
 *
 * Env:
 *   CONF_ENDPOINT / E2E_TARGET_URL  — server base (default http://localhost:4021;
 *                                     pass your deployment for live conformance)
 *   CONF_BOOT=1 | --boot            — boot `bun src/server/index.ts` on :4322
 *   BOARD_E2E_OPS_KEY / CONF_OPS_KEY         — ops agent key (platform task+qa)
 *   BOARD_E2E_REVIEWER_KEY / CONF_REVIEWER_KEY      — reviewer agent key
 *   BOARD_E2E_REVIEWER_PRIVKEY / CONF_REVIEWER_PRIVKEY — reviewer EVM key (EIP-191)
 *   ARC_RPC_URL / BOARD_E2E_RPC     — testnet RPC (default ARC_TESTNET.rpcUrl)
 *   --dry-run / DRY_RUN=1           — skip onchain legs (tx waits, getJob, USDC)
 *
 * Known gap (recorded in the report): the guide advertises GET
 * /api/board/cards/:id/terms — the route does not exist; card terms live in
 * GET /api/board/cards/:id (spec gated by claim).
 */
import { spawn, type Subprocess } from "bun";
import {
  createPublicClient,
  erc20Abi,
  http,
  isAddress,
  keccak256,
  parseEventLogs,
  toBytes,
  type Hex,
} from "viem";
import {
  generatePrivateKey,
  privateKeyToAccount,
} from "viem/accounts";
import { ethers } from "ethers";
import { ARC_TESTNET } from "@agentbadge/circle-payments";
import { ERC8183_REF_ABI } from "../src/server/lib/board/erc8183-ref";
import { canonicalJson } from "../src/server/lib/eaas/verdict";

// ─── config ────────────────────────────────────────────────────────────────
const ARGS = new Set(process.argv.slice(2));
const DRY = ARGS.has("--dry-run") || process.env.DRY_RUN === "1";
const BOOT = ARGS.has("--boot") || process.env.CONF_BOOT === "1";
const BOOT_PORT = 4322;
const ENDPOINT = (
  process.env.CONF_ENDPOINT ??
  process.env.E2E_TARGET_URL ??
  (BOOT ? `http://127.0.0.1:${BOOT_PORT}` : "http://localhost:4021")
).replace(/\/+$/, "");
const OPS_KEY = process.env.CONF_OPS_KEY ?? process.env.BOARD_E2E_OPS_KEY ?? "";
const REVIEWER_KEY =
  process.env.CONF_REVIEWER_KEY ?? process.env.BOARD_E2E_REVIEWER_KEY ?? "";
const REVIEWER_PK = (process.env.CONF_REVIEWER_PRIVKEY ??
  process.env.BOARD_E2E_REVIEWER_PRIVKEY ??
  "") as Hex;
const CHAIN_ID = 5042002; // Arc testnet
const RPC_URL = process.env.ARC_RPC_URL ?? process.env.BOARD_E2E_RPC ?? ARC_TESTNET.rpcUrl;
const ESCROW = (process.env.ERC8183_REF_ADDRESS ??
  "0x0049e5362736c933055e502b3cf3ba90cc0bf6a0") as Hex;
const USDC = (process.env.BOARD_E2E_USDC ?? ARC_TESTNET.usdc) as Hex;
const REPORT_MD = new URL(
  "../../docs/EPICS/201-agent-economy-interface/CONFORMANCE-REPORT.md",
  import.meta.url,
).pathname;
const REPORT_JSON = new URL(
  "../../out/conformance-run.json",
  import.meta.url,
).pathname;

const log = (...a: unknown[]) => console.log("[conf]", ...a);

// ─── step recorder ─────────────────────────────────────────────────────────
interface Step {
  name: string;
  ok: boolean | "skipped";
  ms: number;
  status?: number;
  detail?: string;
}
const steps: Step[] = [];
let failedStep: Step | null = null;

async function step<T>(
  name: string,
  fn: () => Promise<{ detail?: string; value?: T; status?: number }>,
): Promise<T> {
  const t0 = Date.now();
  try {
    const r = await fn();
    steps.push({ name, ok: true, ms: Date.now() - t0, status: r.status, detail: r.detail });
    log(`✔ ${name} (${Date.now() - t0}ms)${r.detail ? ` — ${r.detail}` : ""}`);
    return r.value as T;
  } catch (e) {
    const s: Step = {
      name,
      ok: false,
      ms: Date.now() - t0,
      detail: e instanceof Error ? e.message : String(e),
    };
    steps.push(s);
    failedStep = s;
    throw e;
  }
}

function skip(name: string, why: string): void {
  steps.push({ name, ok: "skipped", ms: 0, detail: why });
  log(`– ${name} skipped: ${why}`);
}

// ─── http helpers ──────────────────────────────────────────────────────────
let idemSeq = 0;
async function api(
  path: string,
  opts: { method?: string; key?: string; body?: unknown } = {},
) {
  const res = await fetch(`${ENDPOINT}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(opts.key ? { authorization: `Bearer ${opts.key}` } : {}),
      ...(opts.method && opts.method !== "GET"
        ? { "idempotency-key": `conf-${Date.now()}-${idemSeq++}` }
        : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

async function journal(cardId: string): Promise<{ kind: string; txHash?: string }[]> {
  const { json } = await api(`/api/board/cards/${cardId}/journal`);
  return (json.entries as { kind: string; txHash?: string }[] | undefined) ?? [];
}

async function waitTxHash(cardId: string, kind: string, tries = 40): Promise<string> {
  for (let i = 0; i < tries; i++) {
    const hit = (await journal(cardId)).find((e) => e.kind === kind && e.txHash);
    if (hit?.txHash) return hit.txHash;
    await Bun.sleep(2000);
  }
  throw new Error(`no txHash for "${kind}" on ${cardId} after ${tries * 2}s`);
}

// ─── chain helpers ─────────────────────────────────────────────────────────
const chain = {
  id: CHAIN_ID,
  name: "arc-testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
} as const;
const pub = createPublicClient({ chain, transport: http(RPC_URL) });

async function usdcBalance(addr: Hex): Promise<bigint> {
  return pub.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [addr],
  }) as Promise<bigint>;
}

async function jobIdFromTx(txHash: string): Promise<bigint> {
  const receipt = await pub.getTransactionReceipt({ hash: txHash as Hex });
  const logs = parseEventLogs({
    abi: ERC8183_REF_ABI,
    eventName: "JobCreated",
    logs: receipt.logs,
  });
  const jobId = (logs[0]?.args as { jobId?: bigint } | undefined)?.jobId;
  if (jobId === undefined) throw new Error(`no JobCreated in ${txHash}`);
  return jobId;
}

// ─── EIP-712 receipt verify (external-agent side: reconstructs signing body) ─
const RECEIPT_TYPE = [
  { name: "taskId", type: "string" },
  { name: "bountyId", type: "string" },
  { name: "specHash", type: "bytes32" },
  { name: "attempt", type: "uint256" },
  { name: "receiptHash", type: "bytes32" },
  { name: "issuedAt", type: "string" },
  { name: "chainId", type: "uint256" },
] as const;

function verifyReceipt(receipt: Record<string, unknown>): boolean {
  const { signature, ...publicBody } = receipt as Record<string, unknown> & {
    signature: string;
    task: { id: string; bountyId: string; specHash: string; attempt: number };
    chainId: number;
    issuedAt: string;
    signer: string;
  };
  const receiptHash = keccak256(toBytes(canonicalJson(publicBody)));
  const body = {
    taskId: publicBody.task.id,
    bountyId: publicBody.task.bountyId,
    specHash: publicBody.task.specHash as Hex,
    attempt: BigInt(publicBody.task.attempt),
    receiptHash,
    issuedAt: publicBody.issuedAt,
    chainId: BigInt(publicBody.chainId),
  };
  const recovered = ethers.verifyTypedData(
    {
      name: "AgentBadgeReceipt",
      version: "1",
      chainId: publicBody.chainId,
      verifyingContract: "0x0000000000000000000000000000000000000000",
    },
    { TaskReceipt: [...RECEIPT_TYPE] },
    body,
    signature as Hex,
  );
  return recovered.toLowerCase() === publicBody.signer.toLowerCase();
}

// ─── optional server boot ──────────────────────────────────────────────────
let server: Subprocess | null = null;
async function bootServer(): Promise<void> {
  server = spawn({
    cmd: ["bun", "src/server/index.ts"],
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      ARC_NETWORK: "testnet",
      AGENT_REGISTER_ENABLED: "true",
      REGISTER_SPONSORED: "true",
      // Task receipts need a signer; generate a throwaway one for boot runs
      // when the env does not provide ARC_RECEIPT_SIGNER_KEY/ARC_OPS_KEY.
      ARC_RECEIPT_SIGNER_KEY:
        process.env.ARC_RECEIPT_SIGNER_KEY ??
        process.env.ARC_OPS_KEY ??
        generatePrivateKey(),
      // Receipt wiring also requires getConfig().evm — point it at Arc
      // testnet (chainId must match the board's domain).
      CHAIN_MODE: process.env.CHAIN_MODE ?? "evm",
      EVM_RPC_URL: process.env.EVM_RPC_URL ?? RPC_URL,
      EVM_CHAIN_ID: process.env.EVM_CHAIN_ID ?? String(CHAIN_ID),
      EVM_OPERATOR_KEY:
        process.env.EVM_OPERATOR_KEY ?? generatePrivateKey(),
      EVM_PASSPORT_NFT_ADDRESS:
        process.env.EVM_PASSPORT_NFT_ADDRESS ??
        "0x0000000000000000000000000000000000000001",
      EVM_EVENT_LOG_ADDRESS:
        process.env.EVM_EVENT_LOG_ADDRESS ??
        "0x0000000000000000000000000000000000000001",
      EVM_ESCROW_ADDRESS: process.env.EVM_ESCROW_ADDRESS ?? ESCROW,
      EVM_USDC_ADDRESS: process.env.EVM_USDC_ADDRESS ?? USDC,
      EVM_EXPLORER_URL:
        process.env.EVM_EXPLORER_URL ?? "https://testnet.arcscan.app",
      ERC8183_REF_ADDRESS: process.env.ERC8183_REF_ADDRESS ?? ESCROW,
      PORT: String(BOOT_PORT),
      NODE_ENV: "test",
    },
    stdout: "ignore",
    stderr: "inherit",
  });
  process.on("exit", () => server?.kill());
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000) {
    try {
      const r = await fetch(`${ENDPOINT}/health`);
      if (r.status < 500) return;
    } catch { /* not up */ }
    await Bun.sleep(500);
  }
  throw new Error("server did not come up in 60s");
}

// ─── report ────────────────────────────────────────────────────────────────
async function writeReport(extra: Record<string, unknown>): Promise<void> {
  const totalMs = steps.reduce((a, s) => a + s.ms, 0);
  const verdict = failedStep ? "FAIL" : "PASS";
  const md = [
    `# Conformance Report — SLICE-201-4`,
    ``,
    `- **Result**: ${verdict}`,
    `- **Endpoint**: ${ENDPOINT}`,
    `- **Chain**: Arc testnet (${CHAIN_ID}), escrow ${ESCROW}`,
    `- **Dry-run**: ${DRY}`,
    `- **Total time**: ${(totalMs / 1000).toFixed(1)}s`,
    `- **Run**: ${new Date().toISOString()}`,
    ``,
    `| Step | Result | ms | Detail |`,
    `|------|--------|----|--------|`,
    ...steps.map(
      (s) =>
        `| ${s.name} | ${s.ok === true ? "✔" : s.ok === "skipped" ? "–" : "✘"} | ${s.ms} | ${(s.detail ?? "").replace(/\|/g, "\\|")} |`,
    ),
    ...(failedStep
      ? [
        ``,
        `## Failure`,
        ``,
        `Step \`${failedStep.name}\` failed: ${failedStep.detail}`,
      ]
      : []),
    ``,
    `## Notes`,
    ``,
    `- \`GET /api/board/cards/:id/terms\` advertised by the agent guide does not`,
    `  exist as a route — card terms are served by \`GET /api/board/cards/:id\`.`,
  ].join("\n");
  await Bun.write(REPORT_MD, md);
  const { mkdirSync } = await import("node:fs");
  const { dirname } = await import("node:path");
  mkdirSync(dirname(REPORT_JSON), { recursive: true });
  await Bun.write(
    REPORT_JSON,
    JSON.stringify(
      { verdict, endpoint: ENDPOINT, dryRun: DRY, totalMs, steps, ...extra },
      null,
      2,
    ),
  );
  log(`report → ${REPORT_MD}`);
}

// ─── main ──────────────────────────────────────────────────────────────────
async function main() {
  if (!OPS_KEY || !REVIEWER_KEY || !REVIEWER_PK) {
    throw new Error(
      "missing platform keys: set CONF_OPS_KEY/BOARD_E2E_OPS_KEY, " +
      "CONF_REVIEWER_KEY/BOARD_E2E_REVIEWER_KEY, CONF_REVIEWER_PRIVKEY/BOARD_E2E_REVIEWER_PRIVKEY",
    );
  }
  if (BOOT) {
    log("booting local server…");
    await bootServer();
    log("server up");
  }
  const reviewer = privateKeyToAccount(REVIEWER_PK);
  const runTag = `conf-${Date.now()}`;

  // Fresh foreign agent — new keypair, no demo wallets.
  const provider = privateKeyToAccount(generatePrivateKey());
  const balanceBefore = await (DRY ? Promise.resolve(0n) : usdcBalance(provider.address));

  // 1) register — public self-serve, returns api_key + ERC-8004 identity.
  const reg = await step("register (self-serve /api/v1/agents/register)", async () => {
    const r = await api("/api/v1/agents/register", {
      method: "POST",
      body: { name: runTag },
    });
    if (r.status !== 201) throw new Error(`register → ${r.status}: ${JSON.stringify(r.json)}`);
    const j = r.json as { api_key?: string; agent_id?: string; registry_tx?: string };
    if (!j.api_key) throw new Error(`no api_key in register response: ${JSON.stringify(r.json)}`);
    return { detail: `agent_id=${j.agent_id} tx=${j.registry_tx}`, value: j, status: r.status };
  });
  const agentKey = reg.api_key!;
  const registryTx = reg.registry_tx as string | undefined;

  // 2) find — public board listing.
  const found = await step("find (GET /api/board/cards?column=todo)", async () => {
    const r = await api("/api/board/cards?column=todo");
    if (r.status !== 200) throw new Error(`find → ${r.status}`);
    const n = ((r.json.cards as unknown[]) ?? []).length;
    return { detail: `${n} todo cards`, value: r.json, status: r.status };
  });
  void found;

  // 3) platform posts a task (ops tier — the task the foreign agent claims).
  const cardId = await step("create task (ops)", async () => {
    const r = await api("/api/board/cards", {
      method: "POST",
      key: OPS_KEY,
      body: {
        title: `conformance-${runTag}`,
        spec: "## Conformance task\nReturn deliverableHash=keccak256('ok').",
        budgetUsdc: "0.01",
      },
    });
    if (r.status !== 201) throw new Error(`create → ${r.status}: ${JSON.stringify(r.json)}`);
    const id = (r.json.card as { cardId: string }).cardId;
    return { detail: `cardId=${id}`, value: id, status: r.status };
  });

  // 4) terms — card detail (spec gated). /:id/terms route does not exist.
  await step("terms (GET /api/board/cards/:id)", async () => {
    const r = await api(`/api/board/cards/${cardId}`);
    if (r.status !== 200) throw new Error(`terms → ${r.status}`);
    const card = r.json.card as { column: string; title: string; budgetUsdc?: string };
    if (card.column !== "todo") throw new Error(`card not claimable: ${card.column}`);
    return { detail: `${card.title} budget=${card.budgetUsdc}`, status: r.status };
  });

  // 5) claim — EIP-191 board-claim signature by the fresh wallet.
  const attempt = 1;
  await step("claim (EIP-191, fresh key)", async () => {
    const exp = Date.now() + 10 * 60 * 1000;
    const message =
      `board-claim:${CHAIN_ID}:${cardId}:${attempt}:` +
      `${provider.address.toLowerCase()}:${exp}`;
    const claimSig = await provider.signMessage({ message });
    const r = await api(`/api/board/cards/${cardId}/claim`, {
      method: "POST",
      key: agentKey,
      body: { payoutWallet: provider.address, claimSig, sigExpiresAt: exp },
    });
    if (r.status !== 200) throw new Error(`claim → ${r.status}: ${JSON.stringify(r.json)}`);
    return { detail: `wallet=${provider.address}`, status: r.status };
  });

  // 6) execute — simulated deliverable.
  const deliverableHash = await step("execute (deliverable)", async () => {
    const h = keccak256(toBytes("ok"));
    return { detail: `deliverableHash=${h}`, value: h };
  });

  // 7) submit — lease holder delivers.
  await step("submit (deliverableHash)", async () => {
    const r = await api(`/api/board/cards/${cardId}/submit`, {
      method: "POST",
      key: agentKey,
      body: { deliverableHash, prUrl: `https://example.com/pr/${runTag}` },
    });
    if (r.status !== 200) throw new Error(`submit → ${r.status}: ${JSON.stringify(r.json)}`);
    return { status: r.status };
  });

  // 8) qa pass (ops) — moves card to review.
  await step("qa pass (ops)", async () => {
    const r = await api(`/api/board/cards/${cardId}/qa`, {
      method: "POST",
      key: OPS_KEY,
      body: { verdict: "pass" },
    });
    if (r.status !== 200) throw new Error(`qa → ${r.status}: ${JSON.stringify(r.json)}`);
    return { status: r.status };
  });

  // 9) review approve (reviewer) — card → done.
  await step("review approve (EIP-191)", async () => {
    const exp = Date.now() + 10 * 60 * 1000;
    const message =
      `board-review:${CHAIN_ID}:${cardId}:${attempt}:approve:` +
      `${reviewer.address.toLowerCase()}:${exp}`;
    const reviewSig = await reviewer.signMessage({ message });
    const r = await api(`/api/board/cards/${cardId}/review`, {
      method: "POST",
      key: REVIEWER_KEY,
      body: {
        verdict: "approve",
        reviewerWallet: reviewer.address,
        reviewSig,
        sigExpiresAt: exp,
      },
    });
    if (r.status !== 200) throw new Error(`review → ${r.status}: ${JSON.stringify(r.json)}`);
    const column = (r.json.card as { column: string }).column;
    if (column !== "done") throw new Error(`card not done after approve: ${column}`);
    return { status: r.status };
  });

  // 10) payment legs on-chain (skip on dry-run).
  let settleTx: string | undefined;
  if (DRY) {
    skip("payment legs (txHash/jobId)", "dry-run");
    skip("USDC payout check", "dry-run");
    skip("ERC-8004 identity check", "dry-run");
  } else {
    await step("createJob tx on chain", async () => {
      const tx = await waitTxHash(cardId, "create");
      const jobId = await jobIdFromTx(tx);
      const job = (await pub.readContract({
        address: ESCROW,
        abi: ERC8183_REF_ABI,
        functionName: "getJob",
        args: [jobId],
      })) as { status: number };
      return { detail: `tx=${tx} jobId=${jobId} status=${job.status}` };
    });
    settleTx = await step("settle tx (payment leg)", async () => {
      const tx = await waitTxHash(cardId, "complete", 60);
      return { detail: `tx=${tx}`, value: tx };
    });
    await step("USDC payout received", async () => {
      // settle tx must land before balance moves; poll for the delta.
      for (let i = 0; i < 30; i++) {
        const bal = await usdcBalance(provider.address);
        if (bal > balanceBefore) {
          return { detail: `${provider.address} +${bal - balanceBefore}` };
        }
        await Bun.sleep(2000);
      }
      throw new Error(`no USDC payout to ${provider.address}`);
    });
    await step("ERC-8004 identity on chain", async () => {
      if (!registryTx) throw new Error("no registry_tx from register");
      const rc = await pub.waitForTransactionReceipt({ hash: registryTx as Hex });
      if (rc.status !== "success") throw new Error(`registry tx failed: ${registryTx}`);
      return { detail: `tx=${registryTx}` };
    });
  }

  // 11) receipt — EIP-712 portable proof, verified offline.
  await step("receipt (GET + verifyTypedData)", async () => {
    // wait a beat for the settle outbox to land so payment leg is included.
    if (!DRY) await Bun.sleep(5000);
    const r = await api(`/api/board/cards/${cardId}/receipt`);
    if (r.status !== 200) throw new Error(`receipt → ${r.status}: ${JSON.stringify(r.json)}`);
    if (!verifyReceipt(r.json)) throw new Error("verifyTypedData: recovered != signer");
    const pay = (r.json.payment as { txHash?: string } | undefined)?.txHash;
    return {
      detail: `signer=${r.json.signer} payment.txHash=${pay ?? "none"}`,
      status: r.status,
    };
  });
}

try {
  await main();
} catch (e) {
  log("FAIL:", e instanceof Error ? e.message : e);
} finally {
  await writeReport({}).catch((e) => log("report write failed:", e));
  server?.kill();
}
process.exit(failedStep ? 1 : 0);
