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
  getClaim,
  upsertBounty,
  type BountyRecord,
} from "./store";
import { JOB_EXPIRY_MS } from "./claim";
import { createJobTx } from "./sweep-chain";
import { checkFundCaps } from "./fund-caps";

// Caps + CapBlock live in fund-caps.ts (300-line file cap) — re-export
// keeps the public surface of this module unchanged.
export {
  BOUNTY_MIN_USDC,
  BOUNTY_MAX_USDC,
  BOUNTY_DAILY_CAP_USDC,
  BOUNTY_WEEKLY_CAP_USDC,
  fundedSince,
  checkFundCaps,
  type CapBlock,
} from "./fund-caps";

export const BOUNTY_ENABLED = () => process.env.BOUNTY_ENABLED === "true";

// ─── Fund ──────────────────────────────────────────────────────

// 197-16 C-2: serialize cap-check → tx → transition-log (cap race fix).
let _fundTail: Promise<unknown> = Promise.resolve();
function withFundLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = _fundTail.then(fn);
  _fundTail = run.catch(() => { });
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
    return {
      ok: false, status: 503, code: "bounty_disabled" as ErrorCode,
      message: "bounty funding disabled (BOUNTY_ENABLED)"
    };
  }
  const net = (deps.network ?? resolveVenueNetwork)();
  const now = (deps.now ?? Date.now)();

  const bounty = getBounty(bountyId);
  if (!bounty) {
    return {
      ok: false, status: 404, code: ErrorCodes.RESOURCE_NOT_FOUND,
      message: "unknown bountyId"
    };
  }
  // 197-19 e2e: circle ordering is claim-first — provider is bound at
  // createJob inside claim, then the client funds the escrow while the
  // bounty is already "claimed". Funding is not a lifecycle transition,
  // it only marks chainTxs.funded — allow open|claimed.
  if (bounty.status !== "open" && bounty.status !== "claimed") {
    return {
      ok: false, status: 409, code: ErrorCodes.INVALID_STATE,
      message: `cannot fund bounty in status "${bounty.status}"`
    };
  }
  const amount = Number(bounty.budgetUsdc);
  const caps = checkFundCaps(amount, now);
  if (!caps.ok) {
    return {
      ok: false, status: 402, code: ErrorCodes.SPEND_CAP,
      message: caps.message
    };
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
      // 197-19 e2e: circle's createJob requires provider != 0x0 — take it
      // from the attempt's claim (payoutWallet). For an unclaimed open
      // bounty there is no provider to bind → fund cannot create a job.
      const provider =
        net.variant === "circle"
          ? (getClaim(record.bountyId, record.jobAttempt)
            ?.payoutWallet as `0x${string}` | undefined)
          : undefined;
      if (net.variant === "circle" && !provider) {
        return {
          ok: false, status: 409,
          code: ErrorCodes.INVALID_STATE,
          message: "job must be created at claim (provider binding)"
        };
      }
      const createTx = createJobTx(net, record, JOB_EXPIRY_MS(), now,
        undefined, provider);
      const hashes = await send([createTx]);
      txHash = hashes?.[0];
      if (!txHash) {
        return {
          ok: false, status: 502,
          code: ErrorCodes.INVALID_STATE,
          message: "createJob send failed"
        };
      }
      // Committed onchain — persist before the decode can fail.
      record = {
        ...record,
        chainTxs: { ...record.chainTxs, created: txHash }
      };
      upsertBounty(record);
    }
    const fetchId =
      deps.fetchJobId ??
      ((h: Hex, n: VenueNetwork) => fetchCreatedJobId(h, n));
    const jobId = await fetchId(txHash as Hex, net);
    if (jobId == null) {
      return {
        ok: false, status: 502,
        code: ErrorCodes.INVALID_STATE,
        message: "JobCreated not found in createJob receipt"
      };
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
    return {
      ok: false, status: 502, code: ErrorCodes.INVALID_STATE,
      message: "onchainJobId missing after createJob"
    };
  }
  const txs = buildActionTxs(net, "fund", {
    onchainJobId: BigInt(jobIdStr),
    amountUsdc: amount,
  });
  const hashes = await send(txs);
  if (!hashes?.length) {
    return {
      ok: false, status: 502, code: ErrorCodes.INVALID_STATE,
      message: "fund send failed"
    };
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
