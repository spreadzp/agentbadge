/**
 * SLICE-226-3 — admin FinOps ops endpoints behind adminAuth.
 *
 *   GET  /admin/finance/refunds            — refund intents list (JSON)
 *   POST /admin/finance/refunds/:id/complete  {operator, txHash}
 *   POST /admin/finance/exceptions/detect     {operator}
 *   POST /admin/finance/exceptions/:id/resolve {operator, resolution, note?}
 *
 * Refund completion runs ONLY behind the injected VerifyRefundTx —
 * when no verifier is wired the endpoint 503s instead of trusting a
 * bare hash.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { getDatabase } from "../../lib/database";
import {
  completeRefundIntent,
  detectFromPaymentExceptions,
  listRefundIntents,
  recordAdminAction,
  requireOperator,
  resolveException,
} from "../../lib/finops/index";
import { adminAuth } from "../../middleware/adminAuth";
import type { FinopsRouteDeps } from "./helpers";
import { listLimit, readBody, respond } from "./helpers";

const TAG = { tags: ["Admin FinOps"] };

export function createFinopsOpsRoutes(deps: FinopsRouteDeps = {}): Hono {
  const routes = new Hono();
  const getDb = deps.getDb ?? getDatabase;

  routes.get(
    "/admin/finance/refunds",
    describeRoute({
      ...TAG,
      summary: "Refund intents list (admin)",
      responses: { 200: { description: "Refund intents, newest first" } },
    }),
    adminAuth,
    async (c) => {
      const q = new URL(c.req.url).searchParams;
      const status = q.get("status");
      const rows = await listRefundIntents(getDb(), {
        ...(status ? { status } : {}),
        limit: listLimit(q.get("limit")),
      });
      return c.json({ items: rows }, 200, {
        "Cache-Control": "no-store",
      });
    },
  );

  routes.post(
    "/admin/finance/refunds/:id/complete",
    describeRoute({
      ...TAG,
      summary: "Complete a refund intent behind verified txHash",
      responses: {
        200: { description: "Intent COMPLETED" },
        400: { description: "Missing operator/txHash" },
        401: { description: "Unauthorized" },
        404: { description: "Intent not found" },
        503: { description: "Tx verification not configured" },
      },
    }),
    adminAuth,
    async (c) => {
      if (!deps.verifyRefundTx) {
        return c.json(
          {
            error: {
              code: "PROVIDER_ERROR",
              message:
                "refund tx verification is not configured on this backend",
            },
          },
          503,
        );
      }
      const b = await readBody(c);
      const res = await completeRefundIntent(
        getDb(),
        {
          intentId: c.req.param("id"),
          txHash: typeof b.txHash === "string" ? b.txHash : "",
          operator: typeof b.operator === "string" ? b.operator : "",
        },
        deps.verifyRefundTx,
      );
      return respond(c, res);
    },
  );

  routes.post(
    "/admin/finance/exceptions/detect",
    describeRoute({
      ...TAG,
      summary: "Scan for reconciliation exceptions (audited)",
      responses: {
        200: { description: "Created + skipped exception ids" },
        400: { description: "Missing operator" },
        401: { description: "Unauthorized" },
      },
    }),
    adminAuth,
    async (c) => {
      const b = await readBody(c);
      // C4: operator validated BEFORE the scan — a missing operator
      // must not create exception rows with no audit behind them.
      const operator =
        typeof b.operator === "string" ? b.operator : "";
      const op = requireOperator(operator);
      if (op) return respond(c, op);
      const res = await detectFromPaymentExceptions(getDb(), {
        limit: listLimit(b.limit, 100, 100),
      });
      if (!res.ok) return respond(c, res);
      // N3: bounded evidence — counts + a capped id sample; full id
      // lists can exceed the 4 KB audit cap and break the audit write
      // permanently once the backlog is large.
      const createdIds = res.value.created.map((r) => r.id);
      const audit = await recordAdminAction(getDb(), {
        action: "DETECT_EXCEPTIONS",
        subjectType: "exception",
        subjectId: "scan",
        operator,
        evidence: {
          createdCount: createdIds.length,
          skippedCount: res.value.skipped.length,
          createdIds: createdIds.slice(0, 50),
          idsTruncated: createdIds.length > 50,
          skipped: res.value.skipped.slice(0, 50),
        },
      });
      return respond(c, audit.ok ? res : audit);
    },
  );

  routes.post(
    "/admin/finance/exceptions/:id/resolve",
    describeRoute({
      ...TAG,
      summary:
        "Resolve an exception — MATCHED|IGNORED|MANUAL_ADJUSTED|REFUNDED",
      responses: {
        200: { description: "Exception RESOLVED + audit" },
        400: { description: "Missing operator/resolution" },
        401: { description: "Unauthorized" },
        404: { description: "Exception not found" },
        409: { description: "Already resolved" },
      },
    }),
    adminAuth,
    async (c) => {
      const b = await readBody(c);
      const res = await resolveException(getDb(), {
        id: c.req.param("id"),
        operator: typeof b.operator === "string" ? b.operator : "",
        resolution: typeof b.resolution === "string" ? b.resolution : "",
        ...(typeof b.note === "string" && b.note.trim() !== ""
          ? { note: b.note }
          : {}),
      });
      return respond(c, res);
    },
  );

  return routes;
}
