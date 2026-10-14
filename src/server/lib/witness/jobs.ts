/**
 * SLICE-185-2 (EPIC-185): minimal job view the witness API needs.
 *
 * The witness layer does not own job records — producers (EaaS job
 * creation / delivery hooks, 185-3 surface) project the COI-relevant
 * fields into this shape. v1 source: a JSON registry at
 * .data/witness-jobs.json written via upsertWitnessJob.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { mutexFor } from "./mutex";

export interface WitnessJobRef {
  jobId: string;
  /** ERC-8004 agentId of the job requester (COI). */
  requesterAgentId?: string;
  buyerAgentId?: string;
  evaluatorAgentId?: string;
  /** Wallet of the job requester (COI — sybil-proof dimension). */
  requesterWallet?: string;
  buyerWallet?: string;
  evaluatorWallet?: string;
  /** ms epoch of delivery — attest window opens here (WITNESS_WINDOW_SEC). */
  deliveredAt?: number;
  /** Buyer opt-out: false blocks seat claims (D-185-5 → witness_opt_out). */
  witnessAllowed?: boolean;
  /** SLICE-185-3: evaluator verdict echoed on the public advisory read. */
  evaluatorVerdict?: string;
  /** On-chain deliverableHash (keccak or client-supplied 0x64hex) —
   *  projected at submit time; used to flag witness hash mismatches (M-1). */
  deliverableHash?: `0x${string}`;
}

/** Canonical projection path — producers + wiring share this default. */
export const WITNESS_JOBS_PATH = join(
  process.cwd(),
  ".data",
  "witness-jobs.json",
);

export interface WitnessJobSource {
  getJob(jobId: string): Promise<WitnessJobRef | undefined>;
}

function readJobs(path: string): Record<string, WitnessJobRef> {
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      jobs?: Record<string, WitnessJobRef>;
    };
    return raw.jobs ?? {};
  } catch {
    return {};
  }
}

/** Read-through source over .data/witness-jobs.json. */
export function createJsonWitnessJobSource(
  path = WITNESS_JOBS_PATH,
): WitnessJobSource {
  return {
    async getJob(jobId) {
      return readJobs(path)[jobId];
    },
  };
}

/**
 * Delivery-time projection (venue submit hook): opens the attest window
 * and projects the on-chain hash for the M-1 mismatch flag.
 * witnessAllowed is re-echoed when set (M-4) — belt-and-suspenders
 * alongside the undefined-strip inside upsertWitnessJob.
 */
export async function projectWitnessDelivery(
  jobId: string,
  deliverableHash: `0x${string}`,
  witnessAllowed?: boolean,
  path = WITNESS_JOBS_PATH,
): Promise<void> {
  return upsertWitnessJob(path, {
    jobId,
    deliveredAt: Date.now(),
    deliverableHash,
    ...(witnessAllowed === false ? { witnessAllowed: false } : {}),
  });
}

/**
 * Producer-side write hook (185-3 / job delivery). Read-modify-write is
 * process-serialized by a per-path mutex (mutex.ts) — same pattern as
 * the store backends. Without it, two concurrent deliveries can
 * last-write-wins and silently drop a whole WitnessJobRef including
 * witnessAllowed:false (audit C-2).
 */
export async function upsertWitnessJob(
  path: string,
  job: WitnessJobRef,
): Promise<void> {
  return mutexFor(path)(async () => {
    // M-4: drop undefined-valued keys from the patch — a partial upsert
    // (deliveredAt-only at submit) must not clobber a stored
    // witnessAllowed:false back to undefined and reopen the opt-out gate.
    const patch = Object.fromEntries(
      Object.entries(job).filter(([, v]) => v !== undefined),
    ) as WitnessJobRef;
    const jobs = readJobs(path);
    jobs[job.jobId] = { ...(jobs[job.jobId] ?? {}), ...patch };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ jobs }, null, 2));
  });
}
