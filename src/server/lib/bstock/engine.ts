/**
 * DeltaEngine process singleton (EPIC-141, SLICE-141-6).
 *
 * Lazily created on first use; injected into bstock MCP tools at
 * namespace wiring time. Feed startup (Binance WS, Finnhub/Alpaca)
 * attaches here in later slices — the engine itself is pure in-memory.
 */

import { DeltaEngine } from "@agentbadge/bstock-tracker";
import type { BstockEngineLike } from "@agentbadge/mcp";

let engine: DeltaEngine | null = null;

export function getBstockEngine(): BstockEngineLike {
  if (!engine) {
    engine = new DeltaEngine();
  }
  return engine;
}

/** Test hook — drop the singleton between tests. */
export function resetBstockEngine(): void {
  engine = null;
}
