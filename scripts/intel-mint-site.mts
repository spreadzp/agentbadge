/**
 * Mint a site_key for a real site on the LIVE dev PG (262-17 path).
 * Usage: bun scripts/intel-mint-site.mts <domain>
 * Idempotent — reuses tenant/customer/site/operator when present;
 * prints site_id + a FRESH absk_ plaintext each run (shown once).
 */
import { getDatabase } from "../src/server/lib/database";
import {
  pickIntelRegistryStores,
  createIntelRegistryService,
} from "../src/server/lib/intel/registry";
import { inviteOperator } from "../src/server/lib/intel/registry/operators";
import { pickIntelConsentStore } from "../src/server/lib/intel/consent/db-stores";
import { grantConsent } from "../src/server/lib/intel/consent";
import {
  pickIntelEntitlementStore,
  pickIntelEntitlementEventStore,
} from "../src/server/lib/intel/entitlement";
import { assignPlan } from "../src/server/lib/intel/entitlement";

const domain = process.argv[2] ?? "pryme.studio";
const db = getDatabase();
const stores = pickIntelRegistryStores(db);
const registry = createIntelRegistryService(stores);
const consent = pickIntelConsentStore(db);
const entitlement = pickIntelEntitlementStore(db);
const entEvents = pickIntelEntitlementEventStore(db);

const slug = "pryme";
const tenant =
  (await stores.tenants.bySlug(slug)) ??
  (await registry.createTenant({ slug, name: "Pryme Studio" }));

// site lookup by domain first (partial-run safe), else create under
// the first customer of the tenant.
let site = null;
const dom = await stores.domains.byHostname(domain);
if (dom) site = await stores.sites.byId(dom.siteId);
if (!site) {
  const customers = await stores.customers.forTenant(tenant.id);
  const customer =
    customers[0] ??
    (await registry.createCustomer(tenant.id, { name: "Pryme Studio" }));
  site = await registry.createSite(customer.id, { domains: [domain] });
}
const siteKey = (await registry.mintSiteKey(site.id)).plaintext;

const ops = await stores.operators.forTenant(tenant.id);
const op =
  ops.find((o) => o.email === "op@pryme.dev" && o.status === "active") ??
  (await inviteOperator(stores, tenant.id, {
    email: "op@pryme.dev",
    role: "operator",
  })).record;

// publication consent is operator-gated — grant once so verify works.
const existing = await consent.byScope(site.id, "publication");
if (!existing || existing.status !== "granted") {
  await grantConsent(consent, site.id, "publication", {
    principal: "operator",
    id: op.id,
  });
}
await assignPlan(
  { entitlements: entitlement, events: entEvents },
  {
    tenantId: tenant.id,
    planCode: "pilot",
    tenantSiteIds: [site.id],
    now: new Date().toISOString(),
    actor: { principal: "operator", id: op.id },
  },
).catch(() => undefined);

console.log(JSON.stringify({
  tenant_id: tenant.id,
  site_id: site.id,
  site_key: siteKey,
  operator_id: op.id,
}, null, 2));
process.exit(0);
