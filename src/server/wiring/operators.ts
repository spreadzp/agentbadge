/**
 * EPIC-264: operator wiring — boot-time env seed (D-264-Q15, C9,
 * SLICE-264-3) + the admin surfaces (SLICE-264-4). The seed hook
 * exists so the FIRST human credential can exist before any surface
 * consumes operatorAuth; the routes are the only operator-admin
 * boundary — no shared-key bypass by design.
 */

import type { Hono } from "hono";
import { logger } from "@agentbadge/passport/logger";

import { getConfig } from "../../config/env";
import { getDatabase } from "../lib/database";
import { pickOperatorStores, seedOperatorsFromEnv } from "../lib/operators";
import { createAdminOperatorsApi } from "../routes/admin-operators-api";
import { createAdminOperatorsUi } from "../routes/admin-operators-ui";
import { logBreakGlassPosture } from "../middleware/operator-breakglass";

export async function wireOperators(app: Hono): Promise<void> {
  const store = pickOperatorStores(getDatabase());

  // 264-4: JSON API /admin/api/operators/* (operatorAuth + cap) and
  // SSR console /admin/operators (operatorBrowserAuth + Origin gate).
  app.route("/", createAdminOperatorsApi(store));
  app.route("/", createAdminOperatorsUi(store));

  // 264-9: boot posture — break-glass armed/disarmed logged once.
  logBreakGlassPosture();

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
