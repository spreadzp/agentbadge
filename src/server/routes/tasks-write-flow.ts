// EPIC-206 (SLICE-206-6): agent write flow — bid → award → deliver.
//
// SaSame semantics on our market lifecycle (D-206-7):
//   POST /bids         → bid SUBMITTED (separate entity; several allowed)
//   POST /awards       → owner picks a bid = the claim commit
//                        (claimerDid = winning wallet; others rejected)
//   POST /deliverables → awarded worker delivers → DELIVERED
//   verdict            → SLICE-206-5 (tasks-write.ts)
//
// All endpoints: sig-auth signer = actor identity, idempotency-key
// REQUIRED (206-2 dedupe BEFORE state gates — retries replay the
// stored first response), bounded evidence/summary via guards.
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";
import { getTaskById, transitionTask } from "@agentbadge/passport";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { idempotentWrite, readIdempotencyKey } from "../lib/contract-guards";
import { requireSigAuth } from "../lib/tasks/sig-auth";
import { identitySet } from "../lib/tasks/verdict";
import {
  addBid,
  addDeliverable,
  awardBodySchema,
  bidBodySchema,
  deliverableBodySchema,
  hasActiveBid,
  markAwarded,
} from "../lib/tasks/bids";

export const tasksWriteFlowRoutes = new Hono();

const writeResp = resolver(
  z.object({
    task_id: z.string().optional(),
    status: z.string().optional(),
    error: z.string().optional(),
    code: z.string().optional(),
  }).loose(),
);

const writeResponses = {
  200: { description: "Write applied", content: { "application/json": { schema: writeResp } } },
  400: { description: "Invalid body or state" },
  401: { description: "Missing/invalid sig-auth headers" },
  403: { description: "Wrong actor for this operation" },
  404: { description: "Task or bid not found" },
  409: { description: "Conflict (duplicate bid or race)" },
};

async function jsonBody(c: Parameters<typeof errorResponse>[0]): Promise<unknown | Response> {
  try {
    return await c.req.json();
  } catch {
    return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
  }
}

tasksWriteFlowRoutes.post(
    "/api/tasks/:id/bids",
    describeRoute({
      tags: ["Agent Tasks"],
      summary: "Submit a bid on an open task (sig-auth)",
      description:
        "Any agent may bid — optional price, eta_seconds, note. One " +
        "active bid per wallet per task. idempotency-key required.",
      responses: writeResponses,
    }),
    async (c) => {
      const auth = await requireSigAuth(c);
      if (auth instanceof Response) return auth;
      const idem = readIdempotencyKey(c);
      if (idem instanceof Response) return idem;
      const raw = await jsonBody(c);
      if (raw instanceof Response) return raw;
      const parsed = bidBodySchema.safeParse(raw);
      if (!parsed.success) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT,
          `Invalid bid body: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      }
      const taskId = c.req.param("id");
      const outcome = await idempotentWrite(`POST ${c.req.path}`, idem, () => {
        const task = getTaskById(taskId);
        if (!task) {
          return { status: 404, body: { error: "Task not found", code: ErrorCodes.TASK_NOT_FOUND } };
        }
        if (task.status !== "posted") {
          return {
            status: 400,
            body: { error: `Task not open for bids, current: ${task.status}`, code: ErrorCodes.INVALID_INPUT },
          };
        }
        if (hasActiveBid(taskId, auth)) {
          return {
            status: 409,
            body: { error: "Active bid already submitted by this wallet", code: ErrorCodes.BID_ALREADY_SUBMITTED },
          };
        }
        return { status: 200, body: addBid(taskId, auth, parsed.data) };
      });
      return c.json(outcome.body, outcome.status as 200 | 400 | 404 | 409);
    },
  );

  tasksWriteFlowRoutes.post(
    "/api/tasks/:id/awards",
    describeRoute({
      tags: ["Agent Tasks"],
      summary: "Award a bid — owner selects the winner (sig-auth)",
      description:
        "Owner-only: the award maps to the lifecycle claim commit " +
        "(claimerDid = winner wallet), other submitted bids rejected. " +
        "idempotency-key required.",
      responses: writeResponses,
    }),
    async (c) => {
      const auth = await requireSigAuth(c);
      if (auth instanceof Response) return auth;
      const idem = readIdempotencyKey(c);
      if (idem instanceof Response) return idem;
      const raw = await jsonBody(c);
      if (raw instanceof Response) return raw;
      const parsed = awardBodySchema.safeParse(raw);
      if (!parsed.success) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bid_id required");
      }
      const taskId = c.req.param("id");
      const outcome = await idempotentWrite(`POST ${c.req.path}`, idem, () => {
        const task = getTaskById(taskId);
        if (!task) {
          return { status: 404, body: { error: "Task not found", code: ErrorCodes.TASK_NOT_FOUND } };
        }
        if (!identitySet(task.posterDid).has(auth.toLowerCase())) {
          return {
            status: 403,
            body: { error: "Only the task owner may award bids", code: ErrorCodes.NOT_TASK_OWNER },
          };
        }
        if (task.status !== "posted") {
          return {
            status: 400,
            body: { error: `Task not open for awards, current: ${task.status}`, code: ErrorCodes.INVALID_INPUT },
          };
        }
        const bid = markAwarded(taskId, parsed.data.bid_id);
        if (!bid) {
          return {
            status: 404,
            body: { error: `Bid not found or not open: ${parsed.data.bid_id}`, code: ErrorCodes.BID_NOT_FOUND },
          };
        }
        const tr = transitionTask(taskId, ["posted"], "claimed", { claimerDid: bid.bidder_wallet });
        if (!tr.ok) {
          return {
            status: 409,
            body: { error: `Task moved while awarding (now: ${tr.currentStatus})`, code: ErrorCodes.INVALID_INPUT },
          };
        }
        return {
          status: 200,
          body: { task_id: taskId, awarded_bid: bid.bid_id, worker: bid.bidder_wallet, status: "claimed" },
        };
      });
      return c.json(outcome.body, outcome.status as 200 | 400 | 403 | 404 | 409);
    },
  );

  tasksWriteFlowRoutes.post(
    "/api/tasks/:id/deliverables",
    describeRoute({
      tags: ["Agent Tasks"],
      summary: "Submit a deliverable (sig-auth, awarded worker only)",
      description:
        "summary ≤4000 + evidence_refs ≤50×1000 + optional result_ipfs. " +
        "Maps to the lifecycle deliver commit; re-delivery after REVISE " +
        "keeps history. idempotency-key required.",
      responses: writeResponses,
    }),
    async (c) => {
      const auth = await requireSigAuth(c);
      if (auth instanceof Response) return auth;
      const idem = readIdempotencyKey(c);
      if (idem instanceof Response) return idem;
      const raw = await jsonBody(c);
      if (raw instanceof Response) return raw;
      const parsed = deliverableBodySchema.safeParse(raw);
      if (!parsed.success) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT,
          `Invalid deliverable: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      }
      const taskId = c.req.param("id");
      const outcome = await idempotentWrite(`POST ${c.req.path}`, idem, () => {
        const task = getTaskById(taskId);
        if (!task) {
          return { status: 404, body: { error: "Task not found", code: ErrorCodes.TASK_NOT_FOUND } };
        }
        if (task.status !== "claimed") {
          return {
            status: 400,
            body: { error: `Task not in deliver-phase, current: ${task.status}`, code: ErrorCodes.INVALID_INPUT },
          };
        }
        if (task.claimerDid?.toLowerCase() !== auth.toLowerCase()) {
          return {
            status: 403,
            body: { error: "Only the awarded worker may deliver", code: ErrorCodes.NOT_TASK_WORKER },
          };
        }
        const dlv = addDeliverable(taskId, auth, parsed.data);
        const tr = transitionTask(taskId, ["claimed"], "delivered", {
          resultBody: parsed.data.summary,
          resultIpfs: parsed.data.result_ipfs,
        });
        if (!tr.ok) {
          return {
            status: 409,
            body: { error: `Task moved while delivering (now: ${tr.currentStatus})`, code: ErrorCodes.INVALID_INPUT },
          };
        }
        return { status: 200, body: { task_id: taskId, deliverable_id: dlv.deliverable_id, status: "delivered" } };
      });
      return c.json(outcome.body, outcome.status as 200 | 400 | 403 | 404 | 409);
    },
  );
