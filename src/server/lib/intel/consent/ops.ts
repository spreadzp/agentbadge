// EPIC-262 (SLICE-262-8): consent ops — store-level functions
// (service.ts is at its line budget); grant/revoke keep the same row
// via upsert so history is the LATEST state per (siteId, kind).

import { generateReportId } from "../../../../agent-readiness/integrity/ulid";
import type { IntelConsentStore } from "./store";
import type { ConsentKind, ConsentPrincipal, IntelConsent } from "./types";

export async function grantConsent(
  store: IntelConsentStore,
  siteId: string,
  kind: ConsentKind,
  grantedBy: { principal: ConsentPrincipal; id: string },
): Promise<IntelConsent> {
  const existing = await store.byScope(siteId, kind);
  const now = new Date().toISOString();
  return store.upsert({
    id: existing?.id ?? `con_${generateReportId()}`,
    siteId,
    kind,
    status: "granted",
    grantedByPrincipal: grantedBy.principal,
    grantedById: grantedBy.id,
    grantedAt: now,
    revokedAt: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

export async function revokeConsent(
  store: IntelConsentStore,
  siteId: string,
  kind: ConsentKind,
  revokedBy: { principal: ConsentPrincipal; id: string },
): Promise<IntelConsent> {
  const existing = await store.byScope(siteId, kind);
  const now = new Date().toISOString();
  return store.upsert({
    id: existing?.id ?? `con_${generateReportId()}`,
    siteId,
    kind,
    status: "revoked",
    grantedByPrincipal: existing?.grantedByPrincipal ?? revokedBy.principal,
    grantedById: existing?.grantedById ?? revokedBy.id,
    grantedAt: existing?.grantedAt ?? now,
    revokedAt: now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

/** granted-and-live check — the scans/paid-op gate (D-262-Q8). */
export async function hasActiveConsent(
  store: IntelConsentStore,
  siteId: string,
  kind: ConsentKind,
): Promise<boolean> {
  const c = await store.byScope(siteId, kind);
  return c?.status === "granted" && c.revokedAt === null;
}
