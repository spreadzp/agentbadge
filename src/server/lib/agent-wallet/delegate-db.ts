// SLICE-155-12: Postgres-backed DelegateStore — mirror + write-behind.
// Same Map semantics as createMemoryDelegateStore: key =
// "${ownerWallet.toLowerCase()}:${chain}", list = newest-first per owner,
// revoke sets revokedAt=now and returns false for unknown/already-revoked.

import type { DelegateRepository } from "@agentbadge/database";

import { DbWriteBehind } from "../db-mirror";
import type { DelegateRecord, DelegateStore } from "./delegate";

/** Repo payload column type (JsonValue) — avoids importing codec-types. */
type RepoPayload = Parameters<DelegateRepository["put"]>[0]["payload"];

export interface DbDelegateStore extends DelegateStore {
  ready(): Promise<void>;
  flush(): Promise<void>;
}

const key = (w: string, ch: string) => `${w.toLowerCase()}:${ch}`;

/** Postgres delegate store — null when repo absent (DATABASE_ENABLED off). */
export function createDbDelegateStore(
  repo: DelegateRepository | null | undefined,
): DbDelegateStore | null {
  if (!repo) return null;
  const map = new Map<string, DelegateRecord>();

  const wb = new DbWriteBehind("agent-wallet.delegates", async () => {
    const rows = await repo.listAll();
    for (const r of rows) {
      const rec = r.payload as unknown as DelegateRecord;
      map.set(key(rec.ownerWallet, rec.chain), rec);
    }
  });

  const persist = (rec: DelegateRecord) =>
    wb.enqueue(() =>
      repo.put({
        ownerWallet: rec.ownerWallet,
        delegate: rec.delegate,
        chain: rec.chain,
        spendCapUsd: rec.spendCapUsd,
        authorizedAt: rec.authorizedAt,
        revokedAt: rec.revokedAt ?? null,
        payload: rec as unknown as RepoPayload,
      }),
    );

  return {
    ready: () => wb.ready(),
    flush: () => wb.flush(),
    put(rec) {
      map.set(key(rec.ownerWallet, rec.chain), rec);
      persist(rec);
    },
    get(w, ch) {
      return map.get(key(w, ch));
    },
    list(w) {
      const lw = w.toLowerCase();
      return [...map.values()]
        .filter((r) => r.ownerWallet.toLowerCase() === lw)
        .sort((a, b) => b.authorizedAt - a.authorizedAt);
    },
    revoke(w, ch) {
      const rec = map.get(key(w, ch));
      if (!rec || rec.revokedAt !== undefined) return false;
      const revoked: DelegateRecord = { ...rec, revokedAt: Date.now() };
      map.set(key(w, ch), revoked);
      // repo.revoke only stamps the revokedAt column — put persists the
      // updated payload too, so hydration after restart keeps revokedAt.
      persist(revoked);
      return true;
    },
  };
}
