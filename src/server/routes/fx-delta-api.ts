/**
 * FX-delta free-tier API (EPIC-191, SLICE-191-5, D-191-8/12).
 *
 *   GET /api/fx-delta/corridors      — corridor metadata (free)
 *   GET /api/fx-delta/snapshot       — DeltaView[] (1 req/min → 402)
 *   GET /api/fx-delta/:corridor      — single corridor + oracleLagPct
 *   GET /api/fx-delta/health         — engine + per-source status
 *
 * Free tier = 1 req/min per identity (X-Wallet → IP) on snapshot/:corridor;
 * over-limit → 402 PAYMENT_REQUIRED pointing at the premium x402 gate
 * (wired in 191-6). Engine is injected via lib/fx-delta registry —
 * absent runtime → 503.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { Context, Next } from "hono";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import {
  getFxDeltaRuntime,
  type FxDeltaView,
} from "../lib/fx-delta";

const FREE_WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

/** Test hook — clears free-tier buckets. */
export function resetFxDeltaFreeTier(): void {
  buckets.clear();
}

function identity(c: Context): string {
  return (
    c.req.header("x-wallet") ??
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "anonymous"
  );
}

/** Free-tier gate: 1 req/min per identity → 402 with premium link. */
function freeTierGate(c: Context, next: Next) {
  const key = identity(c);
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + FREE_WINDOW_MS };
    buckets.set(key, b);
  }
  if (++b.count > 1) {
    return c.json(
      {
        code: ErrorCodes.PAYMENT_REQUIRED,
        error: "Free tier: 1 req/min. Upgrade for real-time access.",
        premium: "/api/fx-delta/premium/snapshot",
        pricing: { amount: "0.005", currency: "USDC", network: "eip155:42220" },
      },
      402,
    );
  }
  return next();
}

function viewJson(v: FxDeltaView) {
  return {
    corridor: v.corridor,
    onchainPrice: v.chainRate,
    fxRef: v.fxRefRate,
    deltaPct: v.deltaPct,
    phase: v.phase,
    frozen: v.frozen,
    thin: v.thin,
    stale: v.stale,
    inAlert: v.inAlert,
    oracleLagPct: v.oracleLagPct,
    tvlUsd: v.tvlUsd,
    tsMs: v.lastUpdateMs,
  };
}

export const fxDeltaRoutes = new Hono();

// ─── GET /api/fx-delta/health ─────────────────────────────────
fxDeltaRoutes.get(
  "/api/fx-delta/health",
  describeRoute({
    tags: ["FX Delta"],
    summary: "Engine + per-source health (uniswap/mento/fxRef)",
    responses: { 200: { description: "Health status" } },
  }),
  (c) => {
    const rt = getFxDeltaRuntime();
    if (!rt) {
      return c.json({ status: "degraded", engine: "not started" });
    }
    const now = Date.now();
    const sources = rt.sources();
    const ages = Object.fromEntries(
      Object.entries(sources).map(([k, s]) => [
        k,
        s.lastTickMs > 0 ? Math.round((now - s.lastTickMs) / 1000) : null,
      ]),
    );
    return c.json({
      status: "ok",
      uptimeSec: Math.round((now - rt.startedAtMs) / 1000),
      corridors: rt.corridors.length,
      sources: Object.fromEntries(
        Object.entries(sources).map(([k, s]) => [
          k,
          { connected: s.connected, ageSec: ages[k] },
        ]),
      ),
    });
  },
);

// ─── GET /api/fx-delta/corridors — metadata (free) ────────────
fxDeltaRoutes.get(
  "/api/fx-delta/corridors",
  describeRoute({
    tags: ["FX Delta"],
    summary: "Corridor registry metadata",
    responses: { 200: { description: "Corridor list" } },
  }),
  (c) => {
    const rt = getFxDeltaRuntime();
    c.header("Cache-Control", "public, max-age=300");
    if (!rt) {
      return errorResponse(c, 503, ErrorCodes.INTERNAL_ERROR, "engine not started");
    }
    return c.json({
      v: 1,
      corridors: rt.corridors.map((m) => ({
        symbol: m.symbol,
        fiat: m.fiat,
        token: m.token,
        decimals: m.decimals,
        uniswapPool: m.uniswapPool ?? null,
        tvlUsdApprox: m.tvlUsdApprox ?? null,
        thin: m.thin === true,
        tracks: m.tracks,
      })),
    });
  },
);

// ─── GET /api/fx-delta/snapshot — all deltas (1 req/min) ──────
fxDeltaRoutes.get(
  "/api/fx-delta/snapshot",
  describeRoute({
    tags: ["FX Delta"],
    summary: "All corridor delta views",
    description:
      "Free tier: 1 req/min per identity. Over limit → 402 (x402 premium gate in 191-6).",
    responses: {
      200: { description: "Snapshot" },
      402: { description: "Payment required — free tier exceeded" },
      503: { description: "Engine not started" },
    },
  }),
  freeTierGate,
  (c) => {
    const rt = getFxDeltaRuntime();
    if (!rt) {
      return errorResponse(c, 503, ErrorCodes.INTERNAL_ERROR, "engine not started");
    }
    c.header("Cache-Control", "public, max-age=5");
    const snap = rt.engine.getAll();
    return c.json({
      v: 1,
      corridors: snap.map(viewJson),
      events: rt.engine.getEvents().slice(-50),
      atMs: Date.now(),
    });
  },
);

// ─── GET /api/fx-delta/:corridor — single (1 req/min) ─────────
fxDeltaRoutes.get(
  "/api/fx-delta/:corridor",
  describeRoute({
    tags: ["FX Delta"],
    summary: "Single corridor delta view + oracleLagPct",
    responses: {
      200: { description: "Corridor view" },
      402: { description: "Payment required" },
      404: { description: "Unknown corridor" },
      503: { description: "Engine not started" },
    },
  }),
  freeTierGate,
  (c) => {
    const rt = getFxDeltaRuntime();
    if (!rt) {
      return errorResponse(c, 503, ErrorCodes.INTERNAL_ERROR, "engine not started");
    }
    const view = rt.engine.getView(c.req.param("corridor"));
    if (!view) {
      return errorResponse(
        c,
        404,
        ErrorCodes.RESOURCE_NOT_FOUND,
        "Unknown corridor",
      );
    }
    c.header("Cache-Control", "public, max-age=5");
    return c.json({
      ...viewJson(view),
      history: rt.engine.getHistory(view.corridor).slice(-60),
    });
  },
);
