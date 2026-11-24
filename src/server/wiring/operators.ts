/**
 * EPIC-264 (SLICE-264-3): operator wiring — boot-time env seed
 * (D-264-Q15, C9). Routes for operator management land in 264-4;
 * this hook exists so the FIRST human credential can exist before
 * any surface consumes operatorAuth.
 */

import type { Hono } from "hono";
import { logger } from "@agentbadge/passport/logger";

import { getConfig } from "../../config/env";
import { getDatabase } from "../lib/database";
import { pickOperatorStores, seedOperatorsFromEnv } from "../lib/operators";

export async function wireOperators(app: Hono): Promise<void> {
  void app; // routes arrive in SLICE-264-4
  const store = pickOperatorStores(getDatabase());

  // Honest posture check: DATABASE_ENABLED=true with a memory backend
  // means the installed @agentbadge/database predates the
  // adminOperators group — persistence would be illusory on PG
  // deploys. Loud, not silent.
  if (getConfig().database?.enabled && store.backend === "memory") {
    logger.warn(
      "operators: DATABASE_ENABLED but adminOperators group absent in installed @agentbadge/database — store is MEMORY (publish the package for PG persistence)",
    );
  }

  // seed failure is loud-but-not-fatal (database.health() probe
  // precedent): a thrown store error must not crash boot.
  let result;
  try {
    result = await seedOperatorsFromEnv(store);
  } catch (e) {
    logger.error("operators: OPERATOR_SEED_JSON apply threw", {
      error: e instanceof Error ? e.message : String(e),
    });
    return;
  }
  if (!result.ok) {
    // malformed seed config — loud at boot, server still starts
    logger.error("operators: OPERATOR_SEED_JSON refused", {
      reason: result.reason,
    });
  } else if (result.seeded) {
    logger.info("operators: bootstrap operator seeded", {
      operatorId: result.operatorId,
      credentialId: result.credentialId,
      backend: store.backend,
    });
  }
}
