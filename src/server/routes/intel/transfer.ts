// EPIC-262 (SLICE-262-22): churn & transfer surface —
//   POST /sites/:siteId/transfer {to_customer}  (write, role-gated)
//   GET  /export                              (read, NOT a paid op —
//                                              D-262-Q13/Q8)
// Both are abop_-only tenant-scoped; a site outside the caller's
// tenant is 404 like everywhere else (existence isn't probe-able).
import type { Context, Hono } from "hono";
import {
  authenticateOperator,
  rolePermitted,
} from "../../lib/intel/registry";
import {
  transferSite,
  exportTenantData,
} from "../../lib/intel/transfer";
import { createMemoryEntitlementEventStore } from "../../lib/intel/entitlement";
import { INTEL_KEY_MISSING, type IntelRouteDeps } from "./index";

const fallbackEvents = createMemoryEntitlementEventStore();

function bearerToken(c: { req: { header(name: string): string | undefined } }) {
  const h = c.req.header("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

export function registerTransferRoutes(app: Hono, deps: IntelRouteDeps): void {
  const auth = async (c: Context) => {
    const token = bearerToken(c);
    if (!token || !deps.registryStores) return null;
    return authenticateOperator(deps.registryStores, token);
  };

  /** site → caller's tenant? Same rule as consent/attestation routes:
   *  resolve context, compare tenant_id, foreign → null (404 later). */
  const callerSite = async (opTenantId: string, siteId: string) => {
    if (!deps.registry) return null;
    const ctx = await deps.registry.resolveSiteContext(siteId);
    return ctx && ctx.tenantId === opTenantId ? ctx : null;
  };

  app.post("/sites/:siteId/transfer", async (c) => {
    if (!deps.key) return c.json(INTEL_KEY_MISSING, 503);
    const op = await auth(c);
    if (!op) {
      return c.json(
        { error: "key_invalid", message: "missing, unknown, or revoked operator key" },
        401,
      );
    }
    if (!rolePermitted(op.role, "transfer")) {
      return c.json(
        { error: "role_denied", role: op.role, message: `role "${op.role}" cannot transfer sites` },
        403,
      );
    }
    if (!deps.registryStores || !deps.entitlement || !deps.consent) {
      return c.json({ error: "transfer_unavailable" }, 503);
    }
    const siteId = c.req.param("siteId");
    const ctx = await callerSite(op.tenant_id, siteId);
    if (!ctx) return c.json({ error: "site_not_found" }, 404);
    const body = (await c.req.json().catch(() => null)) as {
      to_customer?: unknown;
    } | null;
    if (typeof body?.to_customer !== "string" || !body.to_customer) {
      return c.json({ error: "to_customer required (cus_<ulid>)" }, 400);
    }
    const r = await transferSite(
      {
        stores: deps.registryStores,
        lifecycle: {
          entitlements: deps.entitlement,
          events: deps.entitlementEvents ?? fallbackEvents,
        },
        consent: deps.consent,
      },
      { siteId, toCustomerId: body.to_customer },
    );
    if (!r.ok) return c.json({ error: "transfer_failed", reason: r.reason }, 422);
    return c.json(
      {
        site: r.site,
        from_tenant: r.fromTenantId,
        to_tenant: r.toTenantId,
        consent_revocations: r.consentRevocations,
        reverify_flags: r.reverifyFlags,
        coverage: {
          removed_from_source: r.coverage.removedFromSource,
          added_to_target: r.coverage.addedToTarget,
        },
        // honest reminder, not a claim — ops on the new tenant still
        // need consent re-grant + coverage (see response fields)
        note: "post-transfer ops require new consent grant (D-262-Q13) and target coverage",
      },
      200,
    );
  });

  // Export stays un-gated by entitlement — it is the client's own
  // data (D-262-Q13); the D-262-Q8 matrix keeps it open in soft_off.
  app.get("/export", async (c) => {
    if (!deps.key) return c.json(INTEL_KEY_MISSING, 503);
    const op = await auth(c);
    if (!op) {
      return c.json(
        { error: "key_invalid", message: "missing, unknown, or revoked operator key" },
        401,
      );
    }
    if (!deps.registryStores) {
      return c.json({ error: "export_unavailable" }, 503);
    }
    const bundle = await exportTenantData(
      {
        stores: deps.registryStores,
        entitlements: deps.entitlement,
        entitlementEvents: deps.entitlementEvents ?? fallbackEvents,
        consent: deps.consent,
        scanJobs: deps.scanJobs,
        attestations: deps.attestations,
      },
      op.tenant_id,
      new Date().toISOString(),
    );
    if (!bundle) return c.json({ error: "tenant_not_found" }, 404);
    return c.json(bundle, 200);
  });
}
