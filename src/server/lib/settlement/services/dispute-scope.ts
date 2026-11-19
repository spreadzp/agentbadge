/**
 * EPIC-227 — dispute subject scoping (extracted under the 300-line
 * cap). `resolveScope` maps a dispute subject to its plan + milestone
 * set; `FreezeMap` is what a dispute snapshot-restores on resolve.
 */
import type {
  DisputeRow,
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

// ---------- queries ----------

export async function getDispute(ctx: SettlementCtx, disputeId: string) {
  return ctx.db.settlement.disputes.getById(disputeId);
}

export async function listDisputes(
  ctx: SettlementCtx,
  opts?: { status?: string; limit?: number },
) {
  return ctx.db.settlement.disputes.list(opts);
}

/** The OPEN dispute on a subject, if any — shared dedupe lookup. */
export async function openSubjectDispute(
  s: Pick<SettlementCtx["db"]["settlement"], "disputes">,
  subjectType: string,
  subjectRef: string,
): Promise<DisputeRow | undefined> {
  return (await s.disputes.listBySubject(subjectType, subjectRef)).find(
    (d) => d.status === "OPEN",
  );
}
