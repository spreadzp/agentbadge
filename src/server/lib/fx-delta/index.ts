/**
 * FX-delta runtime registry (EPIC-191, SLICE-191-5, D-191-12).
 *
 * The DeltaEngine lives in the `fxdelta-tracker` package (celo-fx-delta
 * repo) — until it's published as an npm dep, the server holds a
 * structural reference injected at boot (or by tests). Routes degrade
 * to 503 when the runtime is absent.
 */

export interface FxDeltaView {
  corridor: string;
  fiat: string;
  chainRate: number | null;
  fxRefRate: number | null;
  deltaPct: number | null;
  phase: string;
  frozen: boolean;
  stale: boolean;
  thin: boolean;
  inAlert: boolean;
  oracleLagPct: number | null;
  tvlUsd: number;
  lastUpdateMs: number;
}

export interface FxDeltaCorridorMeta {
  symbol: string;
  fiat: string;
  token: string;
  decimals: number;
  uniswapPool?: { fee: number; address: string; quoteSymbol: string };
  tvlUsdApprox?: number;
  thin?: boolean;
  tracks: string[];
}

export interface FxDeltaSourceStatus {
  connected: boolean;
  lastTickMs: number;
}

export interface FxDeltaEvent {
  type: string;
  corridor: string;
  msg?: string;
  atMs: number;
}

export interface FxDeltaRuntime {
  engine: {
    getAll(): FxDeltaView[];
    getView(corridor: string): FxDeltaView | null;
    getHistory(corridor: string): { t: number; deltaPct: number }[];
    getEvents(): FxDeltaEvent[];
  };
  corridors: readonly FxDeltaCorridorMeta[];
  /** Per-leg source health: uniswap / mento / fxRef. */
  sources: () => Record<"uniswap" | "mento" | "fxRef", FxDeltaSourceStatus>;
  startedAtMs: number;
}

let runtime: FxDeltaRuntime | null = null;

export function setFxDeltaRuntime(rt: FxDeltaRuntime): void {
  runtime = rt;
}

export function getFxDeltaRuntime(): FxDeltaRuntime | null {
  return runtime;
}

/** Test hook. */
export function resetFxDeltaRuntime(): void {
  runtime = null;
}

// ─── Arc anchoring (191-9) ──────────────────────────────────────────
// Anchor queue + alert watcher — singletons owned here so both the API
// (/api/fx-delta/verify) and the TG bot (verifyUrl) share state.

import type { AnchorQueue } from "./anchor";

let anchorQueue: AnchorQueue | null = null;

export function setFxDeltaAnchorQueue(q: AnchorQueue): void {
  anchorQueue = q;
}

export function getFxDeltaAnchorQueue(): AnchorQueue | null {
  return anchorQueue;
}

/** Test hook. */
export function resetFxDeltaAnchor(): void {
  anchorQueue?.stop();
  anchorQueue = null;
}

/** Audit a settled payment — fire-and-forget (191-12 placeholder:
 *  events table until the payments schema lands). */
export function auditFxDeltaPayment(payload: {
  txHash: string;
  payer: string;
  amount: string;
  asset: string;
  network: string;
  mode: string;
}): void {
  // Lazy import keeps startup light; a failed write must not block the
  // paid request (same policy as arc-facilitator settle).
  void import("../database")
    .then(({ getDatabase }) =>
      getDatabase().events.create({
        type: "payment",
        source: "fxdelta-celo-x402",
        payload,
      }),
    )
    .catch(() => {});
}
