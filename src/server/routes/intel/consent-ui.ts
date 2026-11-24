// EPIC-262 (SLICE-262-23): consent management form route for the
// dashboard — grant/revoke per kind, same op gate as the API
// (rolePermitted "consent") and the same tenant scope (404 on
// foreign). Kept outside ui.ts (line budget).
import { Hono } from "hono";
import type { Context } from "hono";
import type { IntelRouteDeps } from ".";
import { INTEL_KEY_MISSING } from ".";
import {
  CONSENT_KINDS,
  grantConsent,
  revokeConsent,
  type ConsentKind,
} from "../../lib/intel/consent";
import { rolePermitted } from "../../lib/intel/registry/operators";
import type { OperatorAuthContext } from "../../lib/intel/registry/types";

export function createIntelConsentUiRoutes(
  deps: IntelRouteDeps,
  operator: (c: Context) => OperatorAuthContext,
) {
  const app = new Hono();

  app.post("/sites/:siteId/consent", async (c) => {
    const op = operator(c);
    if (!rolePermitted(op.role, "consent"))
      return c.json({ error: "role_denied" }, 403);
    if (!deps.registryStores || !deps.consent || !deps.registry)
      return c.json(INTEL_KEY_MISSING, 503);
    const siteId = c.req.param("siteId");
    const ctx = await deps.registry.resolveSiteContext(siteId);
    if (!ctx || ctx.tenantId !== op.tenant_id)
      return c.text("Not found", 404);
    const body = await c.req.parseBody();
    const kind = body["kind"];
    const action = body["action"];
    if (
      typeof kind !== "string" ||
      !(CONSENT_KINDS as readonly string[]).includes(kind) ||
      (action !== "grant" && action !== "revoke")
    )
      return c.redirect(`/intel/sites/${siteId}?consent=invalid`);
    const grantedBy = { principal: "operator" as const, id: op.operator_id };
    if (action === "grant") {
      await grantConsent(deps.consent, siteId, kind as ConsentKind, grantedBy);
    } else {
      await revokeConsent(deps.consent, siteId, kind as ConsentKind, grantedBy);
    }
    return c.redirect(`/intel/sites/${siteId}`);
  });

  return app;
}
