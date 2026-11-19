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

const TAG = { tags: ["Admin Settlement"] };

const evmWallet = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const splitLeg = z.object({
  payee: evmWallet,
  amountUsdc: z.string().min(1).max(32),
  role: z.enum(["PROVIDER", "COLLABORATOR", "PLATFORM_FEE"]),
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
      requestBody: jsonBody(
        z.object({
          operator: z.string().min(1).max(128),
          txHash: z.string(),
          legId: z.string().max(128).optional(),
        }),
      ),
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
      const b = await readBody(c);
      const res = await markLegPaid(
        createSettlementCtx(getDb()),
        {
          intentId: c.req.param("id"),
          legId: typeof b.legId === "string" ? b.legId : undefined,
          txHash: typeof b.txHash === "string" ? b.txHash : "",
          operator: typeof b.operator === "string" ? b.operator : "",
        },
        {
          verifyTx: deps.verifyTx,
          requireVerification: deps.requireVerification,
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
      requestBody: jsonBody(
        z.object({
          operator: z.string().min(1).max(128),
          resolution: z.enum(["FOR_BUYER", "FOR_PROVIDER", "SPLIT"]),
          splitLegs: z.array(splitLeg).max(32).optional(),
          note: z.string().max(4000).optional(),
          resolverRef: z.string().max(128).optional(),
        }),
      ),
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
      const b = await readBody(c);
      const res = await resolveDispute(createSettlementCtx(getDb()), {
        disputeId: c.req.param("id"),
        operator: typeof b.operator === "string" ? b.operator : "",
        resolution: b.resolution as never,
        splitLegs: Array.isArray(b.splitLegs)
          ? (b.splitLegs as never)
          : undefined,
        note: typeof b.note === "string" ? b.note : undefined,
        resolverRef: typeof b.resolverRef === "string" ? b.resolverRef : undefined,
      });
      return respond(c, res);
    },
  );

  return r;
}
