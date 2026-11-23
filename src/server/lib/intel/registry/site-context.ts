// EPIC-262 (SLICE-262-6): site → tenant + primary-hostname resolution
// for operation gating and scan targeting.
import type { IntelRegistryStores } from "./store";
import type { IntelSite } from "./types";

export interface IntelSiteContext {
  site: IntelSite;
  customerId: string;
  tenantId: string | null;
  primaryHostname: string | null;
}

export async function resolveSiteContext(
  stores: IntelRegistryStores,
  siteId: string,
): Promise<IntelSiteContext | null> {
  const site = await stores.sites.byId(siteId);
  if (!site) return null;
  const [customer, domains] = await Promise.all([
    stores.customers.byId(site.customerId),
    stores.domains.forSite(siteId),
  ]);
  const primary =
    domains.find((d) => d.isPrimary && d.status === "active") ??
    domains.find((d) => d.status === "active") ??
    null;
  return {
    site,
    customerId: site.customerId,
    tenantId: customer?.tenantId ?? null,
    primaryHostname: primary?.hostname ?? null,
  };
}
