// EPIC-264 (SLICE-264-1): in-memory repo group — full behavioral
// parity with the Postgres repos (tests + dev without
// DATABASE_ENABLED). Optional seed fixture pre-fills the maps
// (memory-mode bootstrap).

import type { AdminOperator, AdminOperatorCredential } from "./types";
import type { AdminOperatorRepos } from "./store";

export function createMemoryOperatorRepos(fixture?: {
  operators?: AdminOperator[];
  credentials?: AdminOperatorCredential[];
}): AdminOperatorRepos {
  const operators = new Map<string, AdminOperator>();
  const credentials = new Map<string, AdminOperatorCredential>();
  for (const o of fixture?.operators ?? []) operators.set(o.id, o);
  for (const c of fixture?.credentials ?? []) credentials.set(c.id, c);

  return {
    operators: {
      async insert(o) {
        operators.set(o.id, o);
        return o;
      },
      async byId(id) {
        return operators.get(id) ?? null;
      },
      async list(opts) {
        return [...operators.values()].filter(
          (o) =>
            (opts?.status === undefined || o.status === opts.status) &&
            (opts?.principalType === undefined ||
              o.principalType === opts.principalType),
        );
      },
      async update(o) {
        operators.set(o.id, o);
        return o;
      },
      async countActiveHumans() {
        return [...operators.values()].filter(
          (o) => o.principalType === "human" && o.status === "active",
        ).length;
      },
    },
    credentials: {
      async insert(c) {
        // mirror the PG @@unique(keyHash) — backends share invariants
        for (const existing of credentials.values())
          if (existing.keyHash === c.keyHash)
            throw new Error(`duplicate keyHash: ${c.keyHash}`);
        credentials.set(c.id, c);
        return c;
      },
      async byId(id) {
        return credentials.get(id) ?? null;
      },
      async byKeyHash(keyHash) {
        for (const c of credentials.values())
          if (c.keyHash === keyHash) return c;
        return null;
      },
      async forOperator(operatorId) {
        return [...credentials.values()].filter(
          (c) => c.operatorId === operatorId,
        );
      },
      async update(c) {
        credentials.set(c.id, c);
        return c;
      },
      async touchLastUsed(id, ts) {
        const c = credentials.get(id);
        if (!c) return false;
        credentials.set(id, { ...c, lastUsedAt: ts });
        return true;
      },
    },
  };
}
