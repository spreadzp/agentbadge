/**
 * SLICE-224-3 (EPIC-224): flow routes — submissions, review, evidence,
 * RECORD_ONLY payment, event feed.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import z from "zod";
import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import type { CommerceService } from "../../lib/commerce";
import {
  commerceError,
  idemKey,
  readJson,
  redactRow,
  requestFingerprint,
  requireWallet,
  scopedWallet,
} from "./shared";
import {
  created,
  errs,
  evidenceSchema,
  jsonBody,
  ok,
  paymentRecordSchema,
  reviewSchema,
  row,
  submissionCreateSchema,
} from "./schemas";

export function createFlowRoutes(service: CommerceService): Hono {
  const r = new Hono();

  // POST /api/commerce/agreements/:id/submissions — provider work
  r.post(
    "/api/commerce/agreements/:id/submissions",
    describeRoute({
      tags: ["Commerce"],
      summary: "Submit work",
      description:
        "Provider-only on an ACTIVE agreement. summary ≤4000 chars, evidenceRefs ≤50×1000 (contract guards).",
      requestBody: jsonBody(submissionCreateSchema),
      responses: {
        ...created(z.object({ submission: row, duplicate: z.boolean() }), "Submission created"),
        ...errs(400, 401, 403, 404, 409),
      },
    }),
    async (c) => {
      const auth = await requireWallet(c);
      if (auth instanceof Response) return auth;
      const body = await readJson(c);
      if (body instanceof Response) return body;
      const parsed = submissionCreateSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          `invalid submission body: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`,
        );
      }
      try {
        const { submission, duplicate } = await service.submissions.submit(
          auth.wallet,
          c.req.param("id"),
          parsed.data as Parameters<CommerceService["submissions"]["submit"]>[2],
          idemKey(c),
          await requestFingerprint(c),
        );
        return c.json({ submission, duplicate }, duplicate ? 200 : 201);
      } catch (err) {
        return commerceError(c, err);
      }
    },
  );

  // GET /api/commerce/agreements/:id/submissions — public list
  r.get(
    "/api/commerce/agreements/:id/submissions",
    describeRoute({
      tags: ["Commerce"],
      summary: "List submissions for agreement",
      responses: { ...ok(z.object({ submissions: z.array(row) })), ...errs(404) },
    }),
    async (c) => {
      const id = c.req.param("id");
      const viewer = await scopedWallet(c);
      if (viewer instanceof Response) return viewer;
      const agreement = await service.agreements.get(id);
      if (!agreement) {
        return errorResponse(
          c,
          404,
          ErrorCodes.RESOURCE_NOT_FOUND,
          `agreement ${id} not found`,
        );
      }
      const parties = [agreement.buyerWallet, agreement.providerWallet];
      const submissions = await service.submissions.listByAgreement(id);
      return c.json({
        submissions: submissions.map((s) => redactRow(s, parties, viewer)),
      });
    },
  );

  // POST /api/commerce/submissions/:id/review — buyer verdict
  r.post(
    "/api/commerce/submissions/:id/review",
    describeRoute({
      tags: ["Commerce"],
      summary: "Review submission",
      description:
        "Buyer-only (D-224-5). ACCEPTED → task+agreement COMPLETED; REJECTED/REVISION_REQUIRED → task back to IN_PROGRESS for a resubmission round.",
      requestBody: jsonBody(reviewSchema),
      responses: {
        ...ok(z.object({ submission: row, task: row, agreement: row })),
        ...errs(400, 401, 403, 404, 409),
      },
    }),
    async (c) => {
      const auth = await requireWallet(c);
      if (auth instanceof Response) return auth;
      const body = await readJson(c);
      if (body instanceof Response) return body;
      const parsed = reviewSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          "verdict must be ACCEPTED|REJECTED|REVISION_REQUIRED",
        );
      }
      try {
        const out = await service.submissions.review(
          auth.wallet,
          c.req.param("id"),
          parsed.data.verdict,
          parsed.data.reviewNote,
        );
        return c.json(out);
      } catch (err) {
        return commerceError(c, err);
      }
    },
  );

  // POST /api/commerce/submissions/:id/evidence — attach evidence
  r.post(
    "/api/commerce/submissions/:id/evidence",
    describeRoute({
      tags: ["Commerce"],
      summary: "Attach evidence",
      description:
        "Agreement party attaches evidence to a submission. FILE = {url, sha256 hash} reference (D-224-11); TRANSACTION = txHash; URL/API_RESPONSE/ATTESTATION supported. Append-only.",
      requestBody: jsonBody(evidenceSchema),
      responses: {
        ...created(z.object({ evidence: row, duplicate: z.boolean() }), "Evidence attached"),
        ...errs(400, 401, 403, 404),
      },
    }),
    async (c) => {
      const auth = await requireWallet(c);
      if (auth instanceof Response) return auth;
      const body = await readJson(c);
      if (body instanceof Response) return body;
      const parsed = evidenceSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "invalid evidence shape");
      }
      try {
        const { evidence, duplicate } = await service.evidence.attach(
          auth.wallet,
          {
            ...parsed.data,
            submissionId: c.req.param("id"),
          } as Parameters<CommerceService["evidence"]["attach"]>[1],
          idemKey(c),
          await requestFingerprint(c),
        );
        return c.json({ evidence, duplicate }, duplicate ? 200 : 201);
      } catch (err) {
        return commerceError(c, err);
      }
    },
  );

  // POST /api/commerce/agreements/:id/payment — buyer records payment
  r.post(
    "/api/commerce/agreements/:id/payment",
    describeRoute({
      tags: ["Commerce"],
      summary: "Record payment (RECORD_ONLY)",
      description:
        "Buyer-only: NOT_PAID → PAYMENT_RECORDED. Manual record — no settlement in v1 (D-224-4/15). Payment status is independent of task status.",
      requestBody: jsonBody(paymentRecordSchema),
      responses: { ...ok(z.object({ payment: row })), ...errs(400, 401, 403, 404, 409) },
    }),
    async (c) => {
      const auth = await requireWallet(c);
      if (auth instanceof Response) return auth;
      const body = await readJson(c);
      if (body instanceof Response) return body;
      const parsed = paymentRecordSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          `invalid payment body: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`,
        );
      }
      try {
        const payment = await service.payments.record(
          auth.wallet,
          c.req.param("id"),
          parsed.data as Parameters<CommerceService["payments"]["record"]>[2],
        );
        return c.json({ payment });
      } catch (err) {
        return commerceError(c, err);
      }
    },
  );

  // POST /api/commerce/payments/:id/verify — provider/payee only (H3)
  r.post(
    "/api/commerce/payments/:id/verify",
    describeRoute({
      tags: ["Commerce"],
      summary: "Verify payment",
      description:
        "Provider/payee only: PAYMENT_RECORDED → PAYMENT_VERIFIED (human review, RECORD_ONLY mode). The buyer records; the payee verifies — no self-attested payments.",
      responses: { ...ok(z.object({ payment: row })), ...errs(401, 403, 404, 409) },
    }),
    async (c) => {
      const auth = await requireWallet(c);
      if (auth instanceof Response) return auth;
      try {
        const payment = await service.payments.verify(auth.wallet, c.req.param("id"));
        return c.json({ payment });
      } catch (err) {
        return commerceError(c, err);
      }
    },
  );

  // GET /api/commerce/tasks/:id/events — CommerceEvent feed
  r.get(
    "/api/commerce/tasks/:id/events",
    describeRoute({
      tags: ["Commerce"],
      summary: "Task event feed",
      description:
        "Append-only CommerceEvent stream for the task entity (hash-chained prevHash→hash, genesis sentinel). For polling.",
      responses: { ...ok(z.object({ events: z.array(row) })), ...errs(404) },
    }),
    async (c) => {
      const id = c.req.param("id");
      const viewer = await scopedWallet(c);
      if (viewer instanceof Response) return viewer;
      const task = await service.tasks.get(id);
      // DRAFT existence oracle — 404 either way.
      if (!task || (task.status === "DRAFT" && task.buyerWallet !== viewer)) {
        return errorResponse(
          c,
          404,
          ErrorCodes.RESOURCE_NOT_FOUND,
          `task ${id} not found`,
        );
      }
      return c.json({ events: await service.events.listByEntity("task", id) });
    },
  );

  return r;
}
