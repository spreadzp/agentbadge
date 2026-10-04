// SLICE-155-12: Postgres-backed SpendAlertStore — mirror + write-behind.
// Mirrors createJsonSpendAlertStore semantics: newest-first list filtered by
// type/wallet/venueId/since, default limit 50, MAX_ALERTS cap. Writes update
// the mirror synchronously and enqueue a SpendAlertRepository.add; reads
// never touch the DB.

import type { SpendAlertRepository } from "@agentbadge/database";

import { DbWriteBehind } from "../db-mirror";
import type { SpendAlertEvent, SpendAlertStore } from "./audit";

/** Repo payload column type (JsonValue) — avoids importing codec-types. */
type RepoPayload = Parameters<SpendAlertRepository["add"]>[0]["payload"];

const MAX_ALERTS = 2_000;
const DEFAULT_LIMIT = 50;

export interface DbSpendAlertStore extends SpendAlertStore {
  ready(): Promise<void>;
  flush(): Promise<void>;
}

/** Postgres alert store — null when repo absent (DATABASE_ENABLED off). */
export function createDbSpendAlertStore(
  repo: SpendAlertRepository | null | undefined,
): DbSpendAlertStore | null {
  if (!repo) return null;
  let events: SpendAlertEvent[] = [];

  const wb = new DbWriteBehind("agent-wallet.alerts", async () => {
    const rows = await repo.list({ limit: MAX_ALERTS });
    // repo.list is newest-first; keep insertion order = newest-first.
    events = rows.map((r) => r.payload as unknown as SpendAlertEvent);
  });

  return {
    name: "db",
    ready: () => wb.ready(),
    flush: () => wb.flush(),
    add(ev) {
      events = [ev, ...events].slice(0, MAX_ALERTS);
      wb.enqueue(() =>
        repo.add({
          id: ev.id,
          type: ev.type,
          wallet: ev.wallet,
          venueId: ev.venueId ?? null,
          at: ev.at,
          payload: ev as unknown as RepoPayload,
        }),
      );
    },
    list(opts = {}) {
      const filtered = events.filter((e) => {
        if (opts.type && e.type !== opts.type) return false;
        if (opts.wallet && e.wallet.toLowerCase() !== opts.wallet.toLowerCase()) {
          return false;
        }
        if (opts.venueId !== undefined && e.venueId !== opts.venueId) {
          return false;
        }
        if (opts.since !== undefined && e.at < opts.since) return false;
        return true;
      });
      return filtered.slice(0, opts.limit ?? DEFAULT_LIMIT);
    },
  };
}
