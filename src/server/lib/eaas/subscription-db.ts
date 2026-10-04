// SLICE-155-12: Postgres-backed EaasSubscriptionStore — mirror + write-behind.
// Same semantics as createJsonSubscriptionStore: PK = lowercased wallet.

import type { EaasSubscriptionRepository } from "@agentbadge/database";

import { DbWriteBehind } from "../db-mirror";
import type { EaasSubscription, EaasSubscriptionStore } from "./subscription";

/** Repo payload column type (JsonValue) — avoids importing codec-types. */
type RepoPayload = Parameters<EaasSubscriptionRepository["put"]>[0]["payload"];

export interface DbSubscriptionStore extends EaasSubscriptionStore {
  ready(): Promise<void>;
  flush(): Promise<void>;
}

/** Postgres subscription store — null when repo absent (DATABASE_ENABLED off). */
export function createDbSubscriptionStore(
  repo: EaasSubscriptionRepository | null | undefined,
): DbSubscriptionStore | null {
  if (!repo) return null;
  const map = new Map<string, EaasSubscription>();

  const wb = new DbWriteBehind("eaas.subscriptions", async () => {
    const rows = await repo.list();
    for (const r of rows) {
      const rec = r.payload as unknown as EaasSubscription;
      map.set(rec.wallet.toLowerCase(), rec);
    }
  });

  return {
    name: "db",
    ready: () => wb.ready(),
    flush: () => wb.flush(),
    get(wallet) {
      return map.get(wallet.toLowerCase());
    },
    put(sub) {
      const rec = { ...sub, wallet: sub.wallet.toLowerCase() };
      map.set(rec.wallet, rec);
      wb.enqueue(() =>
        repo.put({
          wallet: rec.wallet,
          tier: rec.tier,
          expiresAt: rec.expiresAt,
          quotaUsed: rec.quotaUsed,
          resetAt: rec.resetAt,
          paymentTx: rec.paymentTx ?? null,
          mintTx: rec.mintTx ?? null,
          payload: rec as unknown as RepoPayload,
        }),
      );
    },
    list() {
      return [...map.values()];
    },
  };
}
