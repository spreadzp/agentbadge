/**
 * EPIC-227 / SLICE-227-2 — payout read model. Intents surface with
 * their legs; admin routes page `listIntents` by status.
 */
import type { SettlementCtx } from "./ctx.js";

export async function getIntentView(ctx: SettlementCtx, intentId: string) {
  const intent = await ctx.db.settlement.payoutIntents.getById(intentId);
  if (!intent) return null;
  const legs = await ctx.db.settlement.payoutLegs.listByIntent(intent.id);
  return { intent, legs };
}

export async function listIntents(
  ctx: SettlementCtx,
  opts?: { status?: string; limit?: number },
) {
  return ctx.db.settlement.payoutIntents.list(opts);
}
