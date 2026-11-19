/**
 * EPIC-227 — dispute subject scoping (extracted under the 300-line
 * cap). `resolveScope` maps a dispute subject to its plan + milestone
 * set; `FreezeMap` is what a dispute snapshot-restores on resolve.
 */
import type {
  MilestonePlanRow,
  MilestoneRow,
} from "@agentbadge/database";

import type { SettlementCtx } from "./ctx.js";

export interface FreezeMap {
  /** milestoneRowId → status before the freeze. */
  milestones: Record<string, string>;
  intentIds: string[];
  legIds: string[];
}

export interface SubjectScope {
  plan: MilestonePlanRow;
  milestones: MilestoneRow[];
}

/** AGREEMENT → plan + all its milestones; MILESTONE → row + its plan. */
export async function resolveScope(
  ctx: SettlementCtx,
  subjectType: string,
  subjectRef: string,
): Promise<SubjectScope | null> {
  if (subjectType === "AGREEMENT") {
    const plan = await ctx.db.settlement.plans.getByAgreement(subjectRef);
    if (!plan) return null;
    return {
      plan,
      milestones: await ctx.db.settlement.milestones.listByPlan(plan.id),
    };
  }
  const milestone = await ctx.db.settlement.milestones.getById(subjectRef);
  if (!milestone) return null;
  const plan = await ctx.db.settlement.plans.getById(milestone.planId);
  if (!plan) return null;
  return { plan, milestones: [milestone] };
}
