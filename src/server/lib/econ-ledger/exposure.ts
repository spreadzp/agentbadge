/**
 * SLICE-207-6 (D-207-4): advisory exposure scoring — "how much
 * outstanding exposure is reasonable with this counterparty".
 *
 * ADVISORY ONLY: this module computes a recommendation; nothing here
 * blocks, denies, or enforces. Enforcement is a phase-2 decision.
 *
 * Inputs (all derived, never authoritative writes):
 *   - pair edge stats from the AgentTrustEdge projection (count,
 *     lifetime volume, recency) — rebuildable fold of the event log
 *   - forensics verdict on the counterparty (`assessAddress`, 204-5)
 *   - caller wallet spend velocity (SpendLedger, 155-11) — context
 *
 * Honest-by-contract: thin data → dataQuality "insufficient" +
 * recommended_exposure_usd: null (null ≠ 0 — zero is a verdict,
 * null is "we don't know"). Reasons are always explainable.
 *
 * Weights are env-config, never hardcoded (FORENSICS_* precedent).
 */

import type { Database } from "@agentbadge/database";
import { toMicros } from "@agentbadge/database";
import type { RiskVerdict, RiskVerdictKind } from "../forensics/risk-service";

export type ExposureDataQuality = "sufficient" | "insufficient";

export interface ExposureAdvice {
  /** null when dataQuality is "insufficient" — null is honest, 0 is a verdict. */
  recommended_exposure_usd: number | null;
  confidence: number;
  reasons: string[];
  dataQuality: ExposureDataQuality;
}

/** Edge aggregate for the (agent, counterparty) pair. */
export interface PairEdgeStats {
  eventCount: number;
  /** lifetime USD moved across the pair, decimal string. */
  totalUsd: string;
  /** ISO ts of the newest contributing event; null when no edge. */
  lastEventAt: string | null;
  /** distinct kinds seen on the pair. */
  kinds: string[];
}

export interface ExposureWeights {
  baseUsd: number;
  perEventUsd: number;
  historyFactor: number;
  maxUsd: number;
  minEvents: number;
  minVolumeUsd: number;
  halfLifeDays: number;
  confFullEvents: number;
  verdictMul: Record<RiskVerdictKind, number>;
}

const envNum = (key: string, def: number): number => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v >= 0 ? v : def;
};

/** Env-driven weights — every knob is tunable without a redeploy. */
export function exposureWeights(): ExposureWeights {
  return {
    baseUsd: envNum("EXPOSURE_BASE_USD", 10),
    perEventUsd: envNum("EXPOSURE_PER_EVENT_USD", 5),
    historyFactor: envNum("EXPOSURE_HISTORY_FACTOR", 0.25),
    maxUsd: envNum("EXPOSURE_MAX_USD", 500),
    minEvents: envNum("EXPOSURE_MIN_EVENTS", 3),
    minVolumeUsd: envNum("EXPOSURE_MIN_USD_VOLUME", 1),
    halfLifeDays: envNum("EXPOSURE_HALF_LIFE_DAYS", 30),
    confFullEvents: envNum("EXPOSURE_CONF_FULL_EVENTS", 10),
    verdictMul: {
      pass: envNum("EXPOSURE_MUL_PASS", 1),
      caution: envNum("EXPOSURE_MUL_CAUTION", 0.5),
      block: envNum("EXPOSURE_MUL_BLOCK", 0),
      no_data: envNum("EXPOSURE_MUL_NODATA", 0.5),
    },
  };
}

/**
 * Pure scorer — the only place the formula lives (dogfood-calibratable).
 * Returns advice; never a verdict. See module doc for honest-null rule.
 */
export function computeExposure(
  edge: PairEdgeStats,
  verdict: RiskVerdictKind,
  now: Date = new Date(),
  w: ExposureWeights = exposureWeights(),
): ExposureAdvice {
  const totalUsd = Number(toMicros(edge.totalUsd)) / 1e6;
  const reasons: string[] = [];

  // --- data-quality gate (thin-file precedent, D-204-5) -------------
  if (edge.eventCount < w.minEvents || totalUsd < w.minVolumeUsd) {
    reasons.push(
      `insufficient history: ${edge.eventCount} events, ` +
        `$${totalUsd.toFixed(2)} lifetime volume ` +
        `(min ${w.minEvents} events / $${w.minVolumeUsd.toFixed(2)})`,
    );
    return {
      recommended_exposure_usd: null,
      confidence: Math.min(0.2, edge.eventCount / w.confFullEvents),
      reasons,
      dataQuality: "insufficient",
    };
  }

  // --- recency decay -------------------------------------------------
  const daysSinceLast = edge.lastEventAt
    ? Math.max(0, (now.getTime() - Date.parse(edge.lastEventAt)) / 86_400_000)
    : Infinity;
  const recency =
    daysSinceLast === Infinity
      ? 0
      : Math.pow(0.5, daysSinceLast / w.halfLifeDays);

  // --- formula --------------------------------------------------------
  const raw =
    w.baseUsd + edge.eventCount * w.perEventUsd + totalUsd * w.historyFactor;
  const mul = w.verdictMul[verdict];
  const recommended = Math.min(w.maxUsd, raw * recency * mul);

  reasons.push(
    `edge history: ${edge.eventCount} events, $${totalUsd.toFixed(2)} ` +
      `lifetime volume, last activity ${daysSinceLast === Infinity ? "never" : `${daysSinceLast.toFixed(1)}d ago`}`,
  );
  reasons.push(`counterparty forensics verdict: ${verdict}`);
  if (edge.kinds.length) {
    reasons.push(`activity mix: ${edge.kinds.sort().join(", ")}`);
  }

  const confidence = Math.min(
    1,
    edge.eventCount / w.confFullEvents,
  ) * recency;

  return {
    recommended_exposure_usd: Math.round(recommended * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    reasons,
    dataQuality: "sufficient",
  };
}

export interface AssessExposureDeps {
  db: Database;
  /** forensics verdict for the counterparty; caller may omit when the
   *  forensics index is disabled — treated as no_data multiplier. */
  assess?: (counterparty: string) => Promise<RiskVerdict>;
}

/**
 * Orchestrator: gather pair edge stats + counterparty forensics +
 * wallet spend velocity context, then score. All reads; zero writes.
 */
export async function assessExposure(
  agent: string,
  counterparty: string,
  deps: AssessExposureDeps,
): Promise<ExposureAdvice> {
  const agentAddr = agent.toLowerCase();
  const otherAddr = counterparty.toLowerCase();

  // pair edges in both directions → one aggregate
  const rows = await deps.db.trustEdges.listPair(agentAddr, otherAddr);
  const kinds = new Set<string>();
  let eventCount = 0;
  let micros = 0n;
  let lastEventAt: string | null = null;
  for (const r of rows) {
    eventCount += r.eventCount;
    micros += toMicros(r.totalUsd);
    kinds.add(r.kind);
    if (lastEventAt === null || r.lastEventAt > lastEventAt) {
      lastEventAt = r.lastEventAt;
    }
  }
  const edge: PairEdgeStats = {
    eventCount,
    totalUsd: (Number(micros) / 1e6).toString(),
    lastEventAt,
    kinds: [...kinds],
  };

  const verdict: RiskVerdictKind = deps.assess
    ? (await deps.assess(otherAddr).catch(() => null))?.verdict ?? "no_data"
    : "no_data";

  const advice = computeExposure(edge, verdict);

  // spend-velocity context — a reason, not a scoring term (v1)
  if (deps.db.db !== null && deps.db.spendLedger) {
    try {
      const usd30d = await deps.db.spendLedger.sumByWalletInWindow(
        agentAddr,
        Date.now() - 30 * 86_400_000,
      );
      if (usd30d > 0) {
        advice.reasons.push(
          `wallet spend velocity: $${usd30d.toFixed(2)} in last 30d`,
        );
      }
    } catch {
      /* context only — never fail the answer on it */
    }
  }
  if (!deps.assess) {
    advice.reasons.push("forensics index unavailable — verdict treated as no_data");
  }
  return advice;
}
