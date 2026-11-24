// EPIC-262 (SLICE-262-21): POST /billing/webhook/:provider — the
// billing rail's ONLY entry point. No operator auth: authenticity IS
// the provider signature over raw bytes. Unconfigured provider → 503
// (honest: surface absent), bad signature → 401, unmapped → 422,
// duplicate externalId → deduped (webhooks retry — applied:false).
import type { Hono } from "hono";
import {
  createStripeConnector,
  createFreemiusConnector,
  handleBillingSignal,
  type IntelBillingConnector,
} from "../../lib/intel/billing";
import { createMemoryEntitlementEventStore } from "../../lib/intel/entitlement";
import type { IntelRouteDeps } from "./index";

export function registerBillingRoutes(app: Hono, deps: IntelRouteDeps): void {
  // process-local dedupe — retries inside one process converge;
  // cross-instance dedupe lands with the events table (0.6.34 gap)
  const seen = new Set<string>();
  const fallbackEvents = createMemoryEntitlementEventStore();

  const connectorFor = (provider: string): IntelBillingConnector | null => {
    const s = deps.billingSecrets;
    if (provider === "stripe" && s?.stripe) return createStripeConnector(s.stripe);
    if (provider === "freemius" && s?.freemius) return createFreemiusConnector(s.freemius);
    return null;
  };

  app.post("/billing/webhook/:provider", async (c) => {
    const provider = c.req.param("provider");
    const conn = connectorFor(provider);
    if (!conn) {
      return c.json(
        { error: "billing_unconfigured", message: `no webhook secret for "${provider}"` },
        503,
      );
    }
    if (!deps.entitlement || !deps.registryStores) {
      return c.json({ error: "billing_unavailable" }, 503);
    }
    const rawBody = await c.req.text();
    const headers = Object.fromEntries(
      ["stripe-signature", "x-fs-signature"].map(
        (h) => [h, c.req.header(h)] as const,
      ),
    );
    const v = conn.verifyAndMap(headers, rawBody);
    if (!v.ok) {
      const status = v.error === "bad_signature" ? 401 : v.error === "bad_payload" ? 400 : 422;
      return c.json({ error: v.error }, status);
    }
    const results = [];
    for (const signal of v.signals) {
      const key = `${provider}:${signal.externalId}`;
      if (seen.has(key)) {
        results.push({ external_id: signal.externalId, applied: false, reason: "duplicate" });
        continue;
      }
      seen.add(key);
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
      const r = await handleBillingSignal(
        {
          entitlements: deps.entitlement,
          events: deps.entitlementEvents ?? fallbackEvents,
          tenantSiteIds,
        },
        provider,
        signal,
      );
      results.push({
        external_id: signal.externalId,
        tenant: signal.tenantId || null,
        ...r,
      });
    }
    return c.json({ results }, 200);
  });
}
