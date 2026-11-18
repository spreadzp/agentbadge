/**
 * SLICE-226-3 — admin FinOps routes behind adminAuth.
 *   GET /admin/finance/payments        — list + filters + pagination
 *   GET /admin/finance/payments/:id    — detail + attempts + trace
 *   GET /admin/finance/exceptions      — exception queue
 *   GET /admin/finance/reports         — report; ?format=csv export
 *   GET /admin/finance/audit           — AdminAction trail
 * Mutations (POST) live in finops-actions.ts — manual effects only
 * via domain services, so the audit invariants hold.
 */

import type { Context } from "hono";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";

import type { Database } from "@agentbadge/database";

import { getDatabase } from "../../lib/database";
import { Layout } from "../../../views/chrome/layout";
import { auditPage } from "../../../views/finops/audit";
import { paymentDetailPage } from "../../../views/finops/detail";
import { exceptionsPage } from "../../../views/finops/exceptions";
import { paymentsPage, paymentsTable } from "../../../views/finops/payments";
import { reportsPage } from "../../../views/finops/reports";
import type {
  FinOpsResult,
  FinReport,
  StripeRefundClient,
  VerifyRefundTx,
} from "../../lib/finops/types";
import {
  finReport,
  getPaymentDetail,
  listAdminActions,
  listExceptions,
  listPayments,
  tracePayment,
} from "../../lib/finops/index";
import { isHtmxRequest, wrapFragment } from "../ui/helpers";
import { adminAuth } from "../../middleware/adminAuth";
import { createFinopsActionRoutes } from "./finops-actions";
import { createFinopsOpsRoutes } from "./finops-ops";

/** Injected seams — tests pass stubs; prod defaults lazily. */
export interface FinopsRouteDeps {
  getDb?: () => Database;
  verifyRefundTx?: VerifyRefundTx;
  /** Stripe SDK-shaped client; absent → Stripe path 503s. */
  stripeClient?: StripeRefundClient | null;
}

/** `YYYY-MM-DD` → start/end of UTC day in ms; undefined on empty. */
export function dateParam(
  v: string | undefined,
  endOfDay = false,
): number | undefined {
  if (!v) return undefined;
  const ms = Date.parse(`${v}T00:00:00Z`);
  if (!Number.isFinite(ms)) return undefined;
  return endOfDay ? ms + 86_399_999 : ms;
}

/** JSON for API clients, HTML status fragment for HTMX posts. */
export function respond<T>(
  c: Context,
  result: FinOpsResult<T>,
  okStatus = 200,
): Response {
  if (!isHtmxRequest(c)) {
    return result.ok
      ? c.json(result.value, okStatus as 200)
      : c.json({ error: result.error }, 400);
  }
  const html = result.ok
    ? `<div class="rounded border border-emerald-800 bg-emerald-900/40 px-3 py-2 text-emerald-300">OK</div>`
    : `<div class="rounded border border-red-800 bg-red-900/40 px-3 py-2 text-red-300">${result.error.code}: ${result.error.message}</div>`;
  return c.html(html, result.ok ? (okStatus as 200) : 400);
}

/** POST body from JSON or form-urlencoded (HTMX default). */
export async function readBody(
  c: Context,
): Promise<Record<string, unknown>> {
  const ct = c.req.header("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      const b = (await c.req.json()) as Record<string, unknown>;
      return b && typeof b === "object" ? b : {};
    } catch {
      return {};
    }
  }
  try {
    const b = await c.req.parseBody();
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(b)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

/** Evidence field: JSON when parseable, else the raw string. */
export function parseEvidence(v: unknown): unknown {
  const s = str(v);
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Minimal CSV for the finance report export. */
function reportCsv(r: FinReport): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
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
      const filter = {
        provider: str(q.get("provider")),
        status: str(q.get("status")),
        productId: str(q.get("productId")),
        customerId: str(q.get("customerId")),
        agentId: str(q.get("agentId")),
        sinceMs: dateParam(q.get("since") ?? undefined),
        untilMs: dateParam(q.get("until") ?? undefined, true),
        page: Math.max(1, Number(q.get("page")) || 1),
        perPage: Number(q.get("perPage")) || undefined,
      };
      const result = await listPayments(getDb(), filter);
      return isHtmxRequest(c)
        ? c.html(paymentsTable(result).toString())
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
        limit: Math.min(Number(q.get("limit")) || 200, 500),
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
      const rep = await finReport(getDb(), {
        sinceMs: dateParam(since),
        untilMs: dateParam(until, true),
      });
      if (q.get("format") === "csv") {
        return new Response(reportCsv(rep), {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition":
              'attachment; filename="finops-report.csv"',
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
      const filters = {
        action: str(q.get("action")),
        subjectType: str(q.get("subjectType")),
        operator: str(q.get("operator")),
      };
      const rows = await listAdminActions(getDb(), {
        ...filters,
        limit: Math.min(Number(q.get("limit")) || 200, 500),
      });
      return page(c, auditPage(rows, filters).toString(), "Audit trail");
    },
  );

  routes.route("/", createFinopsActionRoutes(deps));
  routes.route("/", createFinopsOpsRoutes(deps));
  return routes;
}
