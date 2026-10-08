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

import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import {
  getFxDeltaRuntime,
  getFxDeltaAnchorQueue,
  type FxDeltaView,
} from "../lib/fx-delta";
import { fxDeltaPremiumGate } from "../lib/fx-delta/premium-gate";
import { freeTierGate } from "../lib/fx-delta/free-tier";

// Test-compat re-export (moved to lib/fx-delta/free-tier.ts, file cap).
export { resetFxDeltaFreeTier } from "../lib/fx-delta/free-tier";

// Premium gate (191-6) in premium-gate.ts; free tier (191-5) in
// lib/fx-delta/free-tier.ts.

function viewJson(v: FxDeltaView) {
  const anchor = getFxDeltaAnchorQueue()?.latestFor(v.corridor);
  const base = process.env.FXDELTA_PUBLIC_URL ?? "http://localhost:4021";
  return {
    corridor: v.corridor,
    // 191-9: proof link — buyers can verify the alert hash on Arc.
    ...(anchor?.txHash
      ? {
          verifyUrl: `${base}/api/fx-delta/verify/${anchor.id}`,
          anchorTx: anchor.txHash,
        }
      : anchor
        ? { verifyUrl: `${base}/api/fx-delta/verify/${anchor.id}` }
        : {}),
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

// GET /api/fx-delta/verify/:id lives in fx-delta-verify.ts (191-9,
// file cap). Mounted via routes/index.ts.

// ─── GET /api/fx-delta/premium — full snapshot, paid (191-6) ──
fxDeltaRoutes.get(
  "/api/fx-delta/premium",
  describeRoute({
    tags: ["FX Delta"],
    summary: "Premium snapshot — all corridors, no rate cap (x402)",
    description:
      "Pays FXDELTA_PRICE_USD per request in USDC/USDT on Celo. " +
      "Self-settle: our tagged tx submits transferWithAuthorization (D-191-1).",
    responses: {
      200: { description: "Full snapshot" },
      402: { description: "Payment required" },
      503: { description: "Engine or premium rail not configured" },
    },
  }),
  fxDeltaPremiumGate(),
  (c) => {
    const rt = getFxDeltaRuntime();
    if (!rt) {
      return errorResponse(c, 503, ErrorCodes.INTERNAL_ERROR, "engine not started");
    }
    const snap = rt.engine.getAll();
    return c.json({
      v: 1,
      corridors: snap.map(viewJson),
      events: rt.engine.getEvents().slice(-200),
      history: Object.fromEntries(
        snap.map((v) => [v.corridor, rt.engine.getHistory(v.corridor)]),
      ),
      atMs: Date.now(),
    });
  },
);

// ─── GET /api/fx-delta/stream — SSE live ticks, paid (191-6) ──
fxDeltaRoutes.get(
  "/api/fx-delta/stream",
  describeRoute({
    tags: ["FX Delta"],
    summary: "Premium SSE stream — live delta ticks (x402)",
    responses: {
      200: { description: "text/event-stream" },
      402: { description: "Payment required" },
      503: { description: "Engine or premium rail not configured" },
    },
  }),
  fxDeltaPremiumGate(),
  (c) => {
    const rt = getFxDeltaRuntime();
    if (!rt) {
      return errorResponse(c, 503, ErrorCodes.INTERNAL_ERROR, "engine not started");
    }
    const intervalMs = Number(process.env.CELO_POLL_MS ?? 5000);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const push = () => {
          const views = rt.engine.getAll().map(viewJson);
          const frame = `data: ${JSON.stringify({ corridors: views, atMs: Date.now() })}\n\n`;
          controller.enqueue(encoder.encode(frame));
        };
        push();
        const timer = setInterval(push, Math.max(intervalMs, 1000));
        c.req.raw.signal.addEventListener("abort", () => {
          clearInterval(timer);
          controller.close();
        });
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
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
