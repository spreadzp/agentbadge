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
 * Producer-side write hook (185-3 / job delivery). Read-modify-write is
 * process-serialized by a module mutex per path — same pattern as the
 * store backends.
 */
export async function upsertWitnessJob(
  path: string,
  job: WitnessJobRef,
): Promise<void> {
  const jobs = readJobs(path);
  jobs[job.jobId] = { ...(jobs[job.jobId] ?? {}), ...job };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ jobs }, null, 2));
}
