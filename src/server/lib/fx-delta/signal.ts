/**
 * Derived trade signal (D-191-demo): the agent-readable answer to
 * "where do I buy, what do I sell". Pure function of DeltaView —
 * no engine changes.
 *
 * delta > 0 → local stable trades ABOVE official FX → sell it onchain.
 * delta < 0 → trades BELOW official FX → buy it onchain.
 * `executable` = non-thin + fresh + FX market open (thin/stale/frozen
 * corridors are reported but flagged non-executable).
 */

import type { FxDeltaView } from ".";

export const SIGNAL_MIN_EDGE_PCT = 0.5;

export function signalJson(v: FxDeltaView) {
  if (v.deltaPct === null || v.chainRate === null) {
    return {
      action: "no_data" as const,
      side: null,
      edgePct: null,
      executable: false,
    };
  }
  const side = v.deltaPct > 0 ? ("sell" as const) : ("buy" as const);
  const edgePct = Math.abs(v.deltaPct);
  const executable =
    edgePct >= SIGNAL_MIN_EDGE_PCT &&
    !v.thin &&
    !v.stale &&
    !v.frozen &&
    v.phase === "open";
  const action = !executable
    ? ("watch" as const)
    : side === "sell"
      ? ("sell_stable_onchain" as const)
      : ("buy_stable_onchain" as const);
  const text = !executable
    ? edgePct >= SIGNAL_MIN_EDGE_PCT
      ? `${side} ${v.corridor} blocked: ${v.thin ? "thin liquidity" : v.stale ? "stale feed" : v.frozen || v.phase !== "open" ? "FX closed" : "edge"}`
      : "no edge"
    : side === "sell"
      ? `Sell ${v.corridor} onchain for USD stable — trades ${edgePct.toFixed(2)}% above official ${v.fiat} rate`
      : `Buy ${v.corridor} onchain with USD stable — trades ${edgePct.toFixed(2)}% below official ${v.fiat} rate`;
  return { action, side, edgePct, executable, text };
}
