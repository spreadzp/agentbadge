// EPIC-262 (SLICE-262-10): hosted dashboard /intel — operator-key
// cookie session, tenant-scoped portfolio → site → report.
// The cookie carries the abop_ key verbatim: revocation ends the
// session automatically. All data queries enforce tenant isolation
// server-side — the UI never decides access.
import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { IntelRouteDeps } from ".";
import { INTEL_KEY_MISSING } from ".";
import {
  authenticateOperator,
  rolePermitted,
} from "../../lib/intel/registry/operators";
import type { OperatorAuthContext } from "../../lib/intel/registry/types";
import { listPortfolio, siteDetail } from "../../lib/intel/dashboard/data";
import {
  } from "../../lib/intel/client-report";
import { hasActiveConsent } from "../../lib/intel/consent";
import { checkEntitlement } from "../../lib/intel/entitlement";
import { runScanJob, SCAN_PLAN } from "../../lib/intel/scan";
import { generateReportId } from "../../../agent-readiness/integrity/ulid";
import { IntelLoginPage } from "../../../views/intel/login";
import { IntelPortfolioPage } from "../../../views/intel/portfolio";
import { IntelSitePage } from "../../../views/intel/site";
import { IntelReportPage } from "../../../views/intel/report";
import { createIntelClientReportRoutes } from "./client-reports";
import type { EvidenceProvenanceMap } from "../../../views/intel/components";

declare module "hono" {
  interface ContextVariableMap {
    intelOperator: OperatorAuthContext;
  }
}

export const INTEL_SESSION_COOKIE = "intel_session";

import { intelPage as page } from "./ui-page";

const loginPage = (c: Context, error?: string) =>
  c.html(
    page(IntelLoginPage(error).toString(), "Sign in — Agent Surface Intel", "/intel/login"),
  );

export function createIntelUiRoutes(deps: IntelRouteDeps) {
  const app = new Hono();

  const principal = async (c: Context): Promise<OperatorAuthContext | null> => {
    const cookie = getCookie(c, INTEL_SESSION_COOKIE);
    if (!cookie?.startsWith("abop_") || !deps.registryStores) return null;
    return authenticateOperator(deps.registryStores, cookie);
  };

  app.get("/login", (c) => loginPage(c));
  app.post("/login", async (c) => {
    const key = (await c.req.parseBody())["key"];
    if (typeof key !== "string" || !key.startsWith("abop_"))
      return loginPage(c, "Invalid key format — keys start with abop_");
    if (!deps.registryStores) return c.json(INTEL_KEY_MISSING, 503);
    const op = await authenticateOperator(deps.registryStores, key);
    if (!op) return loginPage(c, "Unknown or revoked key");
    setCookie(c, INTEL_SESSION_COOKIE, key, {
      httpOnly: true,
      sameSite: "Lax",
      secure: c.req.url.startsWith("https"),
      path: "/intel",
    });
    return c.redirect("/intel");
  });
  app.post("/logout", (c) => {
    deleteCookie(c, INTEL_SESSION_COOKIE, { path: "/intel" });
    return c.redirect("/intel/login");
  });

  // every route below requires an active operator session
  app.use("*", async (c, nxt) => {
    const op = await principal(c);
    if (!op) {
      if (c.req.method === "GET") return c.redirect("/intel/login");
      return c.json({ error: "key_invalid" }, 401);
    }
    c.set("intelOperator", op);
    return nxt();
  });

  const storesMissing = () =>
    !deps.registryStores || !deps.consent || !deps.scanJobs || !deps.evidence;

  // portfolio — attention-sorted rows for this tenant only
  app.get("/", async (c) => {
    const op = c.get("intelOperator");
    if (storesMissing()) return c.json(INTEL_KEY_MISSING, 503);
    const rows = await listPortfolio(
      deps.registryStores!,
      deps.consent!,
      deps.scanJobs!,
      op.tenant_id,
    );
    return c.html(
      page(IntelPortfolioPage(rows).toString(), "Portfolio — Agent Surface Intel", "/intel"),
    );
  });

  // site detail — 404 for foreign-tenant or unknown sites (no leak)
  app.get("/sites/:siteId", async (c) => {
    const op = c.get("intelOperator");
    const siteId = c.req.param("siteId");
    if (storesMissing() || !deps.registry) return c.json(INTEL_KEY_MISSING, 503);
    const ctx = await deps.registry.resolveSiteContext(siteId);
    if (!ctx || ctx.tenantId !== op.tenant_id) return c.text("Not found", 404);
    const d = await siteDetail(
      deps.registryStores!,
      deps.consent!,
      deps.scanJobs!,
      deps.evidence!,
      siteId,
    );
    if (!d) return c.text("Not found", 404);
    const crs = deps.clientReports
      ? await deps.clientReports.forSite(siteId)
      : [];
    return c.html(
      page(
        IntelSitePage(d, op.role, crs).toString(),
        `${ctx.primaryHostname ?? siteId} — Agent Surface Intel`,
        `/intel/sites/${siteId}`,
      ),
    );
  });

  // report view — job must belong to operator's tenant
  app.get("/reports/:jobId", async (c) => {
    const op = c.get("intelOperator");
    if (storesMissing() || !deps.registry) return c.json(INTEL_KEY_MISSING, 503);
    const job = await deps.scanJobs!.byId(c.req.param("jobId"));
    if (!job || job.tenantId !== op.tenant_id || !job.report)
      return c.text("Not found", 404);
    const ctx = await deps.registry.resolveSiteContext(job.siteId);
    const evidence = await deps.evidence!.forScan(job.siteId, job.scanId);
    const prov: EvidenceProvenanceMap = Object.fromEntries(
      evidence.map((e) => [e.id, e.provenance]),
    );
    return c.html(
      page(
        IntelReportPage(
          job,
          job.report,
          ctx?.primaryHostname ?? null,
          prov,
        ).toString(),
        "Report — Agent Surface Intel",
        `/intel/reports/${job.id}`,
      ),
    );
  });

  // rescan — same gate order as POST /api/intel/scans:
  // role → tenant → consent → entitlement → run
  app.post("/sites/:siteId/scan", async (c) => {
    const op = c.get("intelOperator");
    const siteId = c.req.param("siteId");
    if (!rolePermitted(op.role, "deep_scan"))
      return c.json({ error: "role_denied" }, 403);
    if (
      storesMissing() ||
      !deps.registry ||
      !deps.entitlement ||
      !deps.scanFetch ||
      !deps.key ||
      !deps.ruleset
    )
      return c.json(INTEL_KEY_MISSING, 503);
    const ctx = await deps.registry.resolveSiteContext(siteId);
    if (!ctx || ctx.tenantId !== op.tenant_id) return c.text("Not found", 404);
    if (!ctx.primaryHostname)
      return c.json({ error: "site_no_domain" }, 409);
    if (!(await hasActiveConsent(deps.consent!, siteId, "audit")))
      return c.json({ error: "consent_denied" }, 403);
    const now = new Date();
    const ent = await deps.entitlement.getByTenant(ctx.tenantId);
    const decision = checkEntitlement(ent, "deep_scan", siteId, now.toISOString());
    if (!decision.allowed)
      return c.json({ error: "entitlement_denied", reason: decision.reason }, 403);

    let job = await deps.scanJobs!.insert({
      id: `job_${generateReportId()}`,
      siteId,
      tenantId: ctx.tenantId,
      scanId: `scan_${generateReportId()}`,
      status: "queued",
      baseUrl: `https://${ctx.primaryHostname}`,
      probeFailures: 0,
      probeTotal: SCAN_PLAN.length,
      error: null,
      reportId: null,
      report: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      finishedAt: null,
    });
    job = await runScanJob(job, {
      fetch: deps.scanFetch,
      evidence: deps.evidence!,
      jobs: deps.scanJobs!,
      key: deps.key,
      ruleset: deps.ruleset,
      evidenceRetentionDays: deps.evidenceRetentionDays,
    });
    return c.redirect(
      `/intel/sites/${siteId}${job.status === "failed" ? "?scan=failed" : ""}`,
    );
  });


  app.route(
    "/",
    createIntelClientReportRoutes(deps, (c) => c.get("intelOperator")),
  );

  return app;
}
