// SLICE-155-12: Postgres-backed EvalJobStore — mirror + write-behind.
// Same Map semantics as createMemoryEvalStore keyed by evalJobKey.

import type { EaasEvalJobRepository } from "@agentbadge/database";

import { DbWriteBehind } from "../db-mirror";
import type { EvalJobRecord, EvalJobStore } from "./eval-store";

/** Repo payload column type (JsonValue) — avoids importing codec-types. */
type RepoPayload = Parameters<EaasEvalJobRepository["put"]>[0]["payload"];

export interface DbEvalJobStore extends EvalJobStore {
  ready(): Promise<void>;
  flush(): Promise<void>;
}

/** Postgres eval-job store — null when repo absent (DATABASE_ENABLED off). */
export function createDbEvalStore(
  repo: EaasEvalJobRepository | null | undefined,
): DbEvalJobStore | null {
  if (!repo) return null;
  const map = new Map<string, EvalJobRecord>();

  const wb = new DbWriteBehind("eaas.evalJobs", async () => {
    const rows = await repo.list();
    for (const r of rows) {
      const rec = r.payload as unknown as EvalJobRecord;
      map.set(rec.key, rec);
    }
  });

  return {
    ready: () => wb.ready(),
    flush: () => wb.flush(),
    get(key) {
      return map.get(key);
    },
    put(r) {
      map.set(r.key, r);
      wb.enqueue(() =>
        repo.put({
          key: r.key,
          contract: r.contract,
          chainId: r.chainId,
          jobId: r.jobId,
          verdictId: r.verdictId,
          feedbackTx: r.feedbackTx ?? null,
          paymentTx: r.paymentTx ?? null,
          payload: r as unknown as RepoPayload,
        }),
      );
    },
    list() {
      return [...map.values()];
    },
  };
}
