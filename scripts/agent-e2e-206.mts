/**
 * SLICE-206-7: foreign-agent e2e against our own marketplace contour.
 *
 * Three freshly generated burner wallets walk the whole agent path:
 *   discovery (well-known + /api/tasks/open + /mcp/public)
 *   → machine_entry read → sig-auth bid → owner award → deliver
 *   → independent verdict → verify-status (payment-ready)
 *
 * Honesty contract (landmine): signatures are REAL — every write header
 * is an EIP-191 signature verified by the production
 * verifyWalletSigRequest → viem verifyMessage. The only shortcut is
 * transport: an in-process Hono app mounting the production route
 * modules (no TCP). Nothing is stubbed on the auth path.
 *
 * Output (evidence/): redacted transcript JSON + run log.
 *   bun scripts/agent-e2e-206.mts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { Hono } from "hono";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { marketClear, marketUpsert } from "@agentbadge/passport";
import type { CachedMarketTask } from "@agentbadge/hedera-core";
import { wellKnownRoutes } from "../src/server/routes/well-known";
import { tasksReadRoutes } from "../src/server/routes/tasks-read";
import { tasksWriteRoutes } from "../src/server/routes/tasks-write";
import { tasksWriteFlowRoutes } from "../src/server/routes/tasks-write-flow";
import { mcpPublicRoutes } from "../src/server/routes/mcp-public";
import { buildAccessChallenge } from "../src/server/middleware/agent-auth";
import { resetBidStoresForTesting } from "../src/server/lib/tasks/bids";
import { resetIdempotencyStore } from "../src/server/lib/contract-guards";
import { setPlatformSignersForTesting } from "../src/server/lib/tasks/verdict";

const EVIDENCE_DIR = new URL(
  "../../../docs/EPICS/206-marketplace-agent-interop/evidence/",
  import.meta.url,
).pathname;
const TODAY = "2026-11-05";

// ─── Burners (generated per run — never prod keys) ───────────────

function burner() {
  return privateKeyToAccount(generatePrivateKey());
}
const owner = burner();
const bidder = burner();
const verifier = burner();
// A fourth key acts as the "platform signer" set the verifier must
// not equal — proving VERIFIER_IS_PLATFORM is a real check.
const platform = burner();

// ─── App = production route modules, real middleware ─────────────

const app = new Hono()
  .route("/", wellKnownRoutes)
  .route("/", tasksReadRoutes)
  .route("/", tasksWriteRoutes)
  .route("/", tasksWriteFlowRoutes)
  .route("/", mcpPublicRoutes);

marketClear();
resetBidStoresForTesting();
resetIdempotencyStore();
setPlatformSignersForTesting([platform.address]);

const task: CachedMarketTask = {
  taskId: "e2e_task_1",
  posterDid: owner.address, // wallet-shaped owner identity (agent contour)
  title: "review our agent-readiness report",
  description: "AC: markdown summary + link to scan output",
  priceHbar: 5,
  capabilities: ["code-review"],
  status: "posted",
  txId: "0.0.9999@1",
  consensusTimestamp: "1.0",
  createdAt: Date.now(),
};
marketUpsert(task);

// Second task already in delivered state — the platform-signer probe
// needs a verdict-eligible target (task_1 is completing by then).
marketUpsert({
  ...task,
  taskId: "e2e_task_2",
  status: "delivered",
  claimerDid: bidder.address.toLowerCase(),
  resultBody: "delivered work",
});

// ─── Transcript ──────────────────────────────────────────────────

interface Entry {
  step: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  request_body?: unknown;
  response?: unknown;
  assertion?: string;
}
const entries: Entry[] = [];
const log: string[] = [];

async function signedHeaders(
  acct: { address: `0x${string}`; signMessage: (a: { message: string }) => Promise<`0x${string}`> },
  method: string,
  path: string,
) {
  const timestamp = Math.floor(Date.now() / 1000);
  const challenge = buildAccessChallenge({
    wallet: acct.address,
    method,
    path,
    timestamp,
  });
  const signature = await acct.signMessage({ message: challenge });
  return {
    "x-wallet": acct.address,
    "x-sig": signature,
    "x-timestamp": String(timestamp),
  };
}

let runId = 0;
async function step(
  name: string,
  method: string,
  path: string,
  opts: {
    signer?: Awaited<ReturnType<typeof signedHeaders>>;
    body?: unknown;
    idem?: boolean;
    expect?: number;
    assert?: (body: unknown) => void;
  } = {},
): Promise<Record<string, unknown>> {
  runId += 1;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (opts.signer) Object.assign(headers, opts.signer);
  if (opts.idem) headers["idempotency-key"] = `e2e-${TODAY}-${name}-${runId}`;

  const t0 = performance.now();
  const res = await app.request(path, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const ms = Math.round(performance.now() - t0);
  const body = (await res.json().catch(() => null)) as Record<string, unknown>;

  if (opts.expect !== undefined && res.status !== opts.expect) {
    const msg = `FAIL ${name}: status ${res.status} ≠ ${opts.expect} — ${JSON.stringify(body)}`;
    log.push(msg);
    throw new Error(msg);
  }
  let assertion: string | undefined;
  if (opts.assert) {
    try {
      opts.assert(body);
      assertion = "pass";
    } catch (err) {
      assertion = `FAIL: ${err instanceof Error ? err.message : String(err)}`;
      log.push(`FAIL ${name} assertion: ${assertion}`);
      throw new Error(`assert ${name}: ${assertion}`);
    }
  }

  entries.push({
    step: name,
    method,
    path,
    status: res.status,
    ms,
    request_body: opts.body,
    response: body,
    assertion,
  });
  log.push(`${name.padEnd(16)} ${method} ${path} → ${res.status} (${ms}ms)`);
  return body ?? {};
}

// ─── The foreign-agent path ──────────────────────────────────────

async function sign(acct: typeof owner, method: string, path: string) {
  return signedHeaders(acct as never, method, path);
}

async function main() {
  // 1. discover — global descriptor (keyless)
  await step("discover", "GET", "/.well-known/agentbadge-machine.json", {
    expect: 200,
    assert: (b: unknown) => {
      const d = b as { protocol_version: string; endpoints: { phase: string }[] };
      if (!d.protocol_version) throw new Error("no protocol_version");
      if (!d.endpoints.some((e) => e.phase === "verdict")) {
        throw new Error("descriptor missing verdict phase");
      }
    },
  });

  // 2. open tasks (keyless)
  await step("open-tasks", "GET", "/api/tasks/open", {
    expect: 200,
    assert: (b: unknown) => {
      const o = b as { tasks: { task_id: string; budget_status: string }[] };
      if (!o.tasks.some((t) => t.task_id === "e2e_task_1")) {
        throw new Error("seed task not in open list");
      }
    },
  });

  // 3. read task + machine_entry (keyless)
  await step("read-task", "GET", "/api/tasks/e2e_task_1", {
    expect: 200,
    assert: (b: unknown) => {
      const d = b as { machine_entry?: { calls: { path: string }[] } };
      if (!d.machine_entry?.calls.some((c) => c.path.endsWith("/verdict"))) {
        throw new Error("machine_entry lacks verdict call");
      }
    },
  });

  // 4. MCP facade discovery channel (keyless)
  await step("mcp-tools", "POST", "/mcp/public", {
    body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    expect: 200,
    assert: (b: unknown) => {
      const r = b as { result: { tools: { name: string }[] } };
      const names = r.result.tools.map((t) => t.name);
      if (!names.includes("open_tasks")) throw new Error("open_tasks missing");
      if (names.some((n) => /bid|deliver|verdict/.test(n))) {
        throw new Error("write tool leaked into public facade");
      }
    },
  });
  await step("mcp-open-tasks", "POST", "/mcp/public", {
    body: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "open_tasks", arguments: {} },
    },
    expect: 200,
  });

  // 5. bid — external burner, sig-auth, no registration
  const bidRes = await step("bid", "POST", "/api/tasks/e2e_task_1/bids", {
    signer: await sign(bidder, "POST", "/api/tasks/e2e_task_1/bids"),
    idem: true,
    body: { price: 4.5, eta_seconds: 3600, note: "review today" },
    expect: 200,
    assert: (b: unknown) => {
      const r = b as { bid_id?: string; status?: string };
      if (!r.bid_id || r.status !== "submitted") {
        throw new Error("bid not SUBMITTED");
      }
    },
  });
  const bidId = (bidRes as { bid_id: string }).bid_id;

  // 6. award — owner picks the bid (= claim commit)
  await step("award", "POST", "/api/tasks/e2e_task_1/awards", {
    signer: await sign(owner, "POST", "/api/tasks/e2e_task_1/awards"),
    idem: true,
    body: { bid_id: bidId },
    expect: 200,
    assert: (b: unknown) => {
      const r = b as { status?: string; worker?: string };
      if (r.status !== "claimed" || r.worker !== bidder.address.toLowerCase()) {
        throw new Error("award did not claim task for bidder");
      }
    },
  });

  // 7. deliver — awarded worker submits
  await step("deliver", "POST", "/api/tasks/e2e_task_1/deliverables", {
    signer: await sign(bidder, "POST", "/api/tasks/e2e_task_1/deliverables"),
    idem: true,
    body: {
      summary: "Review delivered: 3 findings, summary markdown attached",
      evidence_refs: ["ipfs://e2e-review-report.md"],
    },
    expect: 200,
  });

  // 8. verdict — independent third burner, real independence check
  await step("verdict-pass", "POST", "/api/tasks/e2e_task_1/verdict", {
    signer: await sign(verifier, "POST", "/api/tasks/e2e_task_1/verdict"),
    idem: true,
    body: { verdict: "PASS", note: "acceptance criteria met" },
    expect: 200,
  });

  // 9. verify-status — public probe (keyless)
  await step("verify-status", "GET", "/api/tasks/e2e_task_1/status", {
    expect: 200,
    assert: (b: unknown) => {
      const s = b as { status: string; budget_status: string };
      if (s.status !== "completing") {
        throw new Error(`expected completing (payment-ready), got ${s.status}`);
      }
    },
  });

  // 10. negative probe — platform signer cannot verdict (invariant).
  //     Needs a delivered-state target: task_1 is 'completing' by now,
  //     and the state gate would legitimately 400 before the check.
  await step("verdict-denied", "POST", "/api/tasks/e2e_task_2/verdict", {
    signer: await sign(platform, "POST", "/api/tasks/e2e_task_2/verdict"),
    idem: true,
    body: { verdict: "FAIL" },
    expect: 403,
    assert: (b: unknown) => {
      const r = b as { code?: string };
      if (r.code !== "VERIFIER_IS_PLATFORM") {
        throw new Error(`expected VERIFIER_IS_PLATFORM, got ${r.code}`);
      }
    },
  });
}

// ─── Output ──────────────────────────────────────────────────────

const started = performance.now();
try {
  await main();
} catch (err) {
  log.push(`ABORT: ${err instanceof Error ? err.message : String(err)}`);
}
const totalMs = Math.round(performance.now() - started);
const ok = entries.length === 11 && !log.some((l) => l.startsWith("FAIL") || l.startsWith("ABORT"));

mkdirSync(EVIDENCE_DIR, { recursive: true });
const transcript = {
  run: "agent-e2e-206",
  recorded_at: new Date().toISOString(),
  transport: "in-process Hono app — production routes + middleware; real EIP-191 signatures",
  actors: {
    owner: owner.address,
    bidder: bidder.address,
    verifier: verifier.address,
    platform_signer: platform.address,
    note: "throwaway burners, generated per run; no secrets",
  },
  entries,
  result: ok ? "PASS" : "FAIL",
  total_ms: totalMs,
};
writeFileSync(
  `${EVIDENCE_DIR}agent-e2e-transcript-${TODAY}.json`,
  JSON.stringify(transcript, null, 2),
);
writeFileSync(
  `${EVIDENCE_DIR}agent-e2e-run-${TODAY}.log`,
  [`agent-e2e-206 run log (${transcript.recorded_at})`, "", ...log, "", `result: ${ok ? "PASS" : "FAIL"} (${totalMs}ms)`].join("\n"),
);

console.log(log.join("\n"));
console.log(`\nresult: ${ok ? "PASS" : "FAIL"} (${totalMs}ms) — transcript → evidence/agent-e2e-transcript-${TODAY}.json`);
process.exit(ok ? 0 : 1);
