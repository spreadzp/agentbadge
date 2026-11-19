/**
 * SLICE-227-3 — public settlement routes (sig-auth, EIP-191 v2).
 *
 *   POST /api/settlement/plans                     create/attach a plan
 *   GET  /api/settlement/agreements/:agreementId   participant read view
 *   POST /api/settlement/milestones/:id/dispute    raise a dispute
 *
 * (Receipt projection + anchor live in settlement-receipts.ts —
 * SLICE-227-4.)
 *
 * Auth reuses the commerce sig gate (agentbadge-commerce:v2 challenge,
 * D-224-8) — settlement is agent commerce; the caller wallet must be the
 * plan's buyer or provider. Writes dedupe naturally (agreementRef unique,
 * OPEN-dispute dedupe) so idem replays answer duplicate:true.
 */
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";

import { getDatabase } from "../../lib/database";
import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import {
  createPlan,
  createSettlementCtx,
  getAgreementView,
  isParticipant,
  raiseDispute,
} from "../../lib/settlement/index.js";
import {
  idemKey,
  readJson,
  requireWallet,
  scopedWallet,
} from "../commerce/shared";
import { errs, jsonBody, ok as okResp, row } from "../commerce/schemas";
import { respond, type SettlementRouteDeps } from "./helpers";

const TAG = { tags: ["Settlement"] };

const evmWallet = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "EVM address expected");

const legInput = z.object({
  payee: evmWallet,
  amountUsdc: z.string().min(1).max(32),
  role: z.enum(["PROVIDER", "COLLABORATOR", "PLATFORM_FEE"]),
});

const milestoneInput = z.object({
  milestoneId: z.string().min(1).max(128),
  title: z.string().min(1).max(256),
  amountUsd: z.string().min(1).max(32),
  acceptanceCriteria: z.string().max(4000).optional(),
  dueAtMs: z.number().int().positive().optional(),
  releasePolicy: z.enum(["BUYER_ACCEPT", "EVALUATOR_VERDICT"]).optional(),
  legs: z.array(legInput).max(32).optional(),
});

const planCreateSchema = z.object({
  agreementRef: z.string().min(1).max(128),
  buyerWallet: evmWallet,
  providerWallet: evmWallet,
  currency: z.string().min(1).max(16).optional(),
  totalUsd: z.string().min(1).max(32),
  milestones: z.array(milestoneInput).min(1).max(64),
});

const disputeRaiseSchema = z.object({
  reason: z.string().min(1).max(4000),
  evidenceRefs: z.array(z.string().max(1000)).max(50).optional(),
});

export function createSettlementRoutes(
  deps: SettlementRouteDeps = {},
): Hono {
  const r = new Hono();
  const getDb = deps.getDb ?? getDatabase;

  // POST /api/settlement/plans — participant creates/links the plan
  r.post(
    "/api/settlement/plans",
    describeRoute({
      ...TAG,
      summary: "Create a milestone settlement plan",
      description:
        "Participant wallet (buyer or provider) declares the milestone " +
        "structure for an agreement. sum(milestones.amountUsd) must equal " +
        "totalUsd; optional per-milestone leg templates split the payout. " +
        "One plan per agreementRef — a replay returns duplicate:true.",
      requestBody: jsonBody(planCreateSchema),
      responses: {
        201: {
          description: "Plan created",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  plan: row,
                  milestones: z.array(row),
                  duplicate: z.boolean(),
                }).passthrough(),
              ),
            },
          },
        },
        200: { description: "Plan already exists (duplicate:true)" },
        ...errs(400, 401, 403, 409),
      },
    }),
    async (c) => {
      const auth = await requireWallet(c, { allowIdemReplay: true });
      if (auth instanceof Response) return auth;
      const body = await readJson(c);
      if (body instanceof Response) return body;
      const parsed = planCreateSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          `invalid plan body: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`,
        );
      }
      void idemKey(c); // dedupe is natural — unique agreementRef
      const res = await createPlan(
        createSettlementCtx(getDb()),
        parsed.data,
        auth.wallet,
      );
      return res.ok
        ? c.json(res.value, res.value.duplicate ? 200 : 201)
        : respond(c, res);
    },
  );

  // GET /api/settlement/agreements/:agreementId — participant view
  r.get(
    "/api/settlement/agreements/:agreementId",
    describeRoute({
      ...TAG,
      summary: "Agreement settlement view",
      description:
        "Plan + milestones + payout intents + disputes for an agreement. " +
        "Participant-only — unsigned or non-party callers get 404 " +
        "(existence-oracle, same as commerce DRAFT).",
      responses: {
        ...okResp(z.object({ plan: row, milestones: z.array(row) }).passthrough()),
        ...errs(401, 404),
      },
    }),
    async (c) => {
      const viewer = await scopedWallet(c);
      if (viewer instanceof Response) return viewer;
      if (viewer === null) {
        return errorResponse(
          c,
          401,
          ErrorCodes.UNAUTHORIZED,
          "participant signature required",
        );
      }
      const view = await getAgreementView(
        createSettlementCtx(getDb()),
        c.req.param("agreementId"),
      );
      if (
        !view ||
        !isParticipant(
          viewer,
          view.plan.buyerWallet,
          view.plan.providerWallet,
        )
      ) {
        return errorResponse(
          c,
          404,
          ErrorCodes.RESOURCE_NOT_FOUND,
          `agreement ${c.req.param("agreementId")} not found`,
        );
      }
      return c.json(view);
    },
  );

  // POST /api/settlement/milestones/:id/dispute — participant raise
  r.post(
    "/api/settlement/milestones/:id/dispute",
    describeRoute({
      ...TAG,
      summary: "Raise a milestone dispute",
      description:
        "Participant-only. Freezes the milestone, its payout intent " +
        "and legs, and marks the plan DISPUTED until an operator " +
        "resolves. A second OPEN dispute on the same subject returns " +
        "duplicate:true.",
      requestBody: jsonBody(disputeRaiseSchema),
      responses: {
        ...okResp(z.object({ dispute: row, duplicate: z.boolean() }).passthrough()),
        ...errs(400, 401, 403, 404, 409),
      },
    }),
    async (c) => {
      const auth = await requireWallet(c, { allowIdemReplay: true });
      if (auth instanceof Response) return auth;
      const body = await readJson(c);
      if (body instanceof Response) return body;
      const parsed = disputeRaiseSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          `invalid dispute body: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`,
        );
      }
      const res = await raiseDispute(createSettlementCtx(getDb()), {
        subjectType: "MILESTONE",
        subjectRef: c.req.param("id"),
        raisedBy: auth.wallet,
        reason: parsed.data.reason,
        evidenceRefs: parsed.data.evidenceRefs,
      });
      return respond(c, res);
    },
  );

  return r;
}
