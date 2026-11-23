// EPIC-262 (SLICE-262-6/7): POST /scans — hosted deep-scan trigger.
// Dual credentials: absk_ authenticates the installation (site_key
// principal); abop_ authenticates a human operator on a tenant (role
// gate + site-in-tenant isolation). Entitlement gates the PAID op on
// the resolved tenant either way — the backend decides, never UI.
// v1 runs the job inline; an async runner lands with observability.
import type { Hono } from "hono";
import { generateReportId } from "../../../agent-readiness/integrity/ulid";
import { checkEntitlement } from "../../lib/intel/entitlement";
import { hasActiveConsent } from "../../lib/intel/consent";
import { runScanJob, SCAN_PLAN } from "../../lib/intel/scan";
import { rolePermitted } from "../../lib/intel/registry";
import { resolveScanAuth } from "./scan-auth";
import { INTEL_KEY_MISSING, type IntelRouteDeps } from "./index";

function bearerToken(c: { req: { header(name: string): string | undefined } }) {
  const h = c.req.header("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

export function registerScanRoute(app: Hono, deps: IntelRouteDeps): void {
  app.post("/scans", async (c) => {
    if (!deps.key) return c.json(INTEL_KEY_MISSING, 503);
    if (
      !deps.registry ||
      !deps.evidence ||
      !deps.scanJobs ||
      !deps.entitlement ||
      !deps.consent ||
      !deps.ruleset ||
      !deps.scanFetch
    ) {
      return c.json(
        { error: "scans_unavailable", message: "deep-scan deps are not configured" },
        503,
      );
    }

    const auth = await resolveScanAuth(deps, bearerToken(c));
    if (auth.kind === "invalid") {
      return c.json(
        { error: "key_invalid", message: "missing, unknown, or revoked site/operator key" },
        401,
      );
    }

    let siteId: string;
    if (auth.kind === "site_key") {
      siteId = auth.siteId;
    } else {
      // operator channel: backend role gate (never UI-only)
      if (!rolePermitted(auth.role, "deep_scan")) {
        return c.json(
          { error: "role_denied", role: auth.role, message: `role "${auth.role}" cannot run deep_scan` },
          403,
        );
      }
      const body = (await c.req.json().catch(() => null)) as {
        site_id?: unknown;
      } | null;
      if (typeof body?.site_id !== "string" || !body.site_id) {
        return c.json(
          { error: "site_id_required", message: "operator scans require body {site_id}" },
          400,
        );
      }
      siteId = body.site_id;
    }

    const ctx = await deps.registry.resolveSiteContext(siteId);
    if (!ctx) {
      return c.json({ error: "site_unknown", message: `unknown site ${siteId}` }, 404);
    }
    if (!ctx.tenantId) {
      return c.json(
        { error: "site_no_tenant", message: "site is not attached to a tenant" },
        409,
      );
    }
    // tenant isolation: an operator may only scan THEIR tenant's sites
    if (auth.kind === "operator" && ctx.tenantId !== auth.tenantId) {
      return c.json(
        { error: "site_not_in_tenant", message: "site belongs to a different tenant" },
        403,
      );
    }
    if (!ctx.primaryHostname) {
      return c.json(
        { error: "site_no_domain", message: "site has no active domain to scan" },
        409,
      );
    }

    // consent BEFORE entitlement (D-262-Q8): the owner's revocation
    // stops scans even while the subscription is alive — both channels
    if (!(await hasActiveConsent(deps.consent, siteId, "audit"))) {
      return c.json(
        { error: "consent_denied", message: "no active audit consent for this site" },
        403,
      );
    }

    // entitlement check on EVERY paid operation (D-262-Q7)
    const now = new Date();
    const ent = await deps.entitlement.getByTenant(ctx.tenantId);
    const decision = checkEntitlement(
      ent,
      "deep_scan",
      siteId,
      now.toISOString(),
    );
    if (!decision.allowed) {
      return c.json(
        { error: "entitlement_denied", reason: decision.reason },
        403,
      );
    }

    let job = await deps.scanJobs.insert({
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
      evidence: deps.evidence,
      jobs: deps.scanJobs,
      key: deps.key,
      ruleset: deps.ruleset,
      evidenceRetentionDays: deps.evidenceRetentionDays,
    });

    return c.json(
      {
        job: { ...job, report: undefined },
        report: job.report,
        warning: decision.warning,
      },
      job.status === "failed" ? 502 : 201,
    );
  });
}
