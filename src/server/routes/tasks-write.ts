// EPIC-206 (SLICE-206-5): agent-contour write surface — verdict_submit.
//
// External verifier submits PASS|REVISE|FAIL on a delivered task.
// Hard requirements (D-206-4/D-206-5):
//   - sig-auth: verifier IS the signer (X-Wallet/X-Sig/X-Timestamp,
//     EIP-191) — not an address in the body.
//   - independence: verifier ≠ owner / worker / platform signer → 403.
//   - idempotency-key header REQUIRED (206-2) — replays return the
//     stored response + duplicate:true with zero side-effects.
//   - evidence_refs/note bounded by contract guards.
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";
import { getTaskById, transitionTask } from "@agentbadge/passport";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { verifyWalletSigRequest } from "../middleware/agent-auth";
import { idempotentWrite, readIdempotencyKey } from "../lib/contract-guards";
import {
  applyVerdict,
  checkVerifierIndependence,
  verdictBodySchema,
  violationToErrorCode,
} from "../lib/tasks/verdict";

export const tasksWriteRoutes = new Hono();

tasksWriteRoutes.post(
  "/api/tasks/:id/verdict",
  describeRoute({
    tags: ["Agent Tasks"],
    summary: "Submit an external verdict (sig-auth + independence check)",
    description:
      "Verifier submits PASS (payment-path open), REVISE (re-deliver, " +
      "prior deliverable preserved in history) or FAIL (closed). " +
      "Requires sig-auth headers and idempotency-key. Verifier must not " +
      "be the task owner, worker, or a platform signer.",
    responses: {
      200: {
        description: "Verdict applied",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                task_id: z.string(),
                verdict: z.string(),
                status: z.string(),
                verification_attempts: z.number(),
                duplicate: z.boolean().optional(),
              }),
            ),
          },
        },
      },
      400: { description: "Invalid body or task state" },
      401: { description: "Missing/invalid sig-auth headers" },
      403: { description: "Verifier is owner, worker, or platform signer" },
      404: { description: "Task not found" },
    },
  }),
  async (c) => {
    // 1. sig-auth — the verifier is the signer, not a body field.
    const sig = await verifyWalletSigRequest({
      wallet: c.req.header("x-wallet"),
      signature: c.req.header("x-sig"),
      timestamp: c.req.header("x-timestamp"),
      method: c.req.method,
      path: c.req.path,
    });
    if (sig !== "valid") {
      return errorResponse(
        c,
        401,
        ErrorCodes.WRONG_SIGNER,
        "Missing or invalid sig-auth headers (X-Wallet/X-Sig/X-Timestamp)",
      );
    }
    const verifierWallet = c.req.header("x-wallet")!;

    // 2. idempotency_key required on this NEW write (206-2, D-206-5).
    const idem = readIdempotencyKey(c);
    if (idem instanceof Response) return idem;

    // 3. body
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
    }
    const parsed = verdictBodySchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        c,
        400,
        ErrorCodes.INVALID_INPUT,
        `Invalid verdict body: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
    }

    // 4. task lookup (dedupe below must come BEFORE the state gate —
    //    a legit retry arrives after the first write moved the state;
    //    that replay is exactly what idempotency is for).
    const taskId = c.req.param("id");
    const task = getTaskById(taskId);
    if (!task) {
      return errorResponse(c, 404, ErrorCodes.TASK_NOT_FOUND, "Task not found");
    }

    // 5. apply — replay-safe (stored first response + duplicate:true).
    //    State gate + independence run inside the producer: they execute
    //    only once, and the rejection is itself replayed on retries.
    const scope = `POST ${c.req.path}`;
    const outcome = await idempotentWrite(scope, idem, () => {
      const fresh = getTaskById(taskId);
      if (!fresh) {
        return { status: 404, body: { error: "Task not found", code: ErrorCodes.TASK_NOT_FOUND } };
      }
      if (fresh.status !== "delivered") {
        return {
          status: 400,
          body: {
            error: `Verdict requires delivered status, current: ${fresh.status}`,
            code: ErrorCodes.INVALID_INPUT,
          },
        };
      }
      const violation = checkVerifierIndependence(verifierWallet, fresh);
      if (violation) {
        return {
          status: 403,
          body: {
            error: `Independent verifier required: ${violation}`,
            code: violationToErrorCode(violation),
          },
        };
      }
      const applied = applyVerdict(fresh, parsed.data, verifierWallet);
      const tr = transitionTask(taskId, ["delivered"], applied.status, applied.extra);
      if (!tr.ok) {
        return {
          status: 409,
          body: {
            error: `Task moved while verdicting (now: ${tr.currentStatus})`,
            code: ErrorCodes.INVALID_INPUT,
          },
        };
      }
      return {
        status: 200,
        body: {
          task_id: taskId,
          verdict: parsed.data.verdict,
          status: applied.status,
          verification_attempts: (fresh.verificationAttempts ?? 0) + 1,
        },
      };
    });
    return c.json(outcome.body, outcome.status as 200 | 400 | 403 | 404 | 409);
  },
);
