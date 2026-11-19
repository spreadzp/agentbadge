/**
 * SLICE-227-8 — admin milestone mutations behind adminAuth (300-line
 * split from settlement-admin.ts).
 *
 *   POST /admin/settlement/milestones/:id/approve  {operator, reason,
 *                                                   submissionRef?}
 *   POST /admin/settlement/milestones/:id/reopen   {operator, reason}
 *
 * Force-approve is the recovery seam for a stranded READY milestone
 * (R3-H3); reopen is the safe exit for a milestone stuck READY after a
 * failed/raced reject-release (R5-M3) — it frees the milestone without
 * paying rejected work. Every landed effect writes an append-only
 * AdminAction and surfaces `auditRecorded` in the response.
 */
import { Hono, type Context } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";

import { getDatabase } from "../../lib/database";
import {
  createSettlementCtx,
  forceApproveMilestone,
  forceReopenMilestone,
} from "../../lib/settlement/index.js";
import { adminAuth } from "../../middleware/adminAuth";
import { readBody } from "../finops/helpers";
import { jsonBody } from "../commerce/schemas";
import { respond, type SettlementRouteDeps } from "./helpers";

const TAG = { tags: ["Admin Settlement"] };

// R4-M4: force actions are payout-authorizing/state-moving — a reason
// is mandatory evidence, not decoration.
const operatorBody = z.object({
  operator: z.string().min(1).max(128),
  reason: z.string().min(1).max(4000),
  submissionRef: z.string().max(128).optional(),
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
        "EVALUATOR_VERDICT legacy plan). Idempotent on APPROVED only " +
        "while the intent is OPEN; an OPEN dispute on the milestone " +
        "409s. Requires a reason; writes an AdminAction and the event " +
        "records admin:true.",
      requestBody: jsonBody(operatorBody),
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
      const b = operatorBody.safeParse(raw);
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
        "failed or raced (R4-M5 residual). Idempotent on non-READY; " +
        "requires a reason; writes an AdminAction.",
      requestBody: jsonBody(operatorBody),
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
      },
    }),
    adminAuth,
    async (c) => {
      const raw = await readBody(c);
      const bad = await requireOperatorLabel(c, raw);
      if (bad) return bad;
      const b = operatorBody.safeParse(raw);
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

  return r;
}
