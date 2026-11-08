#!/usr/bin/env bun
/**
 * SLICE-216-1 (D-216-2/D-216-3): supply-chain live dogfood scaffold —
 * "Proof of Freshness" lite, a 3-hop chain:
 *
 *   hop0: org(FishCo)    → agent(Plant)    — evidence[GPS, temp-log hash, signature]
 *   hop1: agent(Plant)   → device(ColdVan)  — evidence[temp-log, dropoff signature]
 *   hop2: device(ColdVan)→ org(Restaurant)  — receiver-accept + verify + settle
 *
 * Modes:
 *   --dry-run (default)  InMemoryHopExecutor + in-memory ledger, no keys,
 *                        deterministic addresses. Audit/e2e run on this path.
 *   --live               Erc8183HopExecutor on the resolved Arc network.
 *                        Wired end-to-end here; the actual run is SLICE-216-4
 *                        (procedural gate: audit 216-2 + fixes 216-3, D-216-1).
 *
 * Env (live only — secrets stay in .env, never in output):
 *   SC_DOGFOOD_ORG_KEY        — org/client privkey; signs createJob+fund as
 *                               the venue "client" role.
 *   SC_DOGFOOD_EVAL_KEY       — ops evaluator privkey (settles = "evaluator"
 *                               role). Falls back to ARC_VENUE_EVALUATOR_KEY /
 *                               ARC_OPS_KEY resolution.
 *   SC_DOGFOOD_AGENT_KEY|ADDR — hop0 receiver (key wins over addr).
 *   SC_DOGFOOD_DEVICE_KEY|ADDR — hop1 receiver.
 *   SC_DOGFOOD_RESTAURANT_ADDR — hop2 receiver; defaults to org (3-wallet
 *                               dogfood, D-211-10).
 *   SC_DOGFOOD_HOP_USDC       — comma amounts, default "0.01,0.01,0.01".
 *   ARC_RPC_URL               — https + allowlist-validated in
 *                               resolveVenueNetwork (C-2).
 *
 * Output: stdout = ONE JSON document — {mode, shipmentId, client, plan,
 * jobs[{hopIndex,jobId,createTxHash?,settleTxHash?,status}], status,
 * aggregate, replay}. Progress goes to stderr. Output and errors are
 * scrubbed of the exact env-sourced secret values (pattern redaction is
 * unsafe here — 0x+64hex is the legitimate shape of tx/evidence hashes).
 */

import { privateKeyToAccount } from "viem/accounts";
import { makeChain } from "../tests/supply-chain/helpers/chain-fixture";
import {
  Erc8183HopExecutor,
  InMemoryHopExecutor,
} from "../src/server/lib/econ-ledger/supply-chain/executor";
import type {
  HopJobExecutor,
  HopJobRef,
  HopJobSpec,
} from "../src/server/lib/econ-ledger/supply-chain/types";
import { shipmentReplay } from "../src/server/lib/econ-ledger/supply-chain/replay";
import { resolveVenueNetwork } from "../src/server/lib/venue/chain";
import { serverRoleAddress } from "../src/server/lib/venue/lifecycle-sign";

const log = (msg: string) => console.error(`[dogfood] ${msg}`);
const fail = (msg: string): never => {
  console.error(`[dogfood] FATAL ${msg}`);
  process.exit(1);
};

/** Every secret value the run sourced from env — collected so the
 *  serialized output can be scrubbed of exactly those strings. Pattern
 *  redaction is NOT used: 0x+64hex legitimately appears in tx hashes and
 *  evidence hashes, so a broad regex would eat the evidence artifact. */
const SECRETS: string[] = [];

function scrub(doc: unknown): string {
  let s = JSON.stringify(doc);
  for (const k of SECRETS) {
    if (!k) continue;
    s = s.split(k).join("[REDACTED]");
    if (k.startsWith("0x")) s = s.split(k.slice(2)).join("[REDACTED]");
  }
  return s;
}

// ─── flags ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const live = args.includes("--live");
const shipmentId =
  args.find((a) => a.startsWith("--shipment-id="))?.split("=")[1] ??
  `dogfood-${Date.now()}`;
const amountArg = args.find((a) => a.startsWith("--amount="))?.split("=")[1];

// ─── config ────────────────────────────────────────────────────────
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const KEY_RE = /^0x[0-9a-fA-F]{64}$/;
const DRY = {
  org: `0x${"aa".repeat(20)}`,
  agent: `0x${"bb".repeat(20)}`,
  device: `0x${"cc".repeat(20)}`,
} as const;

interface DogfoodConfig {
  client: `0x${string}`;
  agent: `0x${string}`;
  device: `0x${string}`;
  restaurant: `0x${string}`;
  hopUsdc: [string, string, string];
  executor: HopJobExecutor;
}

function hopAmounts(): [string, string, string] {
  const raw = amountArg
    ? `${amountArg},${amountArg},${amountArg}`
    : process.env.SC_DOGFOOD_HOP_USDC ?? "0.01,0.01,0.01";
  const parts = raw.split(",").map((s) => s.trim());
  if (parts.length !== 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) {
    fail(`SC_DOGFOOD_HOP_USDC must be 3 decimal amounts: ${raw}`);
  }
  return parts as [string, string, string];
}

/** Receivers take a key (address derived) or a plain address. */
function partyAddr(keyEnv: string, addrEnv: string): `0x${string}` | null {
  const key = process.env[keyEnv];
  if (key && KEY_RE.test(key)) {
    SECRETS.push(key);
    return privateKeyToAccount(key as `0x${string}`).address;
  }
  const addr = process.env[addrEnv];
  if (addr && ADDR_RE.test(addr)) return addr as `0x${string}`;
  return null;
}

function loadConfig(): DogfoodConfig {
  const hopUsdc = hopAmounts();
  if (!live) {
    return {
      client: DRY.org as `0x${string}`,
      agent: DRY.agent as `0x${string}`,
      device: DRY.device as `0x${string}`,
      restaurant: DRY.org as `0x${string}`,
      hopUsdc,
      executor: new InMemoryHopExecutor(),
    };
  }
  // Live: the script's env is authoritative for its own run — map the
  // dogfood keys onto the venue role envs sendAsRole resolves.
  const orgKey = process.env.SC_DOGFOOD_ORG_KEY ?? "";
  if (!KEY_RE.test(orgKey)) {
    fail("SC_DOGFOOD_ORG_KEY required (0x + 64 hex) — org funds the hop jobs");
  }
  SECRETS.push(orgKey);
  process.env.ARC_VENUE_CLIENT_KEY = orgKey;
  const evalKey = process.env.SC_DOGFOOD_EVAL_KEY ?? "";
  if (evalKey) {
    if (!KEY_RE.test(evalKey)) fail("SC_DOGFOOD_EVAL_KEY must be 0x + 64 hex");
    SECRETS.push(evalKey);
    process.env.ARC_VENUE_EVALUATOR_KEY = evalKey;
  }
  const client = privateKeyToAccount(orgKey as `0x${string}`).address;
  if (serverRoleAddress("client")?.toLowerCase() !== client.toLowerCase()) {
    fail("client role blocked by ARC_VENUE_SERVER_WALLETS allowlist — add the org address");
  }
  const evaluatorAddr = serverRoleAddress("evaluator");
  if (!evaluatorAddr) {
    fail("no evaluator key — set SC_DOGFOOD_EVAL_KEY or ARC_OPS_KEY (ops evaluator EOA)");
  }
  const agent = partyAddr("SC_DOGFOOD_AGENT_KEY", "SC_DOGFOOD_AGENT_ADDR");
  const device = partyAddr("SC_DOGFOOD_DEVICE_KEY", "SC_DOGFOOD_DEVICE_ADDR");
  if (!agent) fail("SC_DOGFOOD_AGENT_KEY or SC_DOGFOOD_AGENT_ADDR required");
  if (!device) fail("SC_DOGFOOD_DEVICE_KEY or SC_DOGFOOD_DEVICE_ADDR required");
  const rest = process.env.SC_DOGFOOD_RESTAURANT_ADDR;
  const restaurant = rest && ADDR_RE.test(rest) ? (rest as `0x${string}`) : client;
  // resolveVenueNetwork validates ARC_RPC_URL (https + host allowlist).
  const net = resolveVenueNetwork();
  return {
    client,
    agent: agent!,
    device: device!,
    restaurant,
    hopUsdc,
    executor: new Erc8183HopExecutor(net, net.chain.usdc, net.chain.rpcUrl, evaluatorAddr),
  };
}

// ─── tx-hash capture — evidence for 216-4/216-5 ────────────────────
interface JobRecord {
  hopIndex: number;
  jobId: string;
  createTxHash?: string;
  settleTxHash?: string;
}
class CapturingExecutor implements HopJobExecutor {
  readonly jobs: JobRecord[] = [];
  constructor(private readonly inner: HopJobExecutor) {}
  async createJob(spec: HopJobSpec): Promise<HopJobRef> {
    const ref = await this.inner.createJob(spec);
    this.jobs.push({ hopIndex: spec.hopIndex, jobId: ref.jobId, createTxHash: ref.txHash });
    return ref;
  }
  async settle(jobId: string, amountUsdc: string): Promise<{ txHash?: string }> {
    const r = await this.inner.settle(jobId, amountUsdc);
    const j = this.jobs.find((x) => x.jobId === jobId);
    if (j && r.txHash) j.settleTxHash = r.txHash;
    return r;
  }
}

// ─── run ───────────────────────────────────────────────────────────
try {
const cfg = loadConfig();
const receivers = [cfg.agent, cfg.device, cfg.restaurant];
const hash = (n: number) => `0x${String(n).padStart(64, "0")}` as `0x${string}`;
const exec = new CapturingExecutor(cfg.executor);

log(`mode=${live ? "live" : "dry-run"} shipment=${shipmentId} client=${cfg.client}`);

const chain = await makeChain({
  shipmentId,
  client: cfg.client,
  executor: exec,
  lifecycle: "verified",
  hops: [
    {
      receiver: cfg.agent,
      amountUsdc: cfg.hopUsdc[0],
      what: "chilled fish lot FISH-114 — Bergen salmon, 400kg",
      where: "FishCo cold store, dock 3",
      why: "custody transfer to processing plant",
      roles: {
        custodian: { address: cfg.agent, type: "agent", label: "Plant intake" },
      },
      evidenceRefs: [
        { type: "gps", hash: hash(1), issuer: { address: cfg.agent, type: "agent" } },
        { type: "temperature", hash: hash(2), issuer: { address: cfg.device, type: "device", label: "reefer logger T-9" } },
        { type: "signature", hash: hash(3), issuer: { address: cfg.agent, type: "agent" } },
      ],
      deliverableHash: hash(10),
    },
    {
      receiver: cfg.device,
      amountUsdc: cfg.hopUsdc[1],
      what: "reefer van leg — plant to restaurant",
      where: "city corridor, cold chain 2-4C",
      why: "last-mile transport",
      roles: {
        custodian: { address: cfg.device, type: "device", label: "ColdVan unit" },
      },
      evidenceRefs: [
        { type: "temperature", hash: hash(4), issuer: { address: cfg.device, type: "device" } },
        { type: "signature", hash: hash(5), issuer: { address: cfg.device, type: "device", label: "dropoff signature" } },
      ],
      proofOfDelivery: "pod-coldvan-114",
    },
    {
      receiver: cfg.restaurant,
      amountUsdc: cfg.hopUsdc[2],
      what: "delivery acceptance — lot FISH-114",
      where: "Restaurant receiving dock",
      why: "receiver-accept, verify, settle",
      roles: {
        custodian: { address: cfg.restaurant, type: "org", label: "Restaurant" },
      },
      evidenceRefs: [
        { type: "signature", hash: hash(6), issuer: { address: cfg.restaurant, type: "org", label: "receiver-accept" } },
      ],
      deliverableHash: hash(12),
    },
  ],
});

const state = await chain.state();
const replay = await shipmentReplay(chain.deps.ledger, shipmentId);
if (!replay) fail("replay returned null — the run did not produce a replayable chain");

const evaluatorOf = (i: number): `0x${string}` => receivers[i + 1] ?? cfg.client;
const plan = chain.specs.map((s, i) => ({
  hopIndex: i,
  receiver: s.receiver,
  evaluator: evaluatorOf(i),
  amountUsdc: s.amountUsdc,
}));
const jobs = exec.jobs.map((j) => ({
  ...j,
  status: state.hops.find((h) => h.hopIndex === j.hopIndex)?.status ?? "offered",
}));

const out = {
  mode: live ? "live" : "dry-run",
  shipmentId,
  client: cfg.client,
  plan,
  jobs,
  status: replay.status,
  aggregate: replay.aggregate,
  replay,
};

// The doc contains only public data by construction; scrub drops any
// env-sourced secret value if one ever leaks into a field or error.
console.log(scrub(out));
for (const j of exec.jobs) {
  if (j.createTxHash) log(`hop${j.hopIndex} create tx ${j.createTxHash}`);
  if (j.settleTxHash) log(`hop${j.hopIndex} settle tx ${j.settleTxHash}`);
}
log(`done — status=${replay.status} hops=${jobs.map((j) => j.status).join(",")}`);
} catch (err) {
  // Scrub the error the same way — a live-path failure could echo a
  // configured endpoint or payload.
  fail(scrub(err instanceof Error ? err.message : String(err)));
}
