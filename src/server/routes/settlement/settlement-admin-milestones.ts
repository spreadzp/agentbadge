/**
 * SLICE-227-8 — admin milestone mutations behind adminAuth (300-line
 * split from settlement-admin.ts).
 *
 *   POST /admin/settlement/milestones/:id/approve  {operator, reason,
 *                                                   submissionRef?}
 *   POST /admin/settlement/milestones/:id/reopen   {operator, reason}
 *   POST /admin/settlement/milestones/:id/release  {operator, reason}
 *
 * Force-approve is the recovery seam for a stranded READY milestone
 * (R3-H3); reopen is the safe exit for a milestone stuck READY after a
 * failed/raced reject-release (R5-M3) — it frees the milestone without
 * paying rejected work; release (R9-M1) is the audited undo for a
 * standing APPROVED ruling (`rsv_`/`ops_` epochs a buyer verdict may
 * not touch). Every landed effect writes an append-only AdminAction
 * and surfaces `auditRecorded` in the response.
 */
import { Hono, type Context } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";

import { getDatabase } from "../../lib/database";
import {
  createSettlementCtx,
  forceApproveMilestone,
  forceReleaseMilestone,
  forceReopenMilestone,
} from "../../lib/settlement/index.js";
import { adminAuth } from "../../middleware/adminAuth";
import { readBody } from "../finops/helpers";
import { jsonBody } from "../commerce/schemas";
import { respond, type SettlementRouteDeps } from "./helpers";

const TAG = { tags: ["Admin Settlement"] };

// R4-M4: force actions are payout-authorizing/state-moving — a reason
// is mandatory evidence, not decoration. R6-M3: 2000 chars keeps the
// serialized evidence row under its 4 KB cap next to the forensic
// fields (the service enforces the same serialized bound).
const approveBody = z.object({
  operator: z.string().min(1).max(128),
  reason: z.string().min(1).max(2000),
  submissionRef: z.string().max(128).optional(),
});

// R6 nit 8: the reopen endpoint takes no submissionRef — a shared
// schema would silently drop it, so reopen gets its own.
const reopenBody = z.object({
  operator: z.string().min(1).max(128),
  reason: z.string().min(1).max(2000),
});

// R13-M2/M3: release gets its own body — confirmCancel opts into the
// irreversible COMPLETED-agreement cancel; acknowledgeInFlight
// overrides a dormant in-flight gate (both land in audit evidence).
const releaseBody = reopenBody.extend({
  confirmCancel: z.boolean().optional(),
  acknowledgeInFlight: z.boolean().optional(),
});

const requireOperatorLabel = async (
  c: Context,
  raw: Record<string, unknown>,
) => {
  if (typeof raw.operator !== "string" || raw.operator.length === 0) {
    return respond(c, {
      ok: false,
      error: { code: "OPERATOR_REQUIRED", message: "operator label required" },
    });
  }
  return null;
};

export function settlementMilestoneAdminRoutes(
  deps: SettlementRouteDeps = {},
): Hono {
  const r = new Hono();
  const getDb = deps.getDb ?? getDatabase;

  // R3-H3: operator recovery for a milestone stranded READY — the
  // buyer approve path is unreachable once a review's post-commit
  // approve missed (pre-R3) or the policy is EVALUATOR_VERDICT on a
  // legacy plan. Idempotent on APPROVED; blocked by OPEN disputes.
  r.post(
    "/admin/settlement/milestones/:id/approve",
    describeRoute({
      ...TAG,
      summary: "Force-approve a READY milestone (operator recovery)",
      description:
        "Transitions a READY milestone to APPROVED and opens its payout " +
        "intent when the buyer path cannot (stranded post-commit state, " +
        "EVALUATOR_VERDICT legacy plan). Idempotent replay only on an " +
        "`ops_` epoch — a commerce (`appr_`) or resolver (`rsv_`) " +
        "approval refuses (use force-release or the dispute path); an " +
        "OPEN dispute on the milestone 409s. Requires a reason; " +
        "writes an AdminAction and the event records admin:true.",
      requestBody: jsonBody(approveBody),
      responses: {
        200: {
          description: "Milestone approved + payout intent",
          content: {
            "application/json": {
              schema: resolver(
                z.object({ intentId: z.string() }).passthrough(),
              ),
            },
          },
        },
        400: { description: "Missing operator / reason" },
        401: { description: "Unauthorized" },
        404: { description: "Milestone not found" },
        409: { description: "Invalid state / open dispute" },
      },
    }),
    adminAuth,
    async (c) => {
      const raw = await readBody(c);
      const bad = await requireOperatorLabel(c, raw);
      if (bad) return bad;
      const b = approveBody.safeParse(raw);
      if (!b.success) {
        return respond(c, {
          ok: false,
          error: {
            code: "BAD_INPUT",
            message: `invalid approve body: ${b.error.issues[0]?.message ?? "schema mismatch"}`,
          },
        });
      }
      const res = await forceApproveMilestone(
        createSettlementCtx(getDb()),
        c.req.param("id"),
        {
          operator: b.data.operator,
          reason: b.data.reason,
          submissionRef: b.data.submissionRef,
        },
      );
      return respond(c, res);
    },
  );

  // R5-M3: operator recovery for a milestone stuck READY after a lost
  // or raced reject-release — READY→PENDING + unbind, so the
  // resubmission round can rebind it. Unlike force-approve this never
  // pays rejected work. Idempotent on non-READY.
  r.post(
    "/admin/settlement/milestones/:id/reopen",
    describeRoute({
      ...TAG,
      summary: "Reopen a stuck READY milestone (operator recovery)",
      description:
        "Releases a READY milestone back to PENDING and clears its " +
        "submissionRef — the safe exit when a reject-verdict release " +
        "failed or raced (R4-M5 residual). Under a CLOSED commerce " +
        "agreement the cleanup lands CANCELLED instead (`cancelled:true`) " +
        "— PENDING would orphan. Idempotent on non-READY (reopened:false " +
        "when the row already moved); requires a reason; writes an " +
        "AdminAction only when the transition landed.",
      requestBody: jsonBody(reopenBody),
      responses: {
        200: {
          description: "Milestone released to PENDING + AdminAction",
          content: {
            "application/json": {
              schema: resolver(
                z.object({ reopened: z.boolean() }).passthrough(),
              ),
            },
          },
        },
        400: { description: "Missing operator / reason" },
        401: { description: "Unauthorized" },
        404: { description: "Milestone not found" },
        409: {
          description:
            "Live OPEN/FROZEN payout intent / verdict in flight / " +
            "would_cancel_accepted_work (COMPLETED agreement + ACCEPTED " +
            "bound submission — the owed entitlement's exit is " +
            "force-approve, then release with confirmCancel)",
        },
        503: { description: "Cannot verify agreement/submission state" },
      },
    }),
    adminAuth,
    async (c) => {
      const raw = await readBody(c);
      const bad = await requireOperatorLabel(c, raw);
      if (bad) return bad;
      const b = reopenBody.safeParse(raw);
      if (!b.success) {
        return respond(c, {
          ok: false,
          error: {
            code: "BAD_INPUT",
            message: `invalid reopen body: ${b.error.issues[0]?.message ?? "schema mismatch"}`,
          },
        });
      }
      const res = await forceReopenMilestone(
        createSettlementCtx(getDb()),
        c.req.param("id"),
        { operator: b.data.operator, reason: b.data.reason },
      );
      return respond(c, res);
    },
  );

  // R9-M1: the operator exit the `repair` log key points at — audited
  // APPROVED→PENDING + intent cancel for a ruling that must be undone
  // (a resolver restore or force-approve left standing under a
  // rejected submission). Refuses when a leg already paid (that's a
  // refund path, not a release) or the intent is dispute-frozen.
  r.post(
    "/admin/settlement/milestones/:id/release",
    describeRoute({
      ...TAG,
      summary: "Force-release an APPROVED milestone (operator ruling undo)",
      description:
        "Releases an APPROVED milestone back to PENDING and cancels its " +
        "OPEN payout intent — the audited undo for a resolver-restored " +
        "or force-minted approval a buyer verdict cannot touch; it is " +
        "also the operator's deliberate un-accept of a commerce " +
        "(`appr_`) approval while the agreement is live. Under a " +
        "terminal agreement the cleanup lands CANCELLED instead — a " +
        "PENDING row would orphan; CANCELLED agreements auto-cancel, " +
        "COMPLETED requires `confirmCancel:true` (an APPROVED row " +
        "there is usually an owed payout — 409 " +
        "would_cancel_approved_payout without it). `acknowledgeInFlight:true` " +
        "overrides a dormant in-flight gate — a verdict observed " +
        "ACCEPTED immediately after the release reports " +
        "`verdictLanded:true` (point-in-time sample — a verdict " +
        "committing after the read is a documented residual). 409 when a " +
        "leg already paid, the intent is dispute-frozen, the milestone " +
        "is not APPROVED, the approval epoch moved on, or an owned " +
        "verdict is in flight. A release that orphans in the last " +
        "race window reports `orphaned:true`. Requires a reason; " +
        "writes an AdminAction.",
      requestBody: jsonBody(releaseBody),
      responses: {
        200: {
          description: "Milestone released to PENDING + AdminAction",
          content: {
            "application/json": {
              schema: resolver(
                z.object({ released: z.boolean() }).passthrough(),
              ),
            },
          },
        },
        400: { description: "Missing operator / reason" },
        401: { description: "Unauthorized" },
        404: { description: "Milestone not found" },
        409: {
          description:
            "Not APPROVED / paid leg / frozen intent / agreement not ACTIVE / verdict in flight",
        },
        503: { description: "Cannot verify agreement/submission state" },
      },
    }),
    adminAuth,
    async (c) => {
      const raw = await readBody(c);
      const bad = await requireOperatorLabel(c, raw);
      if (bad) return bad;
      const b = releaseBody.safeParse(raw);
      if (!b.success) {
        return respond(c, {
          ok: false,
          error: {
            code: "BAD_INPUT",
            message: `invalid release body: ${b.error.issues[0]?.message ?? "schema mismatch"}`,
          },
        });
      }
      const res = await forceReleaseMilestone(
        createSettlementCtx(getDb()),
        c.req.param("id"),
        {
          operator: b.data.operator,
          reason: b.data.reason,
          confirmCancel: b.data.confirmCancel,
          acknowledgeInFlight: b.data.acknowledgeInFlight,
        },
      );
      return respond(c, res);
    },
  );

  return r;
}
