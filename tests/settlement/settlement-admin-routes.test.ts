/**
 * SLICE-227-3/8: settlement admin routes — operatorAuth (264-8), no-store,
 * mark-paid replay/leg rules, dispute resolve audit, milestone
 * force-approve (R3-H3) + force-reopen (R5-M3) operator recovery.
 * Split from settlement-routes.test.ts under the staged-file cap.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Database } from "@agentbadge/database";

import {
  createPlan,
  createSettlementCtx,
  raiseDispute,
  submitForReview,
} from "../../src/server/lib/settlement/index.js";
import { listAdminActions } from "../../src/server/lib/finops/index.js";

import {
  adminReq,
  buyer,
  initRouteTest,
  PLAN_BODY,
  provider,
  rt,
  seedApprovedIntent,
  teardownRouteTest,
  TX,
} from "./route-helpers.js";

let db: Database;
beforeEach(async () => {
  await initRouteTest();
  db = rt.db;
});
afterEach(teardownRouteTest);

// ---------- admin routes ----------

describe("admin routes", () => {
  it("mark-paid without admin key → 401 UNAUTHORIZED + no-store", async () => {
    const { intentId } = await seedApprovedIntent();
    const res = await rt.app.fetch(
      new Request(`http://localhost/admin/settlement/intents/${intentId}/mark-paid`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ txHash: TX }),
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { code?: string; error?: { code?: string } };
    expect(body.code ?? body.error?.code).toBe("UNAUTHORIZED");
  });

  it("mark-paid with a self-asserted operator field → 400, no AdminAction", async () => {
    const { intentId } = await seedApprovedIntent();
    const before = (await listAdminActions(db)).length;
    const r = await adminReq(
      "POST",
      `/admin/settlement/intents/${intentId}/mark-paid`,
      { operator: "spoofed", txHash: TX },
    );
    expect(r.status).toBe(400);
    expect((await listAdminActions(db)).length).toBe(before);
  });

  it("mark-paid on a missing intent → 404, no AdminAction written", async () => {
    const before = (await listAdminActions(db)).length;
    const r = await adminReq(
      "POST",
      "/admin/settlement/intents/pi_missing/mark-paid",
      { txHash: TX },
    );
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("NOT_FOUND");
    expect((await listAdminActions(db)).length).toBe(before);
  });

  it("mark-paid happy → 200 auditRecorded:true + AdminAction row", async () => {
    const { intentId } = await seedApprovedIntent();
    const before = (await listAdminActions(db)).length;
    const r = await adminReq(
      "POST",
      `/admin/settlement/intents/${intentId}/mark-paid`,
      { txHash: TX },
    );
    expect(r.status).toBe(200);
    expect(r.body.auditRecorded).toBe(true);
    expect(r.body.leg.txHash).toBe(TX);
    expect(r.body.intent.status).toBe("COMPLETED");
    const actions = await listAdminActions(db);
    expect(actions.length).toBe(before + 1);
    expect(actions.at(-1)?.action).toBe("MARK_PAYOUT_PAID");
    expect(actions.at(-1)?.operator).toBe(rt.operatorId);
    // Replay → 409 INVALID_STATE (code matches status class).
    const replay = await adminReq(
      "POST",
      `/admin/settlement/intents/${intentId}/mark-paid`,
      { txHash: TX },
    );
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe("INVALID_STATE");
  });

  it("dispute resolve happy → 200 auditRecorded:true", async () => {
    const { plan } = await seedApprovedIntent();
    const ctx = createSettlementCtx(db);
    const d = await raiseDispute(ctx, {
      subjectType: "AGREEMENT",
      subjectRef: plan.agreementRef,
      raisedBy: buyer.address,
      reason: "ops review",
    });
    if (!d.ok) throw new Error("raise failed");
    const r = await adminReq(
      "POST",
      `/admin/settlement/disputes/${d.value.dispute.id}/resolve`,
      { resolution: "FOR_PROVIDER" },
    );
    expect(r.status).toBe(200);
    expect(r.body.auditRecorded).toBe(true);
    const actions = await listAdminActions(db);
    expect(actions.at(-1)?.action).toBe("RESOLVE_SETTLEMENT_DISPUTE");
  });

  // R3-H3: operator force-approve — the recovery path for milestones
  // stranded READY (pre-R3 swallowed post-commit, EVALUATOR legacy).
  it("milestones/:id/approve → READY milestone APPROVED + intent; idempotent", async () => {
    const ctx = createSettlementCtx(db);
    const plan = await createPlan(
      ctx,
      { ...PLAN_BODY(`agr-${randomUUID()}`) },
      buyer.address,
    );
    if (!plan.ok) throw new Error("seed failed");
    const m = plan.value.milestones[0]!;
    await submitForReview(
      ctx,
      { milestoneRowId: m.id, submissionRef: "ipfs://w" },
      provider.address,
    );

    const r = await adminReq(
      "POST",
      `/admin/settlement/milestones/${m.id}/approve`,
      { reason: "test recovery" },
    );
    expect(r.status).toBe(200);
    expect(r.body.intentId).toBeTruthy();
    const intent = await db.settlement.payoutIntents.getByMilestone(m.id);
    expect(intent?.id).toBe(r.body.intentId);
    // Idempotent — second call returns the same intent, no error.
    const again = await adminReq(
      "POST",
      `/admin/settlement/milestones/${m.id}/approve`,
      { reason: "test recovery" },
    );
    expect(again.status).toBe(200);
    expect(again.body.intentId).toBe(r.body.intentId);
  });

  it("milestones/:id/approve → 409 on OPEN dispute; 400 missing operator", async () => {
    const ctx = createSettlementCtx(db);
    const plan = await createPlan(
      ctx,
      { ...PLAN_BODY(`agr-${randomUUID()}`) },
      buyer.address,
    );
    if (!plan.ok) throw new Error("seed failed");
    const m = plan.value.milestones[0]!;
    await submitForReview(
      ctx,
      { milestoneRowId: m.id, submissionRef: "ipfs://w" },
      provider.address,
    );
    const noOp = await adminReq(
      "POST",
      `/admin/settlement/milestones/${m.id}/approve`,
      {},
    );
    expect(noOp.status).toBe(400);
    await raiseDispute(ctx, {
      subjectType: "MILESTONE",
      subjectRef: m.id,
      raisedBy: buyer.address,
      reason: "hold",
    });
    const r = await adminReq(
      "POST",
      `/admin/settlement/milestones/${m.id}/approve`,
      { reason: "test recovery" },
    );
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("INVALID_STATE");
  });

  // R5-M3: operator reopen — the safe exit for a milestone stuck READY
  // after a lost/raced reject-release (never pays rejected work).
  it("milestones/:id/reopen → READY milestone PENDING + unbound + audit; idempotent", async () => {
    const ctx = createSettlementCtx(db);
    const plan = await createPlan(
      ctx,
      { ...PLAN_BODY(`agr-${randomUUID()}`) },
      buyer.address,
    );
    if (!plan.ok) throw new Error("seed failed");
    const m = plan.value.milestones[0]!;
    await submitForReview(
      ctx,
      { milestoneRowId: m.id, submissionRef: "sub_x" },
      provider.address,
    );

    const r = await adminReq(
      "POST",
      `/admin/settlement/milestones/${m.id}/reopen`,
      { reason: "release lost after reject" },
    );
    expect(r.status).toBe(200);
    expect(r.body.reopened).toBe(true);
    expect(r.body.auditRecorded).toBe(true);
    const after = await db.settlement.milestones.getById(m.id);
    expect(after?.status).toBe("PENDING");
    expect(after?.submissionRef).toBeNull();
    const actions = await listAdminActions(db);
    expect(actions.at(-1)?.action).toBe("REOPEN_MILESTONE");

    // Guards: no operator → 400; no reason → 400.
    const noOp = await adminReq(
      "POST",
      `/admin/settlement/milestones/${m.id}/reopen`,
      {},
    );
    expect(noOp.status).toBe(400);
    const noReason = await adminReq(
      "POST",
      `/admin/settlement/milestones/${m.id}/reopen`,
      {},
    );
    expect(noReason.status).toBe(400);
    // Idempotent on PENDING — reopened:false, no audit spam.
    const again = await adminReq(
      "POST",
      `/admin/settlement/milestones/${m.id}/reopen`,
      { reason: "retry" },
    );
    expect(again.status).toBe(200);
    expect(again.body.reopened).toBe(false);
  });

  // R9-M1: operator release — the audited undo for a standing APPROVED
  // ruling (`rsv_`/`ops_` epochs a buyer verdict may not touch). This
  // is the exit the `repair` log key points at.
  it("milestones/:id/release → APPROVED milestone PENDING + intent cancelled + audit", async () => {
    const { milestone, intentId } = await seedApprovedIntent();
    const before = (await listAdminActions(db)).length;
    const r = await adminReq(
      "POST",
      `/admin/settlement/milestones/${milestone.id}/release`,
      { reason: "undo resolver restore" },
    );
    expect(r.status).toBe(200);
    expect(r.body.released).toBe(true);
    expect(r.body.auditRecorded).toBe(true);
    const after = await db.settlement.milestones.getById(milestone.id);
    expect(after?.status).toBe("PENDING");
    expect(after?.escrowRef).toBeNull();
    expect(
      (await db.settlement.payoutIntents.getById(intentId))?.status,
    ).toBe("CANCELLED");
    const actions = await listAdminActions(db);
    expect(actions.length).toBe(before + 1);
    expect(actions.at(-1)?.action).toBe("FORCE_RELEASE_MILESTONE");
    // Guards: no operator → 400; non-APPROVED → 409.
    const noOp = await adminReq(
      "POST",
      `/admin/settlement/milestones/${milestone.id}/release`,
      {},
    );
    expect(noOp.status).toBe(400);
    const again = await adminReq(
      "POST",
      `/admin/settlement/milestones/${milestone.id}/release`,
      { reason: "retry" },
    );
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("INVALID_STATE");
  });

  // R10-M3: an in-atomic refusal (frozen intent) is a typed 409, not a
  // 200 `{released:false}` — scripts must not read refusal as success.
  it("milestones/:id/release → FROZEN intent refuses with 409 + reason", async () => {
    const { milestone, intentId } = await seedApprovedIntent();
    await db.settlement.payoutIntents.applyStatus(
      intentId,
      "OPEN",
      "FROZEN",
    );
    const before = (await listAdminActions(db)).length;
    const r = await adminReq(
      "POST",
      `/admin/settlement/milestones/${milestone.id}/release`,
      { reason: "undo frozen ruling" },
    );
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("INVALID_STATE");
    expect(r.body.error.message).toContain("intent_state");
    // No audit row and nothing moved.
    expect((await listAdminActions(db)).length).toBe(before);
    expect(
      (await db.settlement.milestones.getById(milestone.id))?.status,
    ).toBe("APPROVED");
    expect(
      (await db.settlement.payoutIntents.getById(intentId))?.status,
    ).toBe("FROZEN");
  });
});
