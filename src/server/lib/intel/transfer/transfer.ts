// EPIC-262 (SLICE-262-22): site transfer between tenants — the
// customerId moves, EVERYTHING keyed by siteId survives byte-for-byte
// (scan jobs, signed reports, previous_hash chain, attestations —
// D-262-Q13 "без переписи canonical reports"). What a transfer must
// RESET is authority, not history: old tenant loses coverage+access,
// granted consents die (new ops need new consent), ownership proofs
// go due for re-verify (D-262-Q9). site_keys stay — a key belongs to
// the site, not the tenant.
import type { IntelRegistryStores } from "../registry/store";
import type { IntelSite } from "../registry/types";
import type { IntelEntitlementStore } from "../entitlement/store";
import { planFor, type LifecycleDeps } from "../entitlement";
import { newEntitlementEvent } from "../entitlement/events-store";
import type { IntelConsentStore } from "../consent/store";
import { generateReportId } from "../../../../agent-readiness/integrity/ulid";

export interface TransferDeps {
  stores: IntelRegistryStores;
  lifecycle: LifecycleDeps;
  consent: IntelConsentStore;
}

export type TransferResult =
  | {
      ok: true;
      site: IntelSite;
      fromTenantId: string;
      toTenantId: string;
      consentRevocations: number;
      reverifyFlags: number;
      coverage: { removedFromSource: boolean; addedToTarget: boolean | "over_limit" };
    }
  | { ok: false; reason: string };

async function tenantOfCustomer(
  stores: IntelRegistryStores,
  customerId: string,
) {
  const cu = await stores.customers.byId(customerId);
  if (!cu) return null;
  return stores.tenants.byId(cu.tenantId);
}

async function coverageEvent(
  lifecycle: LifecycleDeps,
  tenantId: string,
  coveredSiteIds: string[],
  ent: NonNullable<Awaited<ReturnType<IntelEntitlementStore["getByTenant"]>>>,
  action: "transfer_out" | "transfer_in",
  now: string,
  reason: string,
) {
  await lifecycle.entitlements.upsert({ ...ent, coveredSiteIds, updatedAt: now });
  await lifecycle.events.insert(
    newEntitlementEvent({
      tenantId,
      actor: "system:transfer",
      action,
      fromStatus: ent.status,
      toStatus: ent.status,
      plan: ent.plan,
      reason,
      at: now,
    }),
  );
}

export async function transferSite(
  deps: TransferDeps,
  input: { siteId: string; toCustomerId: string; now?: string },
): Promise<TransferResult> {
  const now = input.now ?? new Date().toISOString();
  const { stores } = deps;
  const site = await stores.sites.byId(input.siteId);
  if (!site || site.status !== "active") {
    return { ok: false, reason: "site not found or not active" };
  }
  const [fromTenant, toCustomer] = await Promise.all([
    tenantOfCustomer(stores, site.customerId),
    stores.customers.byId(input.toCustomerId),
  ]);
  if (!fromTenant) return { ok: false, reason: "source tenant unresolved" };
  if (!toCustomer || toCustomer.status !== "active") {
    return { ok: false, reason: "target customer not found or not active" };
  }
  const toTenant = await stores.tenants.byId(toCustomer.tenantId);
  if (!toTenant || toTenant.status !== "active") {
    return { ok: false, reason: "target tenant not found or not active" };
  }
  if (toTenant.id === fromTenant.id) {
    return { ok: false, reason: "same_tenant (move within tenant is a no-op)" };
  }

  const moved = await stores.sites.update({
    ...site,
    customerId: toCustomer.id,
    updatedAt: now,
  });

  // coverage — honest in both directions
  const srcEnt = await deps.lifecycle.entitlements.getByTenant(fromTenant.id);
  let removedFromSource = false;
  if (srcEnt?.coveredSiteIds.includes(site.id)) {
    removedFromSource = true;
    await coverageEvent(
      deps.lifecycle,
      fromTenant.id,
      srcEnt.coveredSiteIds.filter((id) => id !== site.id),
      srcEnt,
      "transfer_out",
      now,
      `site ${site.id} transferred to tenant ${toTenant.id}`,
    );
  }
  const dstEnt = await deps.lifecycle.entitlements.getByTenant(toTenant.id);
  let addedToTarget: boolean | "over_limit" = false;
  if (dstEnt && dstEnt.status !== "canceled" && dstEnt.status !== "expired") {
    const limit = planFor(dstEnt.plan)?.siteLimit ?? Infinity;
    const covered = dstEnt.coveredSiteIds;
    if (covered.includes(site.id)) {
      addedToTarget = true; // already there — nothing to write
    } else if (covered.length < limit) {
      addedToTarget = true;
      await coverageEvent(
        deps.lifecycle,
        toTenant.id,
        [...covered, site.id],
        dstEnt,
        "transfer_in",
        now,
        `site ${site.id} received from tenant ${fromTenant.id}`,
      );
    } else {
      addedToTarget = "over_limit";
      await deps.lifecycle.events.insert(
        newEntitlementEvent({
          tenantId: toTenant.id,
          actor: "system:transfer",
          action: "transfer_in",
          fromStatus: dstEnt.status,
          toStatus: dstEnt.status,
          plan: dstEnt.plan,
          reason: `site ${site.id} received but plan "${dstEnt.plan}" full — uncovered until operator covers`,
          at: now,
        }),
      );
    }
  }

  // consent reset — D-262-Q13: new ops after transfer need new consent
  const consents = await deps.consent.forSite(site.id);
  let consentRevocations = 0;
  for (const c of consents) {
    if (c.status === "granted" && c.revokedAt === null) {
      await deps.consent.upsert({
        ...c,
        status: "revoked",
        revokedAt: now,
        updatedAt: now,
      });
      await deps.consent.appendEvent({
        id: `cev_${generateReportId()}`,
        siteId: site.id,
        kind: c.kind,
        action: "revoked",
        principal: "system",
        principalId: `transfer:${fromTenant.id}→${toTenant.id}`,
        at: now,
      });
      consentRevocations++;
    }
  }

  // ownership re-verify — D-262-Q9: transfer is a re-verify trigger;
  // proofs stay but go immediately due
  let reverifyFlags = 0;
  for (const kind of ["installation_control", "domain_control"] as const) {
    const p = await stores.ownership.byScope(site.id, kind);
    if (p?.status === "verified") {
      await stores.ownership.upsert({ ...p, reverifyAfter: now, updatedAt: now });
      reverifyFlags++;
    }
  }

  return {
    ok: true,
    site: moved,
    fromTenantId: fromTenant.id,
    toTenantId: toTenant.id,
    consentRevocations,
    reverifyFlags,
    coverage: { removedFromSource, addedToTarget },
  };
}
