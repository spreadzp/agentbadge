// SLICE-155-12: Postgres-backed EaasContractStore — mirror + write-behind.
// Same Map semantics as createMemoryContractStore:
// key = "${chainId}:${address.toLowerCase()}", list filters by owner.

import type { EaasContractRepository } from "@agentbadge/database";

import { DbWriteBehind } from "../db-mirror";
import type { EaasContract, EaasContractStore } from "./contracts";

/** Repo payload column type (JsonValue) — avoids importing codec-types. */
type RepoPayload = Parameters<EaasContractRepository["put"]>[0]["payload"];

export interface DbContractStore extends EaasContractStore {
  ready(): Promise<void>;
  flush(): Promise<void>;
}

const key = (address: string, chainId: number) =>
  `${chainId}:${address.toLowerCase()}`;

/** Postgres contract store — null when repo absent (DATABASE_ENABLED off). */
export function createDbContractStore(
  repo: EaasContractRepository | null | undefined,
): DbContractStore | null {
  if (!repo) return null;
  const map = new Map<string, EaasContract>();

  const wb = new DbWriteBehind("eaas.contracts", async () => {
    const rows = await repo.list();
    for (const r of rows) {
      const rec = r.payload as unknown as EaasContract;
      map.set(key(rec.address, rec.chainId), rec);
    }
  });

  return {
    ready: () => wb.ready(),
    flush: () => wb.flush(),
    put(c) {
      const rec = { ...c };
      map.set(key(rec.address, rec.chainId), rec);
      wb.enqueue(() =>
        repo.put({
          address: rec.address,
          chainId: rec.chainId,
          ownerWallet: rec.ownerWallet,
          active: rec.active,
          probedAt: rec.probedAt,
          payload: rec as unknown as RepoPayload,
        }),
      );
    },
    get(a, id) {
      return map.get(key(a, id));
    },
    remove(a, id) {
      const ok = map.delete(key(a, id));
      if (ok) wb.enqueue(() => repo.remove(a, id));
      return ok;
    },
    list(owner) {
      const all = [...map.values()];
      return owner
        ? all.filter(
          (c) => c.ownerWallet.toLowerCase() === owner.toLowerCase(),
        )
        : all;
    },
  };
}
