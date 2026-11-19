/**
 * SLICE-226-3 — admin FinOps routes behind adminAuth.
 *   GET /admin/finance/payments        — list + filters + pagination
 *   GET /admin/finance/payments/:id    — detail + attempts + trace
 *   GET /admin/finance/exceptions      — exception queue
 *   GET /admin/finance/reports         — report; ?format=csv export
 *   GET /admin/finance/audit           — AdminAction trail
 * Mutations (POST) live in finops-actions.ts — manual effects only
 * via domain services, so the audit invariants hold.
 * Shared route helpers live in ./helpers (SLICE-226-6) — deps types,
 * FinOpsResult→response mapping, strict date/evidence parsing.
 */

import type { Context } from "hono";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { getDatabase } from "../../lib/database";
import { Layout } from "../../../views/chrome/layout";
import { auditPage } from "../../../views/finops/audit";
import { paymentDetailPage } from "../../../views/finops/detail";
import { exceptionsPage } from "../../../views/finops/exceptions";
import { paymentsPage, paymentsTable } from "../../../views/finops/payments";
import { reportsPage } from "../../../views/finops/reports";
import type { FinReport } from "../../lib/finops/types";
import {
  finReport,
  getPaymentDetail,
  listAdminActions,
  listExceptions,
  listPayments,
  normalizeOperator,
  tracePayment,
  fail,
} from "../../lib/finops/index";
import { isHtmxRequest, wrapFragment } from "../ui/helpers";
import { adminAuth } from "../../middleware/adminAuth";
import { createFinopsActionRoutes } from "./finops-actions";
import { createFinopsOpsRoutes } from "./finops-ops";
import {
  type FinopsRouteDeps,
  dateParam,
  listLimit,
  respond,
  str,
} from "./helpers";

/** Minimal CSV for the finance report export. `esc` also defuses
 *  spreadsheet formula injection on attacker-influenced cells. */
function reportCsv(r: FinReport): string {
  const esc = (s: string) =>
    `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  const rows: string[] = ["section,key,value"];
  rows.push(`summary,grossVolume,${r.grossVolume}`);
  rows.push(`summary,refundsTotal,${r.refundsTotal}`);
  rows.push(`summary,feesTotal,${r.fees.total}`);
  rows.push(`summary,netRevenue,${r.netRevenue}`);
  for (const [k, v] of Object.entries(r.byProvider)) {
    rows.push(`byProvider,${esc(k)},${v}`);
  }
  for (const [k, v] of Object.entries(r.byProduct)) {
    rows.push(`byProduct,${esc(k)},${v}`);
  }
  for (const [k, v] of Object.entries(r.byNetwork)) {
    rows.push(`byNetwork,${esc(k)},${v}`);
  }
  rows.push(`recordedOnly,count,${r.recordedOnly.count}`);
  rows.push(`recordedOnly,volume,${r.recordedOnly.volume}`);
  return rows.join("\n") + "\n";
}

const ADMIN_TAG = { tags: ["Admin FinOps"] };

export function createFinopsRoutes(deps: FinopsRouteDeps = {}): Hono {
  const routes = new Hono();
  // Whole surface is admin-only — spec "за adminAuth". The middleware
  // also covers the mounted action sub-router paths.
  routes.use("/admin/finance/*", adminAuth);
  const getDb = deps.getDb ?? getDatabase;
  const page = (c: Context, frag: string, title: string): Response =>
    c.html(
      wrapFragment(c, frag, title, {
        path: c.req.path,
        title: `Admin FinOps — ${title}`,
        description: `Admin FinOps — ${title}`,
      }),
      200,
      { "Cache-Control": "no-store" },
    );

  routes.get("/admin/finance", (c) =>
    c.redirect("/admin/finance/payments", 302),
  );

  routes.get(
    "/admin/finance/payments",
    describeRoute({
      ...ADMIN_TAG,
      summary: "Payments list (admin)",
      responses: { 200: { description: "Payments page or table fragment" } },
    }),
    async (c) => {
      const url = new URL(c.req.url);
      const q = url.searchParams;
      const sinceMs = dateParam(q.get("since"));
      const untilMs = dateParam(q.get("until"), true);
      if (sinceMs === null || untilMs === null) {
        return respond(
          c,
          fail("BAD_INPUT", "invalid date — expected YYYY-MM-DD"),
        );
      }
      // N5: only read perPage when the param is present — Number(null)
      // is 0 and would clamp the default page size down to 1.
      const perPageRaw = q.get("perPage");
      const perPage =
        perPageRaw !== null && perPageRaw.trim() !== ""
          ? Number(perPageRaw)
          : undefined;
      const filter = {
        provider: str(q.get("provider")),
        status: str(q.get("status")),
        productId: str(q.get("productId")),
        customerId: str(q.get("customerId")),
        agentId: str(q.get("agentId")),
        ...(sinceMs !== undefined ? { sinceMs } : {}),
        ...(untilMs !== undefined ? { untilMs } : {}),
        page: Math.max(1, Math.floor(Number(q.get("page")) || 1)),
        ...(perPage !== undefined && Number.isFinite(perPage)
          ? { perPage: Math.min(Math.max(1, Math.floor(perPage)), 200) }
          : {}),
      };
      const result = await listPayments(getDb(), filter);
      return isHtmxRequest(c)
        ? c.html(paymentsTable(result).toString(), 200, {
            "Cache-Control": "no-store",
          })
        : page(c, paymentsPage(result, filter).toString(), "Payments");
    },
  );

  routes.get(
    "/admin/finance/payments/:id",
    describeRoute({
      ...ADMIN_TAG,
      summary: "Payment detail + trace (admin)",
      responses: {
        200: { description: "Detail page" },
        404: { description: "Payment not found" },
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      const detail = await getPaymentDetail(getDb(), id);
      if (!detail) {
        return c.html(
          Layout(
            '<div class="p-8 text-slate-400">Payment not found.</div>',
            "Not found",
            {
              path: c.req.path,
              title: "Payment not found",
              description: "Payment not found",
            },
            [],
            true,
          ),
          404,
          { "Cache-Control": "no-store" },
        );
      }
      const trace = await tracePayment(getDb(), id);
      return page(
        c,
        paymentDetailPage(detail, trace).toString(),
        `Payment ${detail.payment.reference}`,
      );
    },
  );

  routes.get(
    "/admin/finance/exceptions",
    describeRoute({
      ...ADMIN_TAG,
      summary: "Reconciliation exceptions queue (admin)",
      responses: { 200: { description: "Exceptions page" } },
    }),
    async (c) => {
      const q = new URL(c.req.url).searchParams;
      const rows = await listExceptions(getDb(), {
        status: str(q.get("status")) ?? "OPEN",
        type: str(q.get("type")),
        limit: listLimit(q.get("limit")),
      });
      return page(c, exceptionsPage(rows).toString(), "Exceptions");
    },
  );

  routes.get(
    "/admin/finance/reports",
    describeRoute({
      ...ADMIN_TAG,
      summary: "Financial report (admin)",
      description: "Gross/net, fee estimates, splits. ?format=csv export.",
      responses: { 200: { description: "Report page or CSV" } },
    }),
    async (c) => {
      const q = new URL(c.req.url).searchParams;
      const since = q.get("since") ?? "";
      const until = q.get("until") ?? "";
      const sinceMs = dateParam(since);
      const untilMs = dateParam(until, true);
      if (sinceMs === null || untilMs === null) {
        return respond(
          c,
          fail("BAD_INPUT", "invalid date — expected YYYY-MM-DD"),
        );
      }
      if (
        sinceMs !== undefined &&
        untilMs !== undefined &&
        sinceMs > untilMs
      ) {
        return respond(
          c,
          fail("BAD_INPUT", "`since` must not be after `until`"),
        );
      }
      const rep = await finReport(getDb(), {
        ...(sinceMs !== undefined ? { sinceMs } : {}),
        ...(untilMs !== undefined ? { untilMs } : {}),
      });
      if (q.get("format") === "csv") {
        return new Response(reportCsv(rep), {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition":
              'attachment; filename="finops-report.csv"',
            "Cache-Control": "no-store",
          },
        });
      }
      return page(c, reportsPage(rep, { since, until }).toString(), "Reports");
    },
  );

  routes.get(
    "/admin/finance/audit",
    describeRoute({
      ...ADMIN_TAG,
      summary: "Admin action trail (admin)",
      responses: { 200: { description: "Audit page" } },
    }),
    async (c) => {
      const q = new URL(c.req.url).searchParams;
      const opRaw = str(q.get("operator"));
      const filters = {
        action: str(q.get("action")),
        subjectType: str(q.get("subjectType")),
        // H5: stored labels are normalized — normalize the filter too.
        operator: opRaw ? normalizeOperator(opRaw) : undefined,
      };
      const rows = await listAdminActions(getDb(), {
        ...filters,
        limit: listLimit(q.get("limit")),
      });
      return page(c, auditPage(rows, filters).toString(), "Audit trail");
    },
  );

  routes.route("/", createFinopsActionRoutes(deps));
  routes.route("/", createFinopsOpsRoutes(deps));
  return routes;
}
