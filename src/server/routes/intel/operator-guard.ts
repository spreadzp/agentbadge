// EPIC-262 (SLICE-262-8): shared gate for operator-channel routes —
// abop_ auth → role check → {site_id} body → site resolution →
// tenant isolation. Each caller maps the failure onto c.json; the
// gate itself never writes the response.

import {
  authenticateOperator,
  rolePermitted,
  type OperatorAuthContext,
} from "../../lib/intel/registry";
import type { IntelRouteDeps } from "./index";

export type OperatorSiteCtx = {
  site: { id: string };
  tenantId: string;
  primaryHostname: string | null;
};

export type OperatorGate =
  | {
      ok: true;
      op: OperatorAuthContext;
      siteId: string;
      ctx: OperatorSiteCtx;
    }
  | {
      ok: false;
      status: 400 | 401 | 403 | 404 | 409;
      body: Record<string, unknown>;
    };

export async function gateOperatorSite(
  deps: IntelRouteDeps,
  token: string | null,
  body: { site_id?: unknown } | null,
  op: string,
): Promise<OperatorGate> {
  const auth =
    token && deps.registryStores
      ? await authenticateOperator(deps.registryStores, token)
      : null;
  if (!auth) {
    return {
      ok: false,
      status: 401,
      body: {
        error: "key_invalid",
        message: "missing, unknown, or revoked operator key",
      },
    };
  }
  if (!rolePermitted(auth.role, op)) {
    return {
      ok: false,
      status: 403,
      body: {
        error: "role_denied",
        role: auth.role,
        message: `role "${auth.role}" cannot run ${op}`,
      },
    };
  }
  const siteId = typeof body?.site_id === "string" ? body.site_id : "";
  if (!siteId) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "site_id_required",
        message: "operator calls require body {site_id}",
      },
    };
  }
  const ctx = await deps.registry!.resolveSiteContext(siteId);
  if (!ctx) {
    return {
      ok: false,
      status: 404,
      body: { error: "site_unknown", message: `unknown site ${siteId}` },
    };
  }
  if (!ctx.tenantId) {
    return {
      ok: false,
      status: 409,
      body: {
        error: "site_no_tenant",
        message: "site is not attached to a tenant",
      },
    };
  }
  if (ctx.tenantId !== auth.tenant_id) {
    return {
      ok: false,
      status: 403,
      body: {
        error: "site_not_in_tenant",
        message: "site belongs to a different tenant",
      },
    };
  }
  return {
    ok: true,
    op: auth,
    siteId,
    ctx: {
      site: { id: ctx.site.id },
      tenantId: ctx.tenantId,
      primaryHostname: ctx.primaryHostname,
    },
  };
}
