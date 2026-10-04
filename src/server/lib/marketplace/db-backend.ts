// SLICE-155-12: Postgres backend for the marketplace catalog store.
// Hydrates a mirror ({services, meta}) from MarketplaceRepository, installs
// it via catalog.useDbBackend; persist diffs each row's JSON snapshot
// against the last-enqueued value (upserts only changed rows — catalog
// writes are rare, row count is small).

import type { MarketplaceRepository } from "@agentbadge/database";

import { DbWriteBehind } from "../db-mirror";
import { useDbBackend } from "./catalog";
import type { CatalogService } from "./types";

/** Repo payload column type (JsonValue) — avoids importing codec-types. */
type SvcPayload = Parameters<MarketplaceRepository["upsertService"]>[1];
type MetaPayload = Parameters<MarketplaceRepository["putMeta"]>[1];

type Mirror = {
  services: Record<string, CatalogService>;
  meta: Record<string, unknown>;
};

export interface DbMarketplaceBackend {
  ready(): Promise<void>;
  flush(): Promise<void>;
}

/**
 * Hydrate + install the Postgres marketplace backend.
 * Returns null when repo absent (DATABASE_ENABLED off) — the JSON-file
 * store keeps serving untouched.
 */
export function initMarketplaceDbBackend(
  repo: MarketplaceRepository | null | undefined,
): DbMarketplaceBackend | null {
  if (!repo) return null;

  const store: Mirror = { services: {}, meta: {} };
  /** Per-row JSON snapshots at enqueue time — skip unchanged rows. */
  const persistedSvcs = new Map<string, string>();
  const persistedMeta = new Map<string, string>();

  const wb = new DbWriteBehind("marketplace", async () => {
    const [svcs, metas] = await Promise.all([
      repo.listServices(),
      repo.listMeta(),
    ]);
    for (const r of svcs) {
      const svc = r.payload as unknown as CatalogService;
      const key = svc.serviceId.toLowerCase();
      store.services[key] = svc;
      persistedSvcs.set(key, JSON.stringify(svc));
    }
    for (const r of metas) {
      store.meta[r.hash.toLowerCase()] = r.payload;
      persistedMeta.set(r.hash.toLowerCase(), JSON.stringify(r.payload));
    }
  });

  const persist = (s: Mirror) => {
    for (const [key, svc] of Object.entries(s.services)) {
      const snap = JSON.stringify(svc);
      if (persistedSvcs.get(key) === snap) continue;
      persistedSvcs.set(key, snap);
      wb.enqueue(() =>
        repo.upsertService(key, svc as unknown as SvcPayload),
      );
    }
    for (const [key, meta] of Object.entries(s.meta)) {
      const snap = JSON.stringify(meta);
      if (persistedMeta.get(key) === snap) continue;
      persistedMeta.set(key, snap);
      wb.enqueue(() => repo.putMeta(key, meta as MetaPayload));
    }
  };

  useDbBackend(store, persist);
  return { ready: () => wb.ready(), flush: () => wb.flush() };
}
