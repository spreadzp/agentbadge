/**
 * SLICE-197-11: fund bounty — caps + BOUNTY_ENABLED master gate.
 *
 * Ops-signer (client role) funds the onchain job escrow
 * ($1–5 per bounty). The flow is lazy: when the bounty has no
 * onchainJobId yet, createJob is sent first and the jobId decoded
 * from the JobCreated event (topics[1] on both ABI variants).
 *
 * Caps (Q11): single-bounty budget window plus rolling daily/weekly
 * spend totals across all funded bounties — evaluated BEFORE any tx,
 * so an over-cap attempt returns 402 spend_cap without touching the
 * chain (VULN-11 discipline: solvency checks live off-chain too).
 * Rolling usage is reconstructed from the transition audit log
 * (reason "funded", payload.amount) — no separate ledger.
 *
 * BOUNTY_ENABLED=false → every money handle is off.
 * Idempotent: chainTxs.funded or onchain status ≥ Funded → same
 * result, no duplicate approve.
 */
import { parseUnits, type Hex } from "viem";
import { logger } from "@agentbadge/passport";

import { ErrorCodes, type ErrorCode } from "../error-codes";
import {
  fetchCreatedJobId,
  fetchOnchainJob,
  resolveVenueNetwork,
  type OnchainJob,
  type VenueNetwork,
} from "../venue/chain";
import {
  buildActionTxs,
  sendAsRole,
  type PreparedTx,
} from "../venue/lifecycle";
import {
  appendTransition,
  getBounty,
  listBounties,
  listTransitions,
  upsertBounty,
  type BountyRecord,
} from "./store";
import { createJobTx } from "./sweep-chain";

// ─── Config / caps ─────────────────────────────────────────────

export const BOUNTY_ENABLED = () => process.env.BOUNTY_ENABLED === "true";
export const BOUNTY_MIN_USDC = () =>
  Number(process.env.BOUNTY_MIN_USDC ?? 1);
export const BOUNTY_MAX_USDC = () =>
  Number(process.env.BOUNTY_MAX_USDC ?? 5);
export const BOUNTY_DAILY_CAP_USDC = () =>
  Number(process.env.BOUNTY_DAILY_CAP_USDC ?? 25);
export const BOUNTY_WEEKLY_CAP_USDC = () =>
  Number(process.env.BOUNTY_WEEKLY_CAP_USDC ?? 100);

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Funded USDC inside a rolling window, from the transition log. */
export function fundedSince(fromMs: number, now: number): number {
  let sum = 0;
  for (const b of listAllFunded()) {
    if (b.atMs >= fromMs && b.atMs <= now) sum += b.amount;
  }
  return sum;
}

function listAllFunded(): { atMs: number; amount: number }[] {
  const out: { atMs: number; amount: number }[] = [];
  for (const b of listBountiesAll()) {
    for (const t of listTransitions(b.bountyId)) {
      if (t.reason === "funded") {
        const amount = Number(
          (t.payload as { amount?: unknown })?.amount ?? 0,
        );
        if (Number.isFinite(amount) && amount > 0) {
          out.push({ atMs: t.atMs, amount });
        }
      }
    }
  }
  return out;
}

function listBountiesAll(): BountyRecord[] {
  return [
    ...listBounties({ status: "open" }),
    ...listBounties({ status: "claimed" }),
    ...listBounties({ status: "submitted" }),
    ...listBounties({ status: "passed" }),
    ...listBounties({ status: "failed" }),
    ...listBounties({ status: "rejected" }),
    ...listBounties({ status: "expired" }),
  ];
}

export type CapBlock =
  | { ok: true }
  | {
      ok: false;
      code: "spend_cap";
      cap: "single" | "daily" | "weekly";
      limit: number;
      used?: number;
      message: string;
    };

/** Caps evaluated before any contract call. */
export function checkFundCaps(
  amountUsdc: number,
  now: number,
): CapBlock {
  if (amountUsdc < BOUNTY_MIN_USDC() || amountUsdc > BOUNTY_MAX_USDC()) {
    return {
      ok: false, code: "spend_cap" as const, cap: "single",
      limit: BOUNTY_MAX_USDC(),
      message:
        `bounty budget ${amountUsdc} outside ` +
        `[${BOUNTY_MIN_USDC()}, ${BOUNTY_MAX_USDC()}] USDC`,
    };
  }
  const daily = fundedSince(now - DAY_MS, now);
  if (daily + amountUsdc > BOUNTY_DAILY_CAP_USDC()) {
    return {
      ok: false, code: "spend_cap" as const, cap: "daily",
      limit: BOUNTY_DAILY_CAP_USDC(), used: daily,
      message: `daily fund cap: ${daily} + ${amountUsdc} > ${BOUNTY_DAILY_CAP_USDC()}`,
    };
  }
  const weekly = fundedSince(now - WEEK_MS, now);
  if (weekly + amountUsdc > BOUNTY_WEEKLY_CAP_USDC()) {
    return {
      ok: false, code: "spend_cap" as const, cap: "weekly",
      limit: BOUNTY_WEEKLY_CAP_USDC(), used: weekly,
      message: `weekly fund cap: ${weekly} + ${amountUsdc} > ${BOUNTY_WEEKLY_CAP_USDC()}`,
    };
  }
  return { ok: true };
}

// ─── Fund ──────────────────────────────────────────────────────

// 197-16 C-2: serialize cap-check → tx → transition-log (cap race fix).
let _fundTail: Promise<unknown> = Promise.resolve();
function withFundLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = _fundTail.then(fn);
  _fundTail = run.catch(() => {});
  return run;
}

export interface FundDeps {
  network?: () => VenueNetwork;
  now?: () => number;
  /** Client-role sender (ops signer funds the escrow). */
  send?: (txs: PreparedTx[]) => Promise<Hex[] | null>;
  readJob?: (jobId: number, net: VenueNetwork) => Promise<OnchainJob | null>;
  fetchJobId?: (txHash: Hex, net: VenueNetwork) => Promise<number | null>;
  enabled?: boolean;
}

export type FundResult =
  | {
      ok: true;
      bounty: BountyRecord;
      txs?: PreparedTx[];
      txHashes?: Hex[];
      idempotent?: boolean;
    }
  | { ok: false; status: number; code: ErrorCode | "spend_cap"; message: string };

export async function fundBounty(
  bountyId: string,
  deps: FundDeps = {},
): Promise<FundResult> {
  return withFundLock(() => fundBountyLocked(bountyId, deps));
}

async function fundBountyLocked(
  bountyId: string,
  deps: FundDeps = {},
): Promise<FundResult> {
  const enabled = deps.enabled ?? BOUNTY_ENABLED();
  if (!enabled) {
    return { ok: false, status: 503, code: "bounty_disabled" as ErrorCode,
      message: "bounty funding disabled (BOUNTY_ENABLED)" };
  }
  const net = (deps.network ?? resolveVenueNetwork)();
  const now = (deps.now ?? Date.now)();

  const bounty = getBounty(bountyId);
  if (!bounty) {
    return { ok: false, status: 404, code: ErrorCodes.RESOURCE_NOT_FOUND,
      message: "unknown bountyId" };
  }
  if (bounty.status !== "open") {
    return { ok: false, status: 409, code: ErrorCodes.INVALID_STATE,
      message: `cannot fund bounty in status "${bounty.status}"` };
  }
  const amount = Number(bounty.budgetUsdc);
  const caps = checkFundCaps(amount, now);
  if (!caps.ok) {
    return { ok: false, status: 402, code: ErrorCodes.SPEND_CAP,
      message: caps.message };
  }

  const send =
    deps.send ??
    ((txs) => sendAsRole("client", txs, net.chain.rpcUrl));
  let record = bounty;

  // Lazy job creation; 197-16 H-3: persist createTx BEFORE decode —
  // a retry after an RPC hiccup re-decodes instead of re-sending.
  if (!record.onchainJobId) {
    let txHash = record.chainTxs?.created;
    if (!txHash) {
      const createTx = createJobTx(net, record, 0);
      const hashes = await send([createTx]);
      txHash = hashes?.[0];
      if (!txHash) {
        return { ok: false, status: 502,
          code: ErrorCodes.INVALID_STATE,
          message: "createJob send failed" };
      }
      // Committed onchain — persist before the decode can fail.
      record = { ...record,
        chainTxs: { ...record.chainTxs, created: txHash } };
      upsertBounty(record);
    }
    const fetchId =
      deps.fetchJobId ??
      ((h: Hex, n: VenueNetwork) => fetchCreatedJobId(h, n));
    const jobId = await fetchId(txHash as Hex, net);
    if (jobId == null) {
      return { ok: false, status: 502,
        code: ErrorCodes.INVALID_STATE,
        message: "JobCreated not found in createJob receipt" };
    }
    record = { ...record, onchainJobId: String(jobId) };
    upsertBounty(record);
  }

  // Idempotent: already funded onchain or recorded → no duplicate.
  if (record.chainTxs?.funded) {
    return { ok: true, bounty: record, idempotent: true };
  }
  const readJob =
    deps.readJob ??
    ((id: number, n: VenueNetwork) => fetchOnchainJob(id, n));
  const job = await readJob(Number(record.onchainJobId), net);
  if (job && job.status >= 1) {
    // Onchain Funded/Submitted — treat as funded without re-sending.
    record = { ...record };
    upsertBounty(record);
    return { ok: true, bounty: record, idempotent: true };
  }

  const jobIdStr = record.onchainJobId;
  if (!jobIdStr) {
    return { ok: false, status: 502, code: ErrorCodes.INVALID_STATE,
      message: "onchainJobId missing after createJob" };
  }
  const txs = buildActionTxs(net, "fund", {
    onchainJobId: BigInt(jobIdStr),
    amountUsdc: amount,
  });
  const hashes = await send(txs);
  if (!hashes?.length) {
    return { ok: false, status: 502, code: ErrorCodes.INVALID_STATE,
      message: "fund send failed" };
  }
  const fundedTx = hashes[hashes.length - 1];
  record = {
    ...record,
    chainTxs: { ...record.chainTxs, funded: fundedTx },
  };
  upsertBounty(record);
  appendTransition({
    id: `${record.bountyId}:${record.jobAttempt}:funded:${now}`,
    bountyId: record.bountyId,
    actor: "ops",
    from: "open",
    to: "open",
    reason: "funded",
    atMs: now,
    payload: {
      amount,
      txHash: fundedTx,
      onchainJobId: record.onchainJobId,
      budgetWei: parseUnits(String(amount), 6).toString(),
    },
  });
  logger.info("bounty funded", {
    bountyId: record.bountyId,
    amount,
    onchainJobId: record.onchainJobId,
  });
  return { ok: true, bounty: record, txHashes: hashes };
}
