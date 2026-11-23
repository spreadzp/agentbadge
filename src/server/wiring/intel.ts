// EPIC-262 (SLICE-262-0a/3): intel surface wiring.
// INTEL_ENABLED off → nothing mounts (zero surface, ARC_VENUE_ENABLED
// precedent). Enabled without a key → routes mount but 503 honestly.
import type { Hono } from "hono";
import { logger } from "@agentbadge/passport/logger";
import { getConfig } from "../../config/env";
import { getDatabase } from "../lib/database";
import { resolveIntelSigningKey } from "../lib/intel/keys";
import {
  pickIntelRegistryStores,
  createIntelRegistryService,
} from "../lib/intel/registry";
import { pickIntelEvidenceStore } from "../lib/intel/evidence/db-stores";
import { pickIntelEntitlementStore } from "../lib/intel/entitlement";
import { INTEL_WP_PROFILE_V1 } from "../lib/intel/rules";
import {
  createSafeScanFetch,
  pickIntelScanJobStore,
} from "../lib/intel/scan";
import { createIntelApiRoutes, createIntelKeysRoutes } from "../routes/intel";

export function wireIntel(app: Hono): void {
  const cfg = getConfig().intel;
  if (!cfg?.enabled) return;

  const key = resolveIntelSigningKey(cfg);
  const db = getDatabase();
  const registry = createIntelRegistryService(
    pickIntelRegistryStores(db),
  );
  const evidence = pickIntelEvidenceStore(db);
  const entitlement = pickIntelEntitlementStore(db);
  const scanJobs = pickIntelScanJobStore(db);
  app.route(
    "/api/intel",
    createIntelApiRoutes({
      key,
      registry,
      evidence,
      evidenceRetentionDays: cfg.evidenceRetentionDays,
      entitlement,
      scanJobs,
      ruleset: INTEL_WP_PROFILE_V1,
      scanFetch: createSafeScanFetch(),
    }),
  );
  app.route("/", createIntelKeysRoutes({ key }));
  logger.info("Intel routes registered", {
    keyId: cfg.keyId,
    keyResolved: key !== null,
    registryBackend: "wired",
    evidenceBackend: evidence.backend,
  });
}
