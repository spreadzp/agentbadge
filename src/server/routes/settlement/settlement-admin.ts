/**
 * SLICE-227-3 — admin settlement mutations; 264-8 → operatorAuth.
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
 * failed negatives write nothing.
 *
 * SLICE-264-8: operatorAuth — the actor is the credential principal;
 * a self-declared `operator` body field is a typed 400 (same posture
 * as the credential principal at the middleware boundary).
 */
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";

import { getDatabase } from "../../lib/database";
import { pickOperatorStores } from "../../lib/operators";
import {
  createSettlementCtx,
  markLegPaid,
  resolveDispute,
} from "../../lib/settlement/index.js";
import { operatorAuth, principalId } from "../../middleware/operatorAuth";
import { capabilityGate } from "../../middleware/operator-gate";
import { readBody, rejectOperatorField } from "../finops/helpers";
import { jsonBody } from "../commerce/schemas";
import { respond, type SettlementRouteDeps } from "./helpers";
import type { SettlementResult } from "../../lib/settlement/index.js";
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
  txHash: z.string(),
  legId: z.string().max(128).optional(),
});
const resolveBody = z.object({
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
  const opStore = deps.operatorStore ?? pickOperatorStores(getDb());

  // 264-8: the whole admin settlement surface is workflow-scoped —
  // credential → principal, capability from the record (never body).
  r.use("/admin/settlement/*", operatorAuth(opStore), capabilityGate());

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
        400: { description: "Bad body / operator field sent" },
        401: { description: "Unauthorized" },
        404: { description: "Intent/leg not found" },
        409: { description: "Invalid state / txHash replay" },
        503: { description: "Verifier unavailable" },
      },
    }),
    async (c) => {
      const actor = principalId(c);
      if (actor instanceof Response) return actor;
      const raw = await readBody(c);
      const opf = rejectOperatorField(raw);
      if (opf) return respond(c, opf as SettlementResult<never>);
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
          operator: actor,
          principalId: actor,
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
        400: { description: "Bad body / operator field sent" },
        401: { description: "Unauthorized" },
        404: { description: "Dispute not found" },
        409: { description: "Invalid state" },
      },
    }),
    async (c) => {
      const actor = principalId(c);
      if (actor instanceof Response) return actor;
      const raw = await readBody(c);
      const opf = rejectOperatorField(raw);
      if (opf) return respond(c, opf as SettlementResult<never>);
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
        operator: actor,
        principalId: actor,
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
