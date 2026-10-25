/**
 * SLICE-207-6 (D-207-4): advisory exposure endpoint —
 * `GET /api/ledger/agents/:address/exposure?counterparty=<addr>`.
 *
 * Returns { recommended_exposure_usd, confidence, reasons[],
 * dataQuality } from pair edge stats + counterparty forensics +
 * spend velocity. ADVISORY ONLY — a recommendation, never a block;
 * enforcement is a phase-2 decision. Thin data → "insufficient" +
 * null recommendation (honest, not a silent default).
 *
 * Kept separate from econ-ledger-api.ts (read-only ledger contract);
 * this is hosted intelligence (D-207-6), not the open read schema.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { Database } from "@agentbadge/database";
import { getDatabase } from "../lib/database";
import { createRateLimiter } from "../middleware/rate-limit";
import { assessExposure } from "../lib/econ-ledger/exposure";
import { assessAddress, type RiskVerdict } from "../lib/forensics/risk-service";
import { ADDRESS_RE, errJson } from "../lib/econ-ledger/api-utils";

const ledgerLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });

export interface EconLedgerExposureDeps {
  /** Injectable for tests; prod default = getDatabase(). */
  getDb?: () => Database;
  /** Counterparty forensics probe; omitted → verdict treated as
   *  no_data (honest degraded, not blocked). */
  assessCounterparty?: (counterparty: string) => Promise<RiskVerdict>;
}

export function createEconLedgerExposureRoutes(
  deps: EconLedgerExposureDeps = {},
): Hono {
  const getDb = deps.getDb ?? getDatabase;
  const app = new Hono();

  const assessFn =
    deps.assessCounterparty ??
    (process.env.FORENSICS_ENABLED === "false"
      ? undefined
      : (addr: string) =>
          assessAddress(addr.toLowerCase(), {
            stores: getDb().forensics,
            chain: "5042",
          }));

  app.get(
    "/api/ledger/agents/:address/exposure",
    describeRoute({
      tags: ["Ledger"],
      summary: "Advisory recommended exposure toward a counterparty",
      description:
        "Returns { recommended_exposure_usd, confidence, reasons[], " +
        "dataQuality } from pair edge stats + counterparty forensics + " +
        "spend velocity. Thin data → dataQuality 'insufficient' and " +
        "recommended_exposure_usd null (honest, not a silent default). " +
        "Advisory only — no enforcement.",
      responses: {
        200: { description: "ExposureAdvice" },
        400: { description: "Invalid address / missing counterparty" },
        429: { description: "Rate limited" },
      },
    }),
    async (c) => {
      const rl = await ledgerLimiter(c, async () => {});
      if (rl) return rl;
      const address = c.req.param("address");
      const counterparty = c.req.query("counterparty");
      if (!ADDRESS_RE.test(address)) {
        return errJson(c, 400, "invalid_address", "expected 0x + 40 hex");
      }
      if (!counterparty || !ADDRESS_RE.test(counterparty)) {
        return errJson(
          c,
          400,
          "invalid_address",
          "counterparty=0x + 40 hex is required",
        );
      }
      const db = getDb();
      if (db.db === null) {
        return c.json({
          recommended_exposure_usd: null,
          confidence: 0,
          reasons: ["ledger disabled (DATABASE_ENABLED=false)"],
          dataQuality: "insufficient",
        });
      }
      try {
        const advice = await assessExposure(
          address,
          counterparty,
          assessFn ? { db, assess: assessFn } : { db },
        );
        return c.json(advice);
      } catch (e) {
        return errJson(
          c,
          500,
          "unavailable",
          `exposure read failed: ${String(e)}`,
        );
      }
    },
  );

  return app;
}

/** Prod singleton — mounts in registerCoreRoutes. */
export const econLedgerExposureRoutes = createEconLedgerExposureRoutes();
