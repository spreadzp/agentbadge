// EPIC-262 (SLICE-262-22): tenant data export — D-262-Q13 «данные
// клиента — клиенту». NOT a paid op: the export stays available in
// soft_off (D-262-Q8 matrix row). Least disclosure: credential
// material (keyHash) never leaves — a hash is useless to the client
// and harmful if it does; ids/prefixes/status are the exportable
// facts.
import type { IntelRegistryStores } from "../registry/store";
import type { IntelEntitlementStore } from "../entitlement/store";
import type { IntelEntitlementEventStore } from "../entitlement/events-store";
import type { IntelConsentStore } from "../consent/store";
import type { IntelScanJobStore } from "../scan/store";
import type { IntelAttestationStore } from "../attestation/store";
import { effectiveStatus } from "../entitlement/lifecycle";

export interface ExportDeps {
  stores: IntelRegistryStores;
  entitlements?: IntelEntitlementStore;
  entitlementEvents?: IntelEntitlementEventStore;
  consent?: IntelConsentStore;
  scanJobs?: IntelScanJobStore;
  attestations?: IntelAttestationStore;
}

export const EXPORT_FORMAT = "agentbadge-export/1" as const;

export async function exportTenantData(
  deps: ExportDeps,
  tenantId: string,
  now: string,
) {
  const tenant = await deps.stores.tenants.byId(tenantId);
  if (!tenant) return null;
  const customers = await deps.stores.customers.forTenant(tenantId);
  const sites = [];
  for (const cu of customers) {
    for (const site of await deps.stores.sites.forCustomer(cu.id)) {
      const [domains, keys, ownership, consents, consentEvents, scans, attestations] =
        await Promise.all([
          deps.stores.domains.forSite(site.id),
          deps.stores.siteKeys.forSite(site.id),
          deps.stores.ownership.forSite(site.id),
          deps.consent?.forSite(site.id) ?? Promise.resolve([]),
          deps.consent?.eventsForSite(site.id) ?? Promise.resolve([]),
          deps.scanJobs?.forSite(site.id) ?? Promise.resolve([]),
          deps.attestations?.forSite(site.id) ?? Promise.resolve([]),
        ]);
      sites.push({
        site,
        customer_id: cu.id,
        domains,
        // keyHash intentionally absent — credential material
        site_keys: keys.map(({ id, keyPrefix, status, rotatedFromId, createdAt, revokedAt }) => ({
          id, keyPrefix, status, rotatedFromId, createdAt, revokedAt,
        })),
        ownership,
        consents,
        consent_events: consentEvents,
        scans: scans.map((j) => ({ ...j, report: j.report ?? null })),
        attestations,
      });
    }
  }
  const entitlement = (await deps.entitlements?.getByTenant(tenantId)) ?? null;
  const entitlementEvents =
    (await deps.entitlementEvents?.forTenant(tenantId)) ?? [];
  return {
    format: EXPORT_FORMAT,
    exported_at: now,
    tenant,
    customers,
    sites,
    entitlement: entitlement
      ? { ...entitlement, effective_status: effectiveStatus(entitlement, now) }
      : null,
    entitlement_events: entitlementEvents,
  };
}
