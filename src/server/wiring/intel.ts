// EPIC-262 (SLICE-262-0a): intel surface wiring.
// INTEL_ENABLED off → nothing mounts (zero surface, ARC_VENUE_ENABLED
// precedent). Enabled without a key → routes mount but 503 honestly.
import type { Hono } from "hono";
import { logger } from "@agentbadge/passport/logger";
import { getConfig } from "../../config/env";
import { resolveIntelSigningKey } from "../lib/intel/keys";
import { createIntelApiRoutes, createIntelKeysRoutes } from "../routes/intel";

export function wireIntel(app: Hono): void {
  const cfg = getConfig().intel;
  if (!cfg?.enabled) return;

  const key = resolveIntelSigningKey(cfg);
  app.route("/api/intel", createIntelApiRoutes({ key }));
  app.route("/", createIntelKeysRoutes({ key }));
  logger.info("Intel routes registered", {
    keyId: cfg.keyId,
    keyResolved: key !== null,
  });
}
