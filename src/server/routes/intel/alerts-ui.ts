// EPIC-262 (SLICE-262-27b): requires-attention feed page —
// derived at read (nothing stored, nothing drifts). Kept outside
// ui.ts (line budget), same session guard + tenant scope.
import { Hono } from "hono";
import type { Context } from "hono";
import type { IntelRouteDeps } from ".";
import { INTEL_KEY_MISSING } from ".";
import type { OperatorAuthContext } from "../../lib/intel/registry/types";
import { listPortfolio } from "../../lib/intel/dashboard/data";
import { buildAlerts } from "../../lib/intel/monitoring/alerts";
import type { IntelAttestation } from "../../lib/intel/attestation";
import { IntelAlertsPage } from "../../../views/intel/alerts";
import { intelPage as page } from "./ui-page";

export function createIntelAlertsUiRoutes(
  deps: IntelRouteDeps,
  operator: (c: Context) => OperatorAuthContext,
) {
  const app = new Hono();

  app.get("/alerts", async (c) => {
    const op = operator(c);
    if (!deps.registryStores || !deps.consent || !deps.scanJobs)
      return c.json(INTEL_KEY_MISSING, 503);
    const rows = await listPortfolio(
      deps.registryStores,
      deps.consent,
      deps.scanJobs,
      op.tenant_id,
    );
    const attestations = new Map<string, IntelAttestation[]>();
    if (deps.attestations) {
      for (const row of rows) {
        attestations.set(
          row.site.id,
          await deps.attestations.forSite(row.site.id),
        );
      }
    }
    const generated = new Date().toISOString();
    return c.html(
      page(
        IntelAlertsPage(
          buildAlerts(rows, attestations),
          generated,
        ).toString(),
        "Attention feed — Agent Surface Intel",
        "/intel/alerts",
      ),
    );
  });

  return app;
}
