/**
 * SLICE-224-3 (EPIC-224): task routes — create/list/detail/PATCH/cancel.
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
  ok,
  patchTaskSchema,
  row,
  taskCreateSchema,
} from "./schemas";

export function createTaskRoutes(service: CommerceService): Hono {
  const r = new Hono();

  // POST /api/commerce/tasks — create (DRAFT | OPEN)
  r.post(
    "/api/commerce/tasks",
    describeRoute({
      tags: ["Commerce"],
      summary: "Create commerce task",
      description:
        "Creates a commerce task owned by the signing wallet (buyer). status OPEN makes it discoverable for offers; DRAFT stays private until PATCH {status:OPEN}. Idempotent on idempotency_key header.",
      requestBody: jsonBody(taskCreateSchema),
      responses: {
        ...created(z.object({ task: row, duplicate: z.boolean() }), "Task created"),
        ...errs(400, 401, 409),
      },
    }),
    async (c) => {
      // Idempotent write — store-level dedupe resolves a keyed
      // replay to duplicate:200, so the nonce guard exempts it.
      const auth = await requireWallet(c, { allowIdemReplay: true });
      if (auth instanceof Response) return auth;
      const body = await readJson(c);
      if (body instanceof Response) return body;
      const parsed = taskCreateSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          `invalid task body: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`,
        );
      }
      try {
        const { task, duplicate } = await service.tasks.create(
          auth.wallet,
          parsed.data as Parameters<CommerceService["tasks"]["create"]>[1],
          idemKey(c),
          await requestFingerprint(c),
        );
        return c.json({ task, duplicate }, duplicate ? 200 : 201);
      } catch (err) {
        return commerceError(c, err);
      }
    },
  );

  // GET /api/commerce/tasks — list (status|buyer|open|limit)
  r.get(
    "/api/commerce/tasks",
    describeRoute({
      tags: ["Commerce"],
      summary: "List commerce tasks",
      description:
        "Public list. Filters: status, buyer (wallet), open=true (shortcut for status=OPEN), limit (default 50, max 200).",
      responses: { ...ok(z.object({ tasks: z.array(row) })), ...errs(400) },
    }),
    async (c) => {
      const status = c.req.query("status");
      const open = c.req.query("open");
      const buyer = c.req.query("buyer");
      const limitRaw = c.req.query("limit");
      let limit: number | undefined;
      if (limitRaw !== undefined) {
        limit = Number(limitRaw);
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
          return errorResponse(
            c,
            400,
            ErrorCodes.INVALID_INPUT,
            "limit must be integer 1..200",
          );
        }
      }
      const viewer = await scopedWallet(c);
      if (viewer instanceof Response) return viewer;
      const tasks = await service.tasks.list({
        status: open === "true" ? "OPEN" : status,
        buyerWallet: buyer?.toLowerCase(),
        limit,
        // H4: DRAFTs surface only to their buyer; anonymous gets "".
        visibleTo: viewer ?? "",
      });
      return c.json({
        tasks: tasks.map((t) => redactRow(t, [t.buyerWallet], viewer)),
      });
    },
  );

  // GET /api/commerce/tasks/:id — detail with embedded graph
  r.get(
    "/api/commerce/tasks/:id",
    describeRoute({
      tags: ["Commerce"],
      summary: "Commerce task detail",
      description:
        "Task with embedded offers, agreement, RECORD_ONLY payment and submissions (D-224-10).",
      responses: {
        ...ok(
          z.object({
            task: row,
            offers: z.array(row),
            agreement: row.nullable(),
            payment: row.nullable(),
            submissions: z.array(row),
          }),
        ),
        ...errs(404),
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      const viewer = await scopedWallet(c);
      if (viewer instanceof Response) return viewer;
      const task = await service.tasks.get(id);
      if (!task) {
        return errorResponse(
          c,
          404,
          ErrorCodes.RESOURCE_NOT_FOUND,
          `task ${id} not found`,
        );
      }
      // H4: DRAFTs exist only for their buyer — 404, not 403 (no
      // existence oracle).
      if (task.status === "DRAFT" && task.buyerWallet !== viewer) {
        return errorResponse(
          c,
          404,
          ErrorCodes.RESOURCE_NOT_FOUND,
          `task ${id} not found`,
        );
      }
      const offers = await service.offers.listByTask(id);
      // D-227: multi-provider tasks can hold several agreements; the
      // legacy `agreement` field keeps the oldest for compat, and each
      // embedded agreement carries settlementRef (= its agreementRef
      // in /api/settlement/*).
      const agreements = await service.agreements.listByTaskId(id);
      const agreement = agreements[0] ?? null;
      const payment = agreement
        ? await service.payments.getByAgreement(agreement.id)
        : null;
      const submissions = agreement
        ? await service.submissions.listByAgreement(agreement.id)
        : [];
      const parties = agreements.length
        ? [
            task.buyerWallet,
            ...agreements.map((x) => x.providerWallet),
          ]
        : [task.buyerWallet];
      const withSettlementRef = (a: NonNullable<typeof agreement>) =>
        ({ ...a, settlementRef: a.id });
      return c.json({
        task: redactRow(task, [task.buyerWallet], viewer),
        offers: offers.map((o) =>
          redactRow(o, [o.providerWallet, task.buyerWallet], viewer),
        ),
        agreement: agreement
          ? redactRow(withSettlementRef(agreement), parties, viewer)
          : null,
        agreements: agreements.map((a) =>
          redactRow(withSettlementRef(a), parties, viewer),
        ),
        payment: payment
          ? redactRow(payment, parties, viewer, [
            "note",
            "paymentId",
            "recordedBy",
          ])
          : null,
        submissions: submissions.map((s) =>
          redactRow(s, parties, viewer, [
            "summary",
            "resultUrl",
            "reviewNote",
          ]),
        ),
      });
    },
  );

  // PATCH /api/commerce/tasks/:id — DRAFT → OPEN
  r.patch(
    "/api/commerce/tasks/:id",
    describeRoute({
      tags: ["Commerce"],
      summary: "Open a DRAFT task",
      description:
        "Buyer-only transition DRAFT→OPEN. Field updates on drafts are not supported in v1 (append-only stores).",
      requestBody: jsonBody(patchTaskSchema),
      responses: {
        ...ok(z.object({ task: row })),
        ...errs(400, 401, 403, 404, 409),
      },
    }),
    async (c) => {
      const auth = await requireWallet(c);
      if (auth instanceof Response) return auth;
      const body = await readJson(c);
      if (body instanceof Response) return body;
      const parsed = patchTaskSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          'only {"status":"OPEN"} transition is supported in v1',
        );
      }
      try {
        const task = await service.tasks.open(auth.wallet, c.req.param("id"));
        return c.json({ task });
      } catch (err) {
        return commerceError(c, err);
      }
    },
  );

  // POST /api/commerce/tasks/:id/cancel — buyer
  r.post(
    "/api/commerce/tasks/:id/cancel",
    describeRoute({
      tags: ["Commerce"],
      summary: "Cancel task",
      description:
        "Buyer-only. Cancels the task; cascades CANCELLED to an ACTIVE agreement. Payment status is independent (D-224-4).",
      responses: {
        ...ok(z.object({ task: row })),
        ...errs(401, 403, 404, 409),
      },
    }),
    async (c) => {
      const auth = await requireWallet(c);
      if (auth instanceof Response) return auth;
      try {
        const task = await service.tasks.cancel(auth.wallet, c.req.param("id"));
        return c.json({ task });
      } catch (err) {
        return commerceError(c, err);
      }
    },
  );

  return r;
}
