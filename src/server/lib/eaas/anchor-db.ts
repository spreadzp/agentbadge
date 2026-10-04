// SLICE-155-12: Postgres-backed AnchorStore — mirror + write-behind.
// Same Map semantics as createMemoryAnchorStore; patch merges into the
// mirror and persists the patched row (status/attempts/txHash/…).

import type { EaasAnchorRepository } from "@agentbadge/database";
import type { Hex } from "viem";

import { DbWriteBehind } from "../db-mirror";
import type { AnchorRecord, AnchorStore } from "./anchor";

/** Repo payload column type (JsonValue) — avoids importing codec-types. */
type RepoPayload = Parameters<EaasAnchorRepository["put"]>[0]["payload"];

export interface DbAnchorStore extends AnchorStore {
  ready(): Promise<void>;
  flush(): Promise<void>;
}

/** Postgres anchor store — null when repo absent (DATABASE_ENABLED off). */
export function createDbAnchorStore(
  repo: EaasAnchorRepository | null | undefined,
): DbAnchorStore | null {
  if (!repo) return null;
  const map = new Map<Hex, AnchorRecord>();

  const wb = new DbWriteBehind("eaas.anchors", async () => {
    const rows = await repo.list();
    for (const r of rows) {
      const rec = r.payload as unknown as AnchorRecord;
      map.set(rec.verdictId, rec);
    }
  });

  const persist = (r: AnchorRecord) =>
    wb.enqueue(() =>
      repo.put({
        verdictId: r.verdictId,
        memoId: r.memoId,
        artifactHash: r.artifactHash,
        status: r.status,
        attempts: r.attempts,
        txHash: r.txHash ?? null,
        blockNumber: r.blockNumber ?? null,
        lastError: r.lastError ?? null,
        payload: r as unknown as RepoPayload,
      }),
    );

  return {
    ready: () => wb.ready(),
    flush: () => wb.flush(),
    get: (id) => map.get(id),
    put(r) {
      map.set(r.verdictId, r);
      persist(r);
    },
    patch(id, patch) {
      const cur = map.get(id);
      if (!cur) return;
      const merged: AnchorRecord = { ...cur, ...patch, verdictId: id };
      map.set(id, merged);
      persist(merged);
    },
    list: () => [...map.values()],
  };
}
