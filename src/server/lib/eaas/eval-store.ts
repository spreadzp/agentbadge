/**
 * SLICE-154-3: eval-job persistence — one settled evaluation per
 * (chainId, contract, jobId). Idempotency source for the route layer.
 * Extracted from eval.ts (max-lines).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Hex } from "viem";
import type { EvaluationVerdict } from "@agentbadge/circle-payments";

/** One settled evaluation per (chainId, contract, jobId) — idempotency. */
export interface EvalJobRecord {
  key: string;
  contract: `0x${string}`;
  chainId: number;
  jobId: string;
  verdict: EvaluationVerdict;
  verdictId: Hex;
  /** giveFeedback outcome: sent tx / skipped reason / failed. */
  feedbackTx?: string;
  paymentTx?: string;
}

export function evalJobKey(
  chainId: number,
  contract: string,
  jobId: string,
): string {
  return `${chainId}:${contract.toLowerCase()}:${jobId}`;
}

export interface EvalJobStore {
  get(key: string): EvalJobRecord | undefined;
  put(r: EvalJobRecord): void;
  list(): EvalJobRecord[];
}

export function createMemoryEvalStore(): EvalJobStore {
  const map = new Map<string, EvalJobRecord>();
  return {
    get: (k) => map.get(k),
    put: (r) => map.set(r.key, r),
    list: () => [...map.values()],
  };
}

export function createJsonEvalStore(file: string): EvalJobStore {
  const mem = createMemoryEvalStore();
  if (existsSync(file)) {
    try {
      for (const r of JSON.parse(readFileSync(file, "utf8")) as EvalJobRecord[]) {
        mem.put(r);
      }
    } catch {
      /* corrupt → start empty */
    }
  }
  const flush = () => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(mem.list(), null, 2));
  };
  return {
    get: (k) => mem.get(k),
    put: (r) => {
      mem.put(r);
      flush();
    },
    list: () => mem.list(),
  };
}
