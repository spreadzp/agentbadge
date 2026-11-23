// EPIC-262 (SLICE-262-11): client monthly report routes —
// generate / view (html+md) / editorial edit / lifecycle. Tenant
// isolation identical to the dashboard routes (404 on foreign).
import { Hono } from "hono";
import type { Context } from "hono";
import type { IntelRouteDeps } from ".";
import { INTEL_KEY_MISSING } from ".";
import {
  editEditorial,
  generateClientReport,
  periodOf,
  renderClientMarkdown,
  transition,
  type ClientReportStatus,
} from "../../lib/intel/client-report";
import { rolePermitted } from "../../lib/intel/registry/operators";
import type { OperatorAuthContext } from "../../lib/intel/registry/types";
import { IntelClientReportPage } from "../../../views/intel/client-report";
import { intelPage as page } from "./ui-page";

export function createIntelClientReportRoutes(
  deps: IntelRouteDeps,
  operator: (c: Context) => OperatorAuthContext,
) {
  const app = new Hono();

  const getClientReport = async (c: Context, id: string) => {
    const op = operator(c);
    if (!deps.clientReports) return null;
    const r = await deps.clientReports.byId(id);
    if (!r || r.tenantId !== op.tenant_id) return null;
    return r;
  };

  // generate — from the site's latest job with a signed report
  app.post("/sites/:siteId/client-report", async (c) => {
    const op = operator(c);
    const siteId = c.req.param("siteId");
    if (!rolePermitted(op.role, "deep_scan"))
      return c.json({ error: "role_denied" }, 403);
    if (!deps.registry || !deps.scanJobs || !deps.clientReports)
      return c.json(INTEL_KEY_MISSING, 503);
    const ctx = await deps.registry.resolveSiteContext(siteId);
    if (!ctx || ctx.tenantId !== op.tenant_id) return c.text("Not found", 404);
    const jobs = await deps.scanJobs.forSite(siteId);
    const job = jobs
      .filter((j) => j.report !== null)
      .reduce((a, b) => (a.createdAt >= b.createdAt ? a : b), jobs[0]!);
    if (!job?.report)
      return c.json({ error: "no_report", message: "run a scan first" }, 422);
    const period = periodOf(job.report.scan.generated_at);
    const existing = (await deps.clientReports.forSite(siteId)).find(
      (r) => r.period === period,
    );
    if (existing) return c.redirect(`/intel/client-reports/${existing.id}`);
    const prev = await deps.clientReports.latestBeforePeriod(siteId, period);
    const report = generateClientReport({
      siteId,
      tenantId: ctx.tenantId!,
      job,
      prev,
      operatorId: op.operator_id,
    });
    const stored = await deps.clientReports.insert(report);
    return c.redirect(`/intel/client-reports/${stored.id}`);
  });

  // GET /client-reports/:id — HTML; ".md" suffix → markdown export
  app.get("/client-reports/:id", async (c) => {
    const raw = c.req.param("id");
    const asMarkdown = raw.endsWith(".md");
    const r = await getClientReport(
      c,
      asMarkdown ? raw.slice(0, -3) : raw,
    );
    if (!r || !deps.registry) return c.text("Not found", 404);
    const ctx = await deps.registry.resolveSiteContext(r.siteId);
    if (asMarkdown)
      return c.text(
        renderClientMarkdown(r, ctx?.primaryHostname ?? null),
        200,
        { "content-type": "text/markdown; charset=utf-8" },
      );
    return c.html(
      page(
        IntelClientReportPage(r, ctx?.primaryHostname ?? null, operator(c).role).toString(),
        `Client report ${r.period} — Agent Surface Intel`,
        `/intel/client-reports/${r.id}`,
      ),
    );
  });

  // editorial edit — viewer denied, SENT frozen
  app.post("/client-reports/:id/edit", async (c) => {
    const op = operator(c);
    if (op.role === "viewer") return c.json({ error: "role_denied" }, 403);
    const r = await getClientReport(c, c.req.param("id"));
    if (!r || !deps.clientReports) return c.text("Not found", 404);
    const body = await c.req.parseBody();
    const pick = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
    let updated;
    try {
      updated = editEditorial(
        r,
        {
          heroLine: pick("heroLine"),
          whatChanged: pick("whatChanged"),
          nextMonth: pick("nextMonth"),
          internalNote: pick("internalNote"),
        },
        op.operator_id,
      );
    } catch (e) {
      if (String(e).includes("report_sent"))
        return c.json({ error: "report_sent" }, 409);
      throw e;
    }
    await deps.clientReports.update(updated);
    return c.redirect(`/intel/client-reports/${r.id}`);
  });

  // lifecycle transitions — forward only, viewer denied
  for (const [action, to] of [
    ["review", "IN_REVIEW"],
    ["approve", "APPROVED"],
    ["send", "SENT"],
  ] as [string, ClientReportStatus][]) {
    app.post(`/client-reports/:id/${action}`, async (c) => {
      const op = operator(c);
      if (op.role === "viewer") return c.json({ error: "role_denied" }, 403);
      const r = await getClientReport(c, c.req.param("id"));
      if (!r || !deps.clientReports) return c.text("Not found", 404);
      let updated;
      try {
        updated = transition(r, to, op.operator_id);
      } catch {
        return c.json({ error: "illegal_transition", from: r.status, to }, 409);
      }
      await deps.clientReports.update(updated);
      return c.redirect(`/intel/client-reports/${r.id}`);
    });
  }

  return app;
}
