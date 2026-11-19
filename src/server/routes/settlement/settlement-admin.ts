/**
 * SLICE-227-3 — admin settlement mutations behind adminAuth.
 *
 *   POST /admin/settlement/intents/:id/mark-paid   {operator, txHash, legId?}
 *   POST /admin/settlement/disputes/:id/resolve    {operator, resolution,
 *                                                   splitLegs?, note?,
 *                                                   resolverRef?}
 *
 * Mounted under `/admin/` so cacheHeadersMiddleware stamps
 * `no-store` for free (D-227-9 — the /api/admin/* cache bug A4 of 226).
 * Every successful effect writes an append-only AdminAction through the
 * shared finops repo and surfaces `auditRecorded` in the response;
 * failed negatives write nothing. `operator` is a self-declared label
 * (documented residual, review-1911 §3.1).
 */
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";

import { getDatabase } from "../../lib/database";
import {
  createSettlementCtx,
  markLegPaid,
  resolveDispute,
} from "../../lib/settlement/index.js";
import { adminAuth } from "../../middleware/adminAuth";
import { readBody } from "../finops/helpers";
import { jsonBody } from "../commerce/schemas";
import { respond, type SettlementRouteDeps } from "./helpers";
import { settlementMilestoneAdminRoutes } from "./settlement-admin-milestones";

const TAG = { tags: ["Admin Settlement"] };

const evmWallet = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const splitLeg = z.object({
  payee: evmWallet,
  amountUsdc: z.string().min(1).max(32),
  role: z.enum(["PROVIDER", "COLLABORATOR", "PLATFORM_FEE"]),
});
// M8: the declared schemas also validate — a malformed body is a 400,
// never a TypeError bubbling to a 500.
const markPaidBody = z.object({
  operator: z.string().min(1).max(128),
  txHash: z.string(),
  legId: z.string().max(128).optional(),
});
const resolveBody = z.object({
  operator: z.string().min(1).max(128),
  resolution: z.enum(["FOR_BUYER", "FOR_PROVIDER", "SPLIT"]),
  splitLegs: z.array(splitLeg).max(32).optional(),
  note: z.string().max(4000).optional(),
  resolverRef: z.string().max(128).optional(),
});
export function createSettlementAdminRoutes(
  deps: SettlementRouteDeps = {},
): Hono {
  const r = new Hono();
  const getDb = deps.getDb ?? getDatabase;

  r.post(
    "/admin/settlement/intents/:id/mark-paid",
    describeRoute({
      ...TAG,
      summary: "Mark a payout leg paid with a real txHash",
      description:
        "Operator attests the transfer for one leg (legId required when " +
        "the intent has multiple OPEN legs). txHash is format-validated, " +
        "replay-bound per (network, hash) and bound set-once; when a " +
        "VerifyPayoutTx adapter is wired it must pass. Response carries " +
        "auditRecorded for the append-only AdminAction.",
      requestBody: jsonBody(markPaidBody),
      responses: {
        200: {
          description: "Leg completed + AdminAction",
          content: {
            "application/json": {
              schema: resolver(
                z.object({ auditRecorded: z.boolean() }).passthrough(),
              ),
            },
          },
        },
        400: { description: "Missing operator / bad txHash" },
        401: { description: "Unauthorized" },
        404: { description: "Intent/leg not found" },
        409: { description: "Invalid state / txHash replay" },
        503: { description: "Verifier unavailable" },
      },
    }),
    adminAuth,
    async (c) => {
      const raw = await readBody(c);
      // operator absence keeps its dedicated code (OPERATOR_REQUIRED)
      // — schema validation covers the rest of the shape.
      if (typeof raw.operator !== "string" || raw.operator.length === 0) {
        return respond(c, {
          ok: false,
          error: { code: "OPERATOR_REQUIRED", message: "operator label required" },
        });
      }
      const b = markPaidBody.safeParse(raw);
      if (!b.success) {
        return respond(c, {
          ok: false,
          error: {
            code: "BAD_INPUT",
            message: `invalid mark-paid body: ${b.error.issues[0]?.message ?? "schema mismatch"}`,
          },
        });
      }
      const res = await markLegPaid(
        createSettlementCtx(getDb()),
        {
          intentId: c.req.param("id"),
          legId: b.data.legId,
          txHash: b.data.txHash,
          operator: b.data.operator,
        },
        {
          verifyTx: deps.verifyTx,
          requireVerification: deps.requireVerification,
          // R2-H2: forward the full expectation — chain id (string) and
          // the pinned treasury payer; previously dropped at the seam.
          chainId:
            deps.chainId === undefined ? undefined : String(deps.chainId),
          expectedPayer: deps.expectedPayer,
          usdcToken: deps.usdcToken,
        },
      );
      return respond(c, res);
    },
  );

  r.post(
    "/admin/settlement/disputes/:id/resolve",
    describeRoute({
      ...TAG,
      summary: "Resolve an open settlement dispute",
      description:
        "Operator arbitration: FOR_PROVIDER restores the frozen work to " +
        "payable, FOR_BUYER cancels it, SPLIT re-legs the intent with a " +
        "new split that must sum to the milestone amount. Response " +
        "carries auditRecorded for the append-only AdminAction.",
      requestBody: jsonBody(resolveBody),
      responses: {
        200: {
          description: "Dispute resolved + AdminAction",
          content: {
            "application/json": {
              schema: resolver(
                z.object({ auditRecorded: z.boolean() }).passthrough(),
              ),
            },
          },
        },
        400: { description: "Missing operator / bad resolution" },
        401: { description: "Unauthorized" },
        404: { description: "Dispute not found" },
        409: { description: "Invalid state" },
      },
    }),
    adminAuth,
    async (c) => {
      const raw = await readBody(c);
      if (typeof raw.operator !== "string" || raw.operator.length === 0) {
        return respond(c, {
          ok: false,
          error: { code: "OPERATOR_REQUIRED", message: "operator label required" },
        });
      }
      const b = resolveBody.safeParse(raw);
      if (!b.success) {
        return respond(c, {
          ok: false,
          error: {
            code: "BAD_INPUT",
            message: `invalid resolve body: ${b.error.issues[0]?.message ?? "schema mismatch"}`,
          },
        });
      }
      const res = await resolveDispute(createSettlementCtx(getDb()), {
        disputeId: c.req.param("id"),
        operator: b.data.operator,
        resolution: b.data.resolution,
        splitLegs: b.data.splitLegs,
        note: b.data.note,
        resolverRef: b.data.resolverRef,
      });
      return respond(c, res);
    },
  );

  // Milestone force-actions (approve R3-H3, reopen R5-M3) live in
  // settlement-admin-milestones.ts under the 300-line cap.
  r.route("/", settlementMilestoneAdminRoutes(deps));

  return r;
}
