// SLICE-155-12: Postgres-backed EaasRequestStore — mirror + write-behind.
// Same semantics as createJsonRequestStore: put upserts, update merges
// lifecycle fields only (no-op on unknown id), counts groups by status.

import type { EaasRequestRepository } from "@agentbadge/database";

import { DbWriteBehind } from "../db-mirror";
import type { EaasAsyncRequest, EaasRequestStore } from "./requests";

/** Repo payload column type (JsonValue) — avoids importing codec-types. */
type RepoPayload = Parameters<EaasRequestRepository["put"]>[0]["payload"];

export interface DbRequestStore extends EaasRequestStore {
  ready(): Promise<void>;
  flush(): Promise<void>;
}

/** Postgres request store — null when repo absent (DATABASE_ENABLED off). */
export function createDbRequestStore(
  repo: EaasRequestRepository | null | undefined,
): DbRequestStore | null {
  if (!repo) return null;
  const map = new Map<string, EaasAsyncRequest>();

  const wb = new DbWriteBehind("eaas.requests", async () => {
    const rows = await repo.list();
    for (const r of rows) {
      const rec = r.payload as unknown as EaasAsyncRequest;
      map.set(rec.id, rec);
    }
  });

  const persist = (r: EaasAsyncRequest) =>
    wb.enqueue(() =>
      repo.put({
        id: r.id,
        kind: r.kind,
        status: r.status,
        wallet: r.wallet ?? null,
        attempts: r.attempts,
        webhookStatus: r.webhookStatus ?? null,
        reqCreatedAt: r.createdAt,
        completedAt: r.completedAt ?? null,
        payload: r as unknown as RepoPayload,
      }),
    );

  return {
    ready: () => wb.ready(),
    flush: () => wb.flush(),
    put(req) {
      map.set(req.id, req);
      persist(req);
    },
    get(id) {
      return map.get(id);
    },
    update(id, patch) {
      const cur = map.get(id);
      if (!cur) return;
      const merged: EaasAsyncRequest = { ...cur, ...patch, id };
      map.set(id, merged);
      persist(merged);
    },
    counts() {
      const c: Record<EaasAsyncRequest["status"], number> = {
        pending: 0,
        done: 0,
        failed: 0,
      };
      for (const r of map.values()) c[r.status]++;
      return c;
    },
  };
}
