// SLICE-176-4: Postgres wallet store extracted from registry.ts
// (300-line guard). Moved verbatim — write-through semantics unchanged.

import type { AgentWalletRepository } from "@agentbadge/database";
import type { AgentWalletRecord, AgentWalletStore } from "./registry";

/**
 * SLICE-155-10: Postgres backend — write-through. The full record rides
 * in `payload` Json; typed columns stay in sync for indexed queries
 * (venue-scoped lists, active filter). `address` is stored lowercased —
 * keys are case-insensitive across all backends.
 */
export function createDbAgentWalletStore(
  repo: AgentWalletRepository,
): AgentWalletStore {
  const toRecord = (row: {
    payload: unknown;
  }): AgentWalletRecord => {
    const p = row.payload;
    return (typeof p === "string" ? JSON.parse(p) : p) as AgentWalletRecord;
  };
  const toRow = (rec: AgentWalletRecord) => ({
    address: rec.address.toLowerCase(),
    agentId: rec.agentId ?? null,
    venueId: rec.venueId ?? null,
    label: rec.label,
    kind: rec.kind,
    registeredBy: rec.registeredBy,
    active: rec.active,
    payload: rec as unknown as Parameters<
      AgentWalletRepository["upsert"]
    >[0]["payload"],
  });
  return {
    name: "db",
    async put(rec) {
      await repo.upsert(toRow(rec));
    },
    async get(address) {
      const row = await repo.getByAddress(address);
      return row ? toRecord(row) : undefined;
    },
    async list(venueId) {
      const rows = await repo.list(venueId ? { venueId } : undefined);
      const all = rows.map(toRecord);
      return [...all].sort((a, b) => b.createdAt - a.createdAt);
    },
    async deactivate(address) {
      const row = await repo.getByAddress(address);
      if (!row) return false;
      const rec = { ...toRecord(row), active: false };
      await repo.upsert(toRow(rec));
      return true;
    },
    async setEnvelope(address, caps) {
      const row = await repo.getByAddress(address);
      if (!row) return false;
      const rec = toRecord(row);
      if (!rec.active) return false;
      await repo.upsert(toRow({ ...rec, envelope: caps }));
      return true;
    },
    async setSuspended(address, flag, actor) {
      const row = await repo.getByAddress(address);
      if (!row) return false;
      const rec = toRecord(row);
      await repo.upsert(
        toRow({
          ...rec,
          suspended: flag,
          ...(flag
            ? { suspendedAt: Date.now(), ...(actor ? { suspendedBy: actor } : {}) }
            : {}),
        }),
      );
      return true;
    },
  };
}
