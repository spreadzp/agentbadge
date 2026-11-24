/**
 * Mint a site_key for a real site on the LIVE dev PG (262-17 path).
 * Usage: bun scripts/intel-mint-site.mts <domain>
 * Prints site_id + absk_ plaintext (shown once — paste into the WP plugin).
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
let tenant = await stores.tenants.findBySlug?.(slug);
if (!tenant) tenant = await registry.createTenant({ slug, name: "Pryme Studio" });
const customer = await registry.createCustomer(tenant.id, { name: "Pryme Studio" });
const site = await registry.createSite(customer.id, { domains: [domain] });
const siteKey = (await registry.mintSiteKey(site.id)).plaintext;
const op = await inviteOperator(stores, tenant.id, { email: "op@pryme.dev", role: "operator" });
// audit consent is granted inline by the plugin handshake; publication
// is operator-gated — grant here so verify surface works if attested.
await grantConsent(consent, site.id, "publication", { principal: "operator", id: op.record.id });
await assignPlan(
  { entitlements: entitlement, events: entEvents },
  {
    tenantId: tenant.id,
    planCode: "pilot",
    tenantSiteIds: [site.id],
    now: new Date().toISOString(),
    actor: { principal: "operator", id: op.record.id },
  },
);

console.log(JSON.stringify({
  tenant_id: tenant.id,
  customer_id: customer.id,
  site_id: site.id,
  site_key: siteKey,
  operator_key: op.plaintext ?? "(not returned)",
}, null, 2));
process.exit(0);
