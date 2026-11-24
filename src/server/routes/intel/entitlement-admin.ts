// EPIC-262 (SLICE-262-19b): entitlement admin — operator-facing plan
// assignment + lifecycle transitions for THEIR OWN tenant. abop_
// only: a site_key has no tenant-admin standing. Reads are open to
// viewer (transparency ≠ a paid op); every write sits behind
// rolePermitted "entitlement" and lands an append-only event.
import type { Context, Hono } from "hono";
import {
  INTEL_PLANS,
  planFor,
  assignPlan,
  transitionEntitlement,
  sweepEntitlement,
  effectiveStatus,
  createMemoryEntitlementEventStore,
  type LifecycleDeps,
  type TransitionAction,
} from "../../lib/intel/entitlement";
import { authenticateOperator, rolePermitted } from "../../lib/intel/registry";
import { INTEL_KEY_MISSING, type IntelRouteDeps } from "./index";

const ACTIONS: TransitionAction[] = [
  "activate",
  "renew",
  "payment_failed",
  "payment_recovered",
  "expire",
  "cancel",
];

// Process-local event log until @agentbadge/database ships the
// table (same known-gap as consent events / scanId index — batches
// into the next package bump).
const fallbackEvents = createMemoryEntitlementEventStore();

function bearerToken(c: { req: { header(name: string): string | undefined } }) {
  const h = c.req.header("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

export function registerEntitlementAdminRoutes(
  app: Hono,
  deps: IntelRouteDeps,
): void {
  const lifecycle = (): LifecycleDeps | null =>
    deps.entitlement
      ? {
          entitlements: deps.entitlement,
          events: deps.entitlementEvents ?? fallbackEvents,
        }
      : null;

  const auth = async (c: Context) => {
    const token = bearerToken(c);
    if (!token || !deps.registryStores) return null;
    return authenticateOperator(deps.registryStores, token);
  };

  const tenantSiteIds = async (tenantId: string) => {
    const customers = await deps.registryStores!.customers.forTenant(tenantId);
    const ids: string[] = [];
    for (const cu of customers) {
      for (const s of await deps.registryStores!.sites.forCustomer(cu.id)) {
        if (s.status === "active") ids.push(s.id);
      }
    }
    return ids.sort();
  };

  app.get("/entitlement", async (c) => {
    if (!deps.key) return c.json(INTEL_KEY_MISSING, 503);
    const op = await auth(c);
    if (!op) {
      return c.json({ error: "key_invalid", message: "missing, unknown, or revoked operator key" }, 401);
    }
    const ld = lifecycle();
    if (!ld) return c.json({ error: "entitlement_unavailable" }, 503);
    const now = new Date().toISOString();
    const ent = await ld.entitlements.getByTenant(op.tenant_id);
    const events = await ld.events.forTenant(op.tenant_id);
    return c.json({
      entitlement: ent
        ? { ...ent, effective_status: effectiveStatus(ent, now) }
        : null,
      plans: INTEL_PLANS,
      events: events.slice(-50),
    });
  });

  app.put("/entitlement/plan", async (c) => {
    if (!deps.key) return c.json(INTEL_KEY_MISSING, 503);
    const op = await auth(c);
    if (!op) {
      return c.json({ error: "key_invalid", message: "missing, unknown, or revoked operator key" }, 401);
    }
    if (!rolePermitted(op.role, "entitlement")) {
      return c.json(
        { error: "role_denied", role: op.role, message: `role "${op.role}" cannot manage entitlement` },
        403,
      );
    }
    const ld = lifecycle();
    if (!ld) return c.json({ error: "entitlement_unavailable" }, 503);
    const body = (await c.req.json().catch(() => null)) as {
      plan?: unknown;
      covered_site_ids?: unknown;
    } | null;
    if (typeof body?.plan !== "string" || !planFor(body.plan)) {
      return c.json(
        { error: "plan_invalid", plans: INTEL_PLANS.map((p) => p.code) },
        400,
      );
    }
    const r = await assignPlan(ld, {
      tenantId: op.tenant_id,
      planCode: body.plan,
      coveredSiteIds: Array.isArray(body.covered_site_ids)
        ? (body.covered_site_ids as string[])
        : undefined,
      tenantSiteIds: await tenantSiteIds(op.tenant_id),
      now: new Date().toISOString(),
      actor: { principal: "operator", id: op.operator_id },
    });
    if (!r.ok) return c.json({ error: "assign_failed", reason: r.reason }, 422);
    return c.json({ entitlement: r.entitlement }, 200);
  });

  app.post("/entitlement/transition", async (c) => {
    if (!deps.key) return c.json(INTEL_KEY_MISSING, 503);
    const op = await auth(c);
    if (!op) {
      return c.json({ error: "key_invalid", message: "missing, unknown, or revoked operator key" }, 401);
    }
    if (!rolePermitted(op.role, "entitlement")) {
      return c.json(
        { error: "role_denied", role: op.role, message: `role "${op.role}" cannot manage entitlement` },
        403,
      );
    }
    const ld = lifecycle();
    if (!ld) return c.json({ error: "entitlement_unavailable" }, 503);
    const body = (await c.req.json().catch(() => null)) as {
      action?: unknown;
    } | null;
    const action = body?.action as TransitionAction;
    if (!ACTIONS.includes(action)) {
      return c.json({ error: "action_invalid", actions: ACTIONS }, 400);
    }
    const r = await transitionEntitlement(ld, {
      tenantId: op.tenant_id,
      action,
      now: new Date().toISOString(),
      actor: { principal: "operator", id: op.operator_id },
    });
    if (!r.ok) return c.json({ error: "transition_failed", reason: r.reason }, 422);
    return c.json({ entitlement: r.entitlement }, 200);
  });

  app.post("/entitlement/sweep", async (c) => {
    if (!deps.key) return c.json(INTEL_KEY_MISSING, 503);
    const op = await auth(c);
    if (!op) {
      return c.json({ error: "key_invalid", message: "missing, unknown, or revoked operator key" }, 401);
    }
    if (!rolePermitted(op.role, "entitlement")) {
      return c.json(
        { error: "role_denied", role: op.role, message: `role "${op.role}" cannot manage entitlement` },
        403,
      );
    }
    const ld = lifecycle();
    if (!ld) return c.json({ error: "entitlement_unavailable" }, 503);
    const r = await sweepEntitlement(ld, op.tenant_id, new Date().toISOString());
    return c.json({ changed: r.changed, entitlement: r.entitlement }, 200);
  });
}
