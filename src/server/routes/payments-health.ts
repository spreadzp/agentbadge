/**
 * SLICE-160-2 (EPIC-160): GET /api/payments/health — the single
 * "are payments alive?" ops point.
 *
 * Aggregates: rail health (exact/gateway depend on the facilitator
 * probe; arc is self-settle → configured = healthy), facilitator
 * probe result (in-band cached, one impl in *-probe.ts), gateway
 * transfer lag from the crosschain store, and the 24h failure
 * ledger rollup. Auth: METRICS_BEARER_TOKEN like /metrics (D4-160).
 * Side-effect: refreshes facilitatorUp + gatewayTransfersPending
 * gauges (in-band updates, no background process).
 */

import { Hono } from "hono";
import type { FailureStore } from "@agentbadge/circle-payments";
import { opsBearerAuth } from "../middleware/ops-auth";
import type { CrosschainPaymentsStore } from "../lib/crosschain-payments";
import type { FacilitatorHealth } from "../lib/circle-payments-probe";
import {
  facilitatorUp,
  gatewayTransfersPending,
} from "../metrics/payments";

export type { FacilitatorHealth };

const DAY_MS = 24 * 3600e3;

export interface PaymentsHealthDeps {
  /** Gateway rail advertised (cfg.gateway) */
  gatewayEnabled: boolean;
  /** Arc self-settle rail enabled — configured counts as healthy */
  arcEnabled: boolean;
  /** 156-1 rail probe — static flag or live getter */
  gatewayProbeUp: boolean | (() => boolean);
  /** Crosschain settle-attribution store (gateway pending) */
  crosschainStore?: CrosschainPaymentsStore;
  /** Fulfillment-failure ledger */
  failureStore: FailureStore;
  /** Cached in-band facilitator probe — one impl, see *-probe.ts */
  facilitatorProbe: () => Promise<FacilitatorHealth>;
  /** Gauge label value — default "facilitator", wiring passes host */
  facilitatorTarget?: string;
}

function flag(v: boolean | (() => boolean)): boolean {
  return typeof v === "function" ? v() : v;
}

export function createPaymentsHealthRoutes(deps: PaymentsHealthDeps) {
  const app = new Hono();
  const target = deps.facilitatorTarget ?? "facilitator";

  app.get("/api/payments/health", opsBearerAuth(), async (c) => {
    const facilitator = await deps.facilitatorProbe();
    const facUp = facilitator.status === "up";
    facilitatorUp.set({ target }, facUp ? 1 : 0);

    const pending = deps.crosschainStore?.pending() ?? [];
    gatewayTransfersPending.set(pending.length);
    const settledAts = (deps.crosschainStore?.list() ?? [])
      .map((e) => e.settledAt)
      .filter((t): t is number => typeof t === "number");
    const lastSettleAgeSec =
      settledAts.length > 0
        ? Math.max(0, Math.floor((Date.now() - Math.max(...settledAts)) / 1000))
        : null;

    const entries = await deps.failureStore.list();
    const cutoff = Date.now() - DAY_MS;
    const ats = entries
      .map((f) => (f.at ? Date.parse(f.at) : NaN))
      .filter((t) => !Number.isNaN(t));
    const last24h = ats.filter((t) => t >= cutoff).length;
    const lastFailure =
      ats.length > 0 ? new Date(Math.max(...ats)).toISOString() : null;

    // Rails: exact + gateway both depend on the facilitator; arc is
    // self-settle → configured counts as healthy. Disabled rails
    // report false but never drag `ok` down.
    const rails = {
      exact: facUp,
      gateway: deps.gatewayEnabled ? facUp && flag(deps.gatewayProbeUp) : false,
      arc: deps.arcEnabled,
    };
    const ok =
      rails.exact &&
      (!deps.gatewayEnabled || rails.gateway) &&
      (!deps.arcEnabled || rails.arc);

    return c.json({
      ok,
      rails,
      facilitator,
      gateway: {
        pendingTransfers: pending.length,
        lastSettleAgeSec,
      },
      failures: { last24h, lastFailure },
      time: new Date().toISOString(),
    });
  });

  return app;
}
