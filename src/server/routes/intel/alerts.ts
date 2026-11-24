// EPIC-262 (SLICE-262-27b): GET /alerts — tenant-scoped
// requires-attention feed for ops tooling. Bearer abop_ (any role —
// read is not a paid op). Derived at read: nothing stored, nothing
// drifts (same contract as the digest).
import type { Context, Hono } from "hono";
import { authenticateOperator } from "../../lib/intel/registry";
import { listPortfolio } from "../../lib/intel/dashboard/data";
import { buildAlerts } from "../../lib/intel/monitoring/alerts";
import type { IntelRouteDeps } from "./index";

function bearerToken(c: { req: { header(name: string): string | undefined } }) {
  const h = c.req.header("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

export function registerAlertRoutes(app: Hono, deps: IntelRouteDeps): void {
  app.get("/alerts", async (c: Context) => {
    if (!deps.registryStores || !deps.consent || !deps.scanJobs) {
      return c.json(
        { error: "alerts_unavailable", message: "monitoring stores are not configured" },
        503,
      );
    }
    const token = bearerToken(c);
    const auth = token
      ? await authenticateOperator(deps.registryStores, token)
      : null;
    if (!auth) {
      return c.json(
        { error: "key_invalid", message: "missing, unknown, or revoked operator key" },
        401,
      );
    }
    const rows = await listPortfolio(
      deps.registryStores,
      deps.consent,
      deps.scanJobs,
      auth.tenant_id,
    );
    const attestations = new Map<
      string,
      Awaited<ReturnType<NonNullable<typeof deps.attestations>["forSite"]>>
    >();
    if (deps.attestations) {
      for (const row of rows) {
        attestations.set(
          row.site.id,
          await deps.attestations.forSite(row.site.id),
        );
      }
    }
    return c.json({
      generated_at: new Date().toISOString(),
      tenant_sites: rows.length,
      alerts: buildAlerts(rows, attestations),
    });
  });
}
