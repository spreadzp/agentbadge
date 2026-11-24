// EPIC-262 (SLICE-262-16): /jobs pull-protocol routes.
//   POST /jobs            operator-only create+sign (role+consent+entitlement)
//   GET  /jobs?site=      absk_ read-only peek — zero side-effects
//   POST /jobs/:id/claim  absk_ atomic claim, lease+generation binding
//   POST /jobs/:id/result absk_ result → envelope PLUGIN_SELF_REPORTED
// All trust decisions are ops-level; routes only authenticate + shape.
import type { Hono } from "hono";
import { checkEntitlement } from "../../lib/intel/entitlement";
import { hasActiveConsent } from "../../lib/intel/consent";
import {
  claimPullJob,
  createPullJob,
  deriveJobsKey,
  peekPullJobs,
  submitPullResult,
  type PullDeps,
} from "../../lib/intel/pull";
import { rolePermitted } from "../../lib/intel/registry";
import { resolveScanAuth } from "./scan-auth";
import { INTEL_KEY_MISSING, type IntelRouteDeps } from "./index";

function bearerToken(c: { req: { header(name: string): string | undefined } }) {
  const h = c.req.header("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

function pullDeps(deps: IntelRouteDeps): PullDeps | null {
  if (
    !deps.key ||
    !deps.pullJobs ||
    !deps.securityEvents ||
    !deps.evidence ||
    !deps.consent
  ) {
    return null;
  }
  return {
    pullJobs: deps.pullJobs,
    securityEvents: deps.securityEvents,
    evidence: deps.evidence,
    consent: deps.consent,
    jobsKey: deriveJobsKey(deps.key),
    signKey: deps.key,
    evidenceRetentionDays: deps.evidenceRetentionDays,
  };
}

const UNAVAILABLE = {
  error: "jobs_unavailable",
  message: "pull-job deps are not configured",
} as const;

export function registerPullJobRoutes(app: Hono, deps: IntelRouteDeps): void {
  // ── operator create ─────────────────────────────────────────────
  app.post("/jobs", async (c) => {
    if (!deps.key) return c.json(INTEL_KEY_MISSING, 503);
    const pd = pullDeps(deps);
    if (!pd || !deps.registry || !deps.registryStores || !deps.entitlement) {
      return c.json(UNAVAILABLE, 503);
    }
    const auth = await resolveScanAuth(deps, bearerToken(c));
    if (auth.kind !== "operator") {
      return c.json(
        { error: "operator_required", message: "pull-jobs are created by operators only" },
        401,
      );
    }
    if (!rolePermitted(auth.role, "inside_diagnostics")) {
      return c.json(
        { error: "role_denied", role: auth.role, message: `role "${auth.role}" cannot run inside_diagnostics` },
        403,
      );
    }
    const body = (await c.req.json().catch(() => null)) as {
      site_id?: unknown;
      probe_id?: unknown;
      params?: unknown;
    } | null;
    if (
      typeof body?.site_id !== "string" ||
      typeof body?.probe_id !== "string" ||
      body.params === null ||
      typeof body.params !== "object"
    ) {
      return c.json(
        { error: "body_invalid", message: "expected {site_id, probe_id, params{}}" },
        400,
      );
    }
    const ctx = await deps.registry.resolveSiteContext(body.site_id);
    if (!ctx) return c.json({ error: "site_unknown" }, 404);
    if (ctx.tenantId !== auth.tenantId) {
      return c.json({ error: "site_not_in_tenant" }, 403);
    }
    // consent BEFORE entitlement (D-262-Q8), kind = inside_diagnostics
    if (
      !(await hasActiveConsent(deps.consent!, body.site_id, "inside_diagnostics"))
    ) {
      return c.json({ error: "consent_denied" }, 403);
    }
    const ent = await deps.entitlement.getByTenant(ctx.tenantId);
    const decision = checkEntitlement(
      ent,
      "inside_diagnostics",
      body.site_id,
      new Date().toISOString(),
    );
    if (!decision.allowed) {
      return c.json({ error: "entitlement_denied", reason: decision.reason }, 403);
    }
    const r = await createPullJob(pd, {
      siteId: body.site_id,
      tenantId: ctx.tenantId,
      probeId: body.probe_id,
      params: body.params as Record<string, unknown>,
    });
    if (!r.ok) return c.json({ error: r.reason }, 400);
    return c.json({ job: r.job }, 201);
  });

  // ── plugin peek — read-only (D-262-Q23) ─────────────────────────
  app.get("/jobs", async (c) => {
    if (!deps.key) return c.json(INTEL_KEY_MISSING, 503);
    const pd = pullDeps(deps);
    if (!pd || !deps.registry) return c.json(UNAVAILABLE, 503);
    const token = bearerToken(c);
    const site = token ? await deps.registry.authenticateSiteKey(token) : null;
    if (!site) {
      return c.json(
        { error: "site_key_invalid", message: "missing, unknown, or revoked site key" },
        401,
      );
    }
    const siteParam = c.req.query("site");
    if (siteParam && siteParam !== site.site_id) {
      // the queue is site-scoped to the authenticated site — a foreign
      // site_id in the query is an honest 403, not an empty list
      return c.json({ error: "site_mismatch" }, 403);
    }
    return c.json({ jobs: await peekPullJobs(pd, site.site_id) }, 200);
  });

  // ── plugin claim — atomic, consent-checked, generation-bound ────
  app.post("/jobs/:id/claim", async (c) => {
    if (!deps.key) return c.json(INTEL_KEY_MISSING, 503);
    const pd = pullDeps(deps);
    if (!pd || !deps.registry) return c.json(UNAVAILABLE, 503);
    const token = bearerToken(c);
    const site = token ? await deps.registry.authenticateSiteKey(token) : null;
    if (!site) {
      return c.json(
        { error: "site_key_invalid", message: "missing, unknown, or revoked site key" },
        401,
      );
    }
    const r = await claimPullJob(pd, c.req.param("id"), site.site_id);
    if (!r.ok) {
      const http =
        r.reason === "consent_denied" ? 403 : r.reason === "missing" ? 404 : 409;
      return c.json({ error: r.reason }, http);
    }
    return c.json(
      {
        job_id: r.job.id,
        status: r.job.status,
        lease_token: r.job.leaseToken,
        lease_generation: r.job.leaseGeneration,
        lease_expires_at: r.job.leaseExpiresAt,
        retry: r.retry,
      },
      200,
    );
  });

  // ── plugin result → envelope PLUGIN_SELF_REPORTED ───────────────
  app.post("/jobs/:id/result", async (c) => {
    if (!deps.key) return c.json(INTEL_KEY_MISSING, 503);
    const pd = pullDeps(deps);
    if (!pd || !deps.registry) return c.json(UNAVAILABLE, 503);
    const token = bearerToken(c);
    const site = token ? await deps.registry.authenticateSiteKey(token) : null;
    if (!site) {
      return c.json(
        { error: "site_key_invalid", message: "missing, unknown, or revoked site key" },
        401,
      );
    }
    const body = (await c.req.json().catch(() => null)) as {
      lease_token?: unknown;
      result?: unknown;
    } | null;
    if (body === null || body.result === undefined) {
      return c.json({ error: "body_invalid" }, 400);
    }
    const r = await submitPullResult(
      pd,
      c.req.param("id"),
      site.site_id,
      body,
      `site:${site.site_id}`,
    );
    if (!r.ok) return c.json({ error: r.reason }, r.http);
    return c.json(
      { job_id: r.job.id, status: r.job.status, envelope_id: r.envelopeId, deduplicated: r.deduplicated },
      r.deduplicated ? 200 : 201,
    );
  });
}
