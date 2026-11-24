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
import {
  CONST_WHITELIST,
  OPTION_WHITELIST,
  createPullJob,
  deriveJobsKey,
} from "../../lib/intel/pull";
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

    // SLICE-262-34 — per-site cooldown: a CI "scan then diff" on
    // every push would amplify into external fetches against the
    // client's own site. Derived from stored jobs — nothing extra
    // persisted; Retry-After makes the wait actionable.
    const cooldown = deps.scanCooldownSeconds ?? 0;
    if (cooldown > 0) {
      const latest = (await deps.scanJobs.forSite(siteId))
        .map((j) => j.createdAt)
        .sort()
        .at(-1);
      if (latest) {
        const elapsed = (now.getTime() - Date.parse(latest)) / 1000;
        if (elapsed < cooldown) {
          const retryAfter = Math.ceil(cooldown - elapsed);
          c.header("Retry-After", String(retryAfter));
          return c.json(
            {
              error: "scan_cooldown",
              retry_after_seconds: retryAfter,
              message: `site was scanned ${Math.floor(elapsed)}s ago; cooldown is ${cooldown}s`,
            },
            429,
          );
        }
      }
    }

    // SLICE-262-31 — the request's correlation id follows the job
    // (and every pull-job it spawns) for support diagnostics.
    const correlationId =
      (c.get("requestId" as never) as string | undefined) ?? null;

    let job = await deps.scanJobs.insert({
      id: `job_${generateReportId()}`,
      siteId,
      tenantId: ctx.tenantId,
      scanId: `scan_${generateReportId()}`,
      status: "queued",
      correlationId,
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

    // SLICE-262-16 (D-262-Q37): pull-jobs are queued ONLY when the
    // site has handshake + inside_diagnostics consent + entitlement —
    // missing consent is not an error, it just yields zero jobs.
    // The bounded ~90s wait lives inside the runner right before the
    // self-report merge; late results ride the next scan.
    let pullJobsCreated = 0;
    const pullDeps =
      deps.pullJobs && deps.securityEvents && deps.consent && deps.evidence
        ? {
            pullJobs: deps.pullJobs,
            securityEvents: deps.securityEvents,
            evidence: deps.evidence,
            consent: deps.consent,
            jobsKey: deriveJobsKey(deps.key),
            signKey: deps.key,
            evidenceRetentionDays: deps.evidenceRetentionDays,
          }
        : null;
    const insideDiagAllowed =
      pullDeps &&
      (await hasActiveConsent(pullDeps.consent, siteId, "inside_diagnostics")) &&
      checkEntitlement(
        await deps.entitlement.getByTenant(ctx.tenantId),
        "inside_diagnostics",
        siteId,
        now.toISOString(),
      ).allowed;
    if (insideDiagAllowed && pullDeps) {
      for (const name of CONST_WHITELIST) {
        const r = await createPullJob(pullDeps, {
          siteId,
          tenantId: ctx.tenantId,
          probeId: "const_read",
          params: { name },
          scanId: job.scanId,
          correlationId: correlationId ?? undefined,
        });
        if (r.ok) pullJobsCreated += 1;
      }
      for (const name of Object.keys(OPTION_WHITELIST)) {
        const r = await createPullJob(pullDeps, {
          siteId,
          tenantId: ctx.tenantId,
          probeId: "option_read",
          params: { name },
          scanId: job.scanId,
          correlationId: correlationId ?? undefined,
        });
        if (r.ok) pullJobsCreated += 1;
      }
      const r = await createPullJob(pullDeps, {
        siteId,
        tenantId: ctx.tenantId,
        probeId: "phpinfo_summary",
        params: {},
        scanId: job.scanId,
          correlationId: correlationId ?? undefined,
      });
      if (r.ok) pullJobsCreated += 1;
    }

    job = await runScanJob(job, {
      fetch: deps.scanFetch,
      evidence: deps.evidence,
      jobs: deps.scanJobs,
      key: deps.key,
      ruleset: deps.ruleset,
      evidenceRetentionDays: deps.evidenceRetentionDays,
      awaitPullJobs: pullDeps
        ? async (j) => {
            // bounded wait ~90s: poll until no pending pull-jobs for
            // this scanId remain, or the window closes — whichever
            // comes first (D-262-Q37)
            const deadline = Date.now() + 90_000;
            while (Date.now() < deadline) {
              const pending = await pullDeps.pullJobs.pendingForSite(
                j.siteId,
                new Date().toISOString(),
              );
              if (!pending.some((p) => p.scanId === j.scanId)) return;
              await new Promise((r) => setTimeout(r, 500));
            }
          }
        : undefined,
    });

    return c.json(
      {
        job: { ...job, report: undefined },
        report: job.report,
        warning: decision.warning,
        pull_jobs: pullJobsCreated,
      },
      job.status === "failed" ? 502 : 201,
    );
  });
}
