/**
 * Shared service context — the settlement store bundle is reached
 * through `db.settlement` (the same Database facade as finops); `emit`
 * is the append-only event emitter (services/../events.ts).
 */
import type { Database } from "@agentbadge/database";

import type { SettlementEventEmitter } from "../events.js";

export interface SettlementCtx {
  db: Database;
  emit: SettlementEventEmitter;
}

export const newPlanId = () => `mp_${crypto.randomUUID()}`;
export const newMilestoneRowId = () => `ms_${crypto.randomUUID()}`;
export const newIntentId = () => `pi_${crypto.randomUUID()}`;
export const newLegId = () => `pl_${crypto.randomUUID()}`;
export const newDisputeId = () => `dp_${crypto.randomUUID()}`;
export const newAnchorId = () => `sa_${crypto.randomUUID()}`;
