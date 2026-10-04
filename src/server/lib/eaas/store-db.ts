// SLICE-155-12: Postgres-backed VerdictStoreBackend — mirror + write-behind.
// Mirrors createJsonVerdictStore semantics: idempotent put by verdictId,
// getByDeliverable + list sorted by artifact.issuedAt desc, default limit 100.

import type { EaasVerdictRepository } from "@agentbadge/database";
import type { Hex } from "viem";

import { DbWriteBehind } from "../db-mirror";
import type { StoredVerdict, VerdictStoreBackend } from "./store";

/** Repo payload column type (JsonValue) — avoids importing codec-types. */
type RepoPayload = Parameters<EaasVerdictRepository["put"]>[0]["payload"];

const DEFAULT_LIST_LIMIT = 100;

export interface DbVerdictStore extends VerdictStoreBackend {
  flush(): Promise<void>;
}

const sortNewest = (list: StoredVerdict[]) =>
  [...list].sort((a, b) =>
    b.artifact.issuedAt.localeCompare(a.artifact.issuedAt),
  );

/** Postgres verdict store — null when repo absent (DATABASE_ENABLED off). */
export function createDbVerdictStore(
  repo: EaasVerdictRepository | null | undefined,
): DbVerdictStore | null {
  if (!repo) return null;
  const map = new Map<string, StoredVerdict>();

  const wb = new DbWriteBehind("eaas.verdicts", async () => {
    const rows = await repo.list();
    for (const r of rows) {
      const v = r.payload as unknown as StoredVerdict;
      map.set(v.artifact.verdictId, v);
    }
  });

  return {
    name: "db",
    ready: () => wb.ready(),
    flush: () => wb.flush(),
    put(verdict) {
      const id = verdict.artifact.verdictId;
      if (map.has(id)) return; // idempotent
      map.set(id, verdict);
      wb.enqueue(() =>
        repo.put({
          verdictId: id,
          deliverableHash: verdict.artifact.deliverableHash ?? null,
          consumerWallet: verdict.consumerWallet ?? null,
          paymentTx: verdict.paymentTx ?? null,
          payload: verdict as unknown as RepoPayload,
        }),
      );
    },
    get(verdictId: Hex) {
      return map.get(verdictId);
    },
    getByDeliverable(deliverableHash: Hex) {
      return sortNewest(
        [...map.values()].filter(
          (v) => v.artifact.deliverableHash === deliverableHash,
        ),
      );
    },
    list(consumerWallet, limit = DEFAULT_LIST_LIMIT) {
      const all = consumerWallet
        ? [...map.values()].filter(
          (v) =>
            v.consumerWallet?.toLowerCase() === consumerWallet.toLowerCase(),
        )
        : [...map.values()];
      return sortNewest(all).slice(0, limit);
    },
  };
}
