/**
 * SLICE-207-3 (EPIC-207): econ-ledger emitters — projection of existing
 * sources of truth into the append-only EconomicEvent ledger.
 *
 * All emits are fire-and-forget and gated on DATABASE_ENABLED (spec AC):
 * with Postgres off, emitters no-op and the server never crashes.
 */

export {
  econLedgerOrNull,
  emitEconomicEvent,
  emitEconomicBatch,
  isoFromMs,
} from "./emit.js";
export { boardEntryToEconomic, emitBoardEntry } from "./board.js";
export {
  marketStatusToEconomic,
  emitMarketStatus,
  MARKET_SEQ,
  type MarketEventTask,
} from "./market.js";
export { venueJobToEconomic, emitVenueJob, VENUE_SEQ } from "./venue.js";
export { verdictToEconomic, emitEaasVerdict } from "./eaas.js";
export { settleToEconomic, emitX402Settle, type SettleLeg } from "./x402.js";
export { runEconBackfill, type BackfillReport } from "./backfill.js";
