/**
 * Free endpoints — the catalog's `free[]` section (SLICE-179-4, D-179-6).
 * Same source-driven pattern as paid SKUs: entries gated by the
 * surface's `enabled` flag so a disabled deployment never advertises
 * a dead endpoint.
 */
import type { CatalogSources } from "../sources";
import type { FreeEndpoint } from "../types";

export function freeEntries(src: CatalogSources): FreeEndpoint[] {
  const list: FreeEndpoint[] = [
    {
      endpoint: "/api/health",
      method: "GET",
      limit: "unauthenticated",
      note: "Liveness/readiness probe",
    },
    {
      endpoint: "/api/v1/services",
      method: "GET",
      limit: "unauthenticated; 5min cache",
      note: "This catalog — canonical paid-services registry",
    },
  ];

  if (src.scan.enabled) {
    list.push({
      endpoint: "/api/scan-packs",
      method: "GET",
      limit: "unauthenticated",
      note: "Rule-bundle catalog — free discovery before buying a scan",
    });
  }

  if (src.marketplace.enabled) {
    list.push({
      endpoint: "/api/market/services",
      method: "GET",
      limit: "unauthenticated; 1min cache",
      note: "Marketplace service browse (?q= ?category= filters)",
    });
  }

  // Free-tier scan — the base keeperhub route is unauthenticated even
  // when the x402 premium variant is disabled (D-126-13 lineage).
  list.push({
    endpoint: "/api/keeperhub/scan",
    method: "POST",
    limit: "unauthenticated; rate-limited",
    note: 'Free agent-readiness scan — POST {"url": "...", "confirm": true}',
  });

  return list;
}
