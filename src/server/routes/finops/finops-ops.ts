/**
 * SLICE-226-3 — admin FinOps ops endpoints (operatorAuth via the
 * parent mount — SLICE-264-7).
 *
 *   GET  /admin/finance/refunds            — refund intents list (JSON)
 *   POST /admin/finance/refunds/:id/complete  {txHash}
 *   POST /admin/finance/exceptions/detect     {}
 *   POST /admin/finance/exceptions/:id/resolve {resolution, note?}
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
  recordPostEffectAudit,
  resolveException,
} from "../../lib/finops/index";
import { principalId } from "../../middleware/operatorAuth";
import type { FinopsRouteDeps } from "./helpers";
import {
  listLimit,
  readBody,
  rejectOperatorField,
  respond,
} from "./helpers";

const TAG = { tags: ["Admin FinOps"] };

/** M-3: sample ids by serialized byte budget — a count cap alone can
 *  still overflow the 4 KB audit row (uuid-suffixed ids ~42 chars). */
function idSample(ids: readonly string[], budget = 1200): string[] {
  const out: string[] = [];
  let used = 0;
  for (const id of ids) {
    const n = JSON.stringify(id).length + 1; // + comma
    if (used + n > budget) break;
    out.push(id);
    used += n;
  }
  return out;
}

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
        400: { description: "Missing txHash / operator field sent" },
        401: { description: "Unauthorized" },
        404: { description: "Intent not found" },
        503: { description: "Tx verification not configured" },
      },
    }),
    async (c) => {
      const actor = principalId(c);
      if (actor instanceof Response) return actor;
      const b = await readBody(c);
      const opField = rejectOperatorField(b);
      if (opField) return respond(c, opField);
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
      const res = await completeRefundIntent(
        getDb(),
        {
          intentId: c.req.param("id"),
          txHash: typeof b.txHash === "string" ? b.txHash : "",
          operator: actor,
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
        400: { description: "Operator field sent" },
        401: { description: "Unauthorized" },
      },
    }),
    async (c) => {
      const actor = principalId(c);
      if (actor instanceof Response) return actor;
      const b = await readBody(c);
      const opField = rejectOperatorField(b);
      if (opField) return respond(c, opField);
      const res = await detectFromPaymentExceptions(getDb(), {
        limit: listLimit(b.limit, 100, 100),
      });
      if (!res.ok) return respond(c, res);
      // N3 + M-3: bounded evidence — counts + a BYTE-budgeted id
      // sample (id length varies; a fixed count can still overflow
      // the 4 KB row). Post-effect helper degrades to minimal
      // evidence — the rows are already created, the audit must not
      // vanish on an edge-case overflow.
      const createdIds = res.value.created.map((r) => r.id);
      const audit = await recordPostEffectAudit(
        getDb(),
        {
          action: "DETECT_EXCEPTIONS",
          subjectType: "exception",
          subjectId: "scan",
          operator: actor,
          principalId: actor,
          evidence: {
            createdCount: createdIds.length,
            skippedCount: res.value.skipped.length,
            errorCount: res.value.errors?.length ?? 0,
            createdIds: idSample(createdIds),
            skipped: idSample(res.value.skipped),
            errors: res.value.errors?.slice(0, 5) ?? [],
          },
        },
        {
          createdCount: createdIds.length,
          skippedCount: res.value.skipped.length,
          errorCount: res.value.errors?.length ?? 0,
        },
      );
      // Audit-always is not absolute here: the effect already landed,
      // so a failed audit write must be surfaced, not swallowed —
      // same convention as stripe-refunds' auditRecorded field.
      return respond(c, {
        ok: true as const,
        value: { ...res.value, auditRecorded: audit.ok },
      });
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
        400: { description: "Missing resolution / operator field sent" },
        401: { description: "Unauthorized" },
        404: { description: "Exception not found" },
        409: { description: "Already resolved" },
      },
    }),
    async (c) => {
      const actor = principalId(c);
      if (actor instanceof Response) return actor;
      const b = await readBody(c);
      const opField = rejectOperatorField(b);
      if (opField) return respond(c, opField);
      const res = await resolveException(getDb(), {
        id: c.req.param("id"),
        operator: actor,
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
