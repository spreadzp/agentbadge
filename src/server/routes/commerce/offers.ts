/**
 * SLICE-224-3 (EPIC-224): offer routes — submit/list/accept/reject/withdraw.
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
  jsonBody,
  offerSubmitSchema,
  ok,
  row,
} from "./schemas";

export function createOfferRoutes(service: CommerceService): Hono {
  const r = new Hono();

  // POST /api/commerce/tasks/:id/offers — provider submits
  r.post(
    "/api/commerce/tasks/:id/offers",
    describeRoute({
      tags: ["Commerce"],
      summary: "Submit offer",
      description:
        "Provider wallet submits a single-round offer (price, proposal, eta) on an OPEN task (D-224-9). Buyer cannot offer on own task.",
      requestBody: jsonBody(offerSubmitSchema),
      responses: {
        ...created(z.object({ offer: row, duplicate: z.boolean() }), "Offer submitted"),
        ...errs(400, 401, 403, 404, 409),
      },
    }),
    async (c) => {
      const auth = await requireWallet(c);
      if (auth instanceof Response) return auth;
      const body = await readJson(c);
      if (body instanceof Response) return body;
      const parsed = offerSubmitSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          `invalid offer body: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`,
        );
      }
      try {
        const { offer, duplicate } = await service.offers.submit(
          auth.wallet,
          c.req.param("id"),
          parsed.data as Parameters<CommerceService["offers"]["submit"]>[2],
          idemKey(c),
          await requestFingerprint(c),
        );
        return c.json({ offer, duplicate }, duplicate ? 200 : 201);
      } catch (err) {
        return commerceError(c, err);
      }
    },
  );

  // GET /api/commerce/tasks/:id/offers — public list
  r.get(
    "/api/commerce/tasks/:id/offers",
    describeRoute({
      tags: ["Commerce"],
      summary: "List offers for task",
      responses: { ...ok(z.object({ offers: z.array(row) })), ...errs(404) },
    }),
    async (c) => {
      const id = c.req.param("id");
      const viewer = await scopedWallet(c);
      if (viewer instanceof Response) return viewer;
      const task = await service.tasks.get(id);
      // DRAFT is an existence-oracle — same 404 whether missing or hidden.
      if (!task || (task.status === "DRAFT" && task.buyerWallet !== viewer)) {
        return errorResponse(
          c,
          404,
          ErrorCodes.RESOURCE_NOT_FOUND,
          `task ${id} not found`,
        );
      }
      const offers = await service.offers.listByTask(id);
      return c.json({
        offers: offers.map((o) =>
          redactRow(o, [o.providerWallet, task.buyerWallet], viewer),
        ),
      });
    },
  );

  // POST /api/commerce/offers/:id/accept — buyer → Agreement ACTIVE
  r.post(
    "/api/commerce/offers/:id/accept",
    describeRoute({
      tags: ["Commerce"],
      summary: "Accept offer",
      description:
        "Buyer-only, single round (D-224-9): offer ACCEPTED → Agreement ACTIVE auto-created, task → IN_PROGRESS, RECORD_ONLY payment row NOT_PAID (D-224-4).",
      responses: {
        ...ok(z.object({ offer: row, agreement: row, payment: row })),
        ...errs(401, 403, 404, 409),
      },
    }),
    async (c) => {
      const auth = await requireWallet(c);
      if (auth instanceof Response) return auth;
      try {
        const out = await service.offers.accept(auth.wallet, c.req.param("id"));
        return c.json(out);
      } catch (err) {
        return commerceError(c, err);
      }
    },
  );

  // POST /api/commerce/offers/:id/reject — buyer
  r.post(
    "/api/commerce/offers/:id/reject",
    describeRoute({
      tags: ["Commerce"],
      summary: "Reject offer",
      description: "Buyer-only: PENDING → REJECTED.",
      responses: { ...ok(z.object({ offer: row })), ...errs(401, 403, 404, 409) },
    }),
    async (c) => {
      const auth = await requireWallet(c);
      if (auth instanceof Response) return auth;
      try {
        const offer = await service.offers.reject(auth.wallet, c.req.param("id"));
        return c.json({ offer });
      } catch (err) {
        return commerceError(c, err);
      }
    },
  );

  // POST /api/commerce/offers/:id/withdraw — provider
  r.post(
    "/api/commerce/offers/:id/withdraw",
    describeRoute({
      tags: ["Commerce"],
      summary: "Withdraw offer",
      description: "Provider-only: PENDING → WITHDRAWN.",
      responses: { ...ok(z.object({ offer: row })), ...errs(401, 403, 404, 409) },
    }),
    async (c) => {
      const auth = await requireWallet(c);
      if (auth instanceof Response) return auth;
      try {
        const offer = await service.offers.withdraw(auth.wallet, c.req.param("id"));
        return c.json({ offer });
      } catch (err) {
        return commerceError(c, err);
      }
    },
  );

  return r;
}
