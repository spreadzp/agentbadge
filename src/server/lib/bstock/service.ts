/**
 * bStock marketplace service registration (EPIC-141, SLICE-141-7).
 *
 * `bstock-delta-realtime` — $5 / 30 days ServicePass, sold via x402.
 * Constants live in config/env/bstock.ts (env is a leaf — this module
 * imports them from there, never the reverse).
 */

import { usdToBaseUnits } from "../marketplace/chain";
import { upsertService } from "../marketplace/catalog";
import {
  BSTOCK_SERVICE_ID,
  BSTOCK_SERVICE_NAME,
  BSTOCK_PASSPORT_ID,
  BSTOCK_PRICE_USD,
  BSTOCK_DURATION_DAYS,
  BSTOCK_DURATION_SEC,
} from "../../../config/env/bstock";

export {
  BSTOCK_SERVICE_ID,
  BSTOCK_SERVICE_NAME,
  BSTOCK_PASSPORT_ID,
  BSTOCK_PRICE_USD,
  BSTOCK_DURATION_DAYS,
  BSTOCK_DURATION_SEC,
};

/** Idempotent catalog upsert — safe to call at server start. */
export function ensureBstockService(): void {
  upsertService({
    serviceId: BSTOCK_SERVICE_ID,
    passportId: BSTOCK_PASSPORT_ID.toString(),
    owner: process.env.X402_PAY_TO ?? "",
    subId: BSTOCK_SERVICE_NAME,
    name: BSTOCK_SERVICE_NAME,
    description:
      "Real-time bStock delta tracker — MCP tools + SSE/WS stream",
    category: "data",
    endpointUrl: "/mcp/bstock",
    priceUsd: BSTOCK_PRICE_USD,
    priceBaseUnits: usdToBaseUnits(BSTOCK_PRICE_USD).toString(),
    durationDays: BSTOCK_DURATION_DAYS,
    durationSec: BSTOCK_DURATION_SEC,
    metaURI: "",
    createdAt: new Date().toISOString(),
  });
}
