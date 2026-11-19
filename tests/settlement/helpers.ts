/** Shared fixtures for settlement domain specs. */
import { createDatabase, type Database } from "@agentbadge/database";

import {
  approveMilestone,
  createPlan,
  createSettlementCtx,
  submitForReview,
} from "../../src/server/lib/settlement/index.js";
import type {
  MilestoneInput,
  SettlementCtx,
  SettlementErrorCode,
} from "../../src/server/lib/settlement/index.js";

export const BUYER = "0x1111111111111111111111111111111111111111";
export const PROVIDER = "0x2222222222222222222222222222222222222222";
export const STRANGER = "0x3333333333333333333333333333333333333333";
export const FEE = "0x4444444444444444444444444444444444444444";
export const OPS = "ops-settle-1";
export const TX1 = `0x${"a".repeat(64)}`;
export const TX2 = `0x${"b".repeat(64)}`;

export function freshCtx(): { db: Database; ctx: SettlementCtx } {
  const db = createDatabase({ enabled: false });
  return { db, ctx: createSettlementCtx(db) };
}

export const codeOf = (r: { ok: boolean; error?: { code: string } }) =>
  r.ok ? null : (r.error?.code as SettlementErrorCode);

export async function openPlan(
  ctx: SettlementCtx,
  milestones: MilestoneInput[] = [
    { milestoneId: "m1", title: "phase one", amountUsd: "7.50" },
    { milestoneId: "m2", title: "phase two", amountUsd: "2.50" },
  ],
) {
  const r = await createPlan(
    ctx,
    {
      agreementRef: `agr-${crypto.randomUUID()}`,
      buyerWallet: BUYER,
      providerWallet: PROVIDER,
      totalUsd: "10.00",
      milestones,
    },
    BUYER,
  );
  if (!r.ok) throw new Error(`plan create failed: ${r.error.code}`);
  return r.value;
}

/** Plan → submit → approve → { plan, milestone, intentId, legs }. */
export async function approvedIntent(
  ctx: SettlementCtx,
  milestoneIdx = 0,
) {
  const { plan, milestones } = await openPlan(ctx);
  const m = milestones[milestoneIdx]!;
  const sub = await submitForReview(
    ctx,
    { milestoneRowId: m.id, submissionRef: "ipfs://work-1" },
    PROVIDER,
  );
  if (!sub.ok) throw new Error(`submit failed: ${sub.error.code}`);
  const ap = await approveMilestone(ctx, m.id, BUYER);
  if (!ap.ok) throw new Error(`approve failed: ${ap.error.code}`);
  return { plan, ...ap.value };
}
