// EPIC-262 (SLICE-262-34): GET /report-diff — the CI-gate channel.
// Dual credentials like POST /scans: absk_ binds the site it was
// minted for (CI's only credential); abop_ takes ?site= inside its
// tenant. Gate order (D-262-Q*): auth → role → tenant → consent →
// entitlement → derive. The answer is signed — a pipeline verifies
// it against /.well-known/agentbadge-keys.json like any artefact.
// ?format=sarif returns the same derived facts as SARIF 2.1.0.
import type { Hono } from "hono";
import { checkEntitlement } from "../../lib/intel/entitlement";
import { hasActiveConsent } from "../../lib/intel/consent";
import { rolePermitted } from "../../lib/intel/registry";
import {
  computeReportDiff,
  signReportDiff,
  diffToSarif,
} from "../../lib/intel/report-diff";
import { resolveScanAuth } from "./scan-auth";
import { INTEL_KEY_MISSING, type IntelRouteDeps } from "./index";

function bearerToken(c: { req: { header(name: string): string | undefined } }) {
  const h = c.req.header("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

export function registerReportDiffRoute(app: Hono, deps: IntelRouteDeps): void {
  app.get("/report-diff", async (c) => {
    if (!deps.key) return c.json(INTEL_KEY_MISSING, 503);
    if (
      !deps.registry ||
      !deps.scanJobs ||
      !deps.entitlement ||
      !deps.consent
    ) {
      return c.json(
        { error: "diff_unavailable", message: "report-diff deps are not configured" },
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
      // an explicit ?site= that disagrees with the key is a scope
      // violation, not a silent override (AC-3)
      const requested = c.req.query("site");
      if (requested && requested !== siteId) {
        return c.json(
          { error: "site_key_scope", message: "site key does not cover the requested site" },
          403,
        );
      }
    } else {
      if (!rolePermitted(auth.role, "report_diff")) {
        return c.json(
          { error: "role_denied", role: auth.role, message: `role "${auth.role}" cannot run report_diff` },
          403,
        );
      }
      const requested = c.req.query("site");
      if (!requested) {
        return c.json(
          { error: "site_required", message: "operator diffs require ?site={siteId}" },
          400,
        );
      }
      siteId = requested;
    }

    const ctx = await deps.registry.resolveSiteContext(siteId);
    if (!ctx?.tenantId) {
      return c.json({ error: "site_unknown", message: `unknown site ${siteId}` }, 404);
    }
    if (auth.kind === "operator" && ctx.tenantId !== auth.tenantId) {
      return c.json(
        { error: "site_not_in_tenant", message: "site belongs to a different tenant" },
        403,
      );
    }

    // consent BEFORE entitlement — the owner's revocation darkens the
    // CI channel even while the subscription is alive
    if (!(await hasActiveConsent(deps.consent, siteId, "audit"))) {
      return c.json(
        { error: "consent_denied", message: "no active audit consent for this site" },
        403,
      );
    }

    const ent = await deps.entitlement.getByTenant(ctx.tenantId);
    const decision = checkEntitlement(
      ent,
      "report_diff",
      siteId,
      new Date().toISOString(),
    );
    if (!decision.allowed) {
      return c.json(
        { error: "entitlement_denied", reason: decision.reason },
        403,
      );
    }

    const jobs = await deps.scanJobs.forSite(siteId);
    const body = computeReportDiff(jobs, siteId, new Date().toISOString());
    const diff = signReportDiff(body, deps.key);

    if (c.req.query("format") === "sarif") {
      const head = jobs.find((j) => j.report?.report_id === diff.head_report_id);
      return c.json(diffToSarif(diff, head?.report ?? null));
    }
    return c.json(diff);
  });
}
