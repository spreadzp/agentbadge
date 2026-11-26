/**
 * EPIC-232 (SLICE-232-8, spec E8 + D-232-3): AI automation policies
 * console —
 *   GET  /admin/ai                        → per-scenario controls + audit
 *   POST /admin/ai/policies/:scenario     → PRG field updates
 *   POST /admin/ai/policies/:scenario/kill→ per-scenario kill-switch
 *
 * Browser auth: operatorBrowserAuth (opk_ credential) + capability
 * gate — same posture as /admin/review-center. POSTs carry
 * render-minted single-use formTokens; cross-site form posts refused
 * (B-3 lesson). Every mutation writes AutomationPolicy + PolicyChange
 * atomically per field (policies.ts) — the audit stream is
 * append-only; there is intentionally no edit/delete surface.
 *
 * Effective mode shown = resolveEffectiveMode(declared, env kill +
 * budget) — changes take effect on the next worker tick, no redeploy.
 */

import { Hono } from "hono";
import type { Context } from "hono";

import {
  AI_SUBJECT_STREAMS,
  type AiEnvConfig,
} from "../../config/env/ai-types";
import { getConfig } from "../../config/env";
import { capabilityGate } from "../middleware/operator-gate";
import { operatorBrowserAuth } from "../middleware/operatorAuth";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import type { OperatorStore } from "../lib/operators";
import { mintFormToken } from "../lib/knowledge/form-tokens";
import { wrapFragment } from "./ui/helpers";
import {
  resolveEffectiveMode,
  checkBudget,
  utcDayStart,
  type BudgetState,
} from "../lib/ai/budget";
import { AI_MODES } from "../lib/ai/types";
import type { AiMode, AiStore } from "../lib/ai/types";

import type { InteractionStore } from "../lib/request-inbox/interaction-store";
import type { ReviewStore } from "../lib/reviews/store";
import { computeAiMetrics } from "../lib/ai/metrics/projection";

import {
  adminAiPage,
  type AiPolicyRow,
} from "../../views/admin-ai/policies";
import { aiMetricsPage } from "../../views/admin-ai/metrics";
import {
  registerAdminAiMutations,
  scenarioIds,
} from "./admin-ai-mutations";

const page = (c: Context, frag: string | Promise<string>): Response =>
  c.html(
    wrapFragment(c, frag as string, "AI Policies", {
      path: c.req.path,
      title: "Admin AI",
      description: "Admin AI automation policies",
    }),
    200,
    { "Cache-Control": "no-store" },
  );

async function policyRows(
  aiStore: AiStore,
  enabled: boolean,
  budget: BudgetState,
): Promise<AiPolicyRow[]> {
  const policies = await aiStore.listPolicies();
  const byScenario = new Map(policies.map((p) => [p.scenario, p]));
  return scenarioIds(policies).map((scenario) => {
    const p = byScenario.get(scenario);
    const declared = (p?.mode ?? "off") as AiMode;
    return {
      scenario,
      mode: declared,
      confidenceThreshold: p?.confidenceThreshold ?? null,
      model: p?.model ?? null,
      updatedBy: p?.updatedBy ?? null,
      effective: resolveEffectiveMode(declared, {
        enabled,
        budget: budget.state,
      }),
    };
  });
}

export function createAdminAiUi(deps: {
  aiStore: AiStore;
  operatorStore: OperatorStore;
  /** `getConfig().ai` — undefined = master kill engaged (tests pass
   *  a value explicitly). */
  config?: AiEnvConfig;
  /** 232-10 E10: projection joins — absent → metrics page refuses. */
  reviews?: ReviewStore;
  interactions?: InteractionStore;
}): Hono {
  const { aiStore, operatorStore } = deps;
  const cfg = () => deps.config;
  const app = new Hono();
  const guard = [operatorBrowserAuth(operatorStore), capabilityGate()];
  app.use("/admin/ai", ...guard);
  app.use("/admin/ai/*", ...guard);
  app.use("/admin/ai/*", async (c, next) => {
    if (c.req.method !== "POST") return next();
    if (c.req.header("sec-fetch-site") === "cross-site") {
      return errorResponse(
        c, 403, ErrorCodes.UNAUTHORIZED, "cross-site form post refused",
      );
    }
    const origin = c.req.header("origin");
    if (!origin) return next();
    try {
      if (new URL(origin).host === new URL(c.req.url).host) return next();
    } catch {
      /* malformed origin → refuse below */
    }
    return errorResponse(
      c, 403, ErrorCodes.UNAUTHORIZED, "cross-origin form post refused",
    );
  });

  app.get("/admin/ai", async (c) => {
    const config = cfg();
    const budget = await checkBudget(
      aiStore,
      config ?? {
        dailyCallLimit: 0,
        monthlyBudgetUsd: 0,
        usdPer1MTokens: 0,
        shadowReserveCalls: 0,
        subjectDailyCallLimit: 0,
      },
    );
    // Delta-4 N3-M2: per-stream daily usage — a partition hit must
    // be readable on /admin/ai, not inferred from the global meter.
    const dayStart = utcDayStart(new Date());
    const streams = await Promise.all(
      AI_SUBJECT_STREAMS.map(async (type) => ({
        type,
        calls: await aiStore.countProviderCallsSince(dayStart, type),
      })),
    );
    const [rows, changes] = await Promise.all([
      policyRows(aiStore, config !== undefined, budget),
      aiStore.listPolicyChanges({ limit: 100 }),
    ]);
    return page(
      c,
      adminAiPage({
        rows,
        changes,
        enabled: config !== undefined,
        budget,
        streams,
        limits: config
          ? {
              dailyCallLimit: config.dailyCallLimit,
              monthlyBudgetUsd: config.monthlyBudgetUsd,
            }
          : null,
        modes: AI_MODES,
        formToken: mintFormToken(),
        flash: { ok: c.req.query("ok"), err: c.req.query("err") },
      }),
    );
  });

  // 232-10 E10: on-demand §17.3 projection — computed at request
  // time from AiRun + human entities (D-232-6, no metric tables).
  app.get("/admin/ai/metrics", async (c) => {
    if (!deps.reviews || !deps.interactions) {
      return errorResponse(
        c, 503, ErrorCodes.DATA_UNAVAILABLE, "metrics projection unavailable",
      );
    }
    const scenario = c.req.query("scenario")?.trim() || undefined;
    const m = await computeAiMetrics(
      {
        aiStore,
        reviews: deps.reviews,
        interactions: deps.interactions,
      },
      {
        from: c.req.query("from")?.trim() || undefined,
        to: c.req.query("to")?.trim() || undefined,
        scenario,
      },
    );
    return page(
      c,
      aiMetricsPage({
        metrics: m,
        filter: { from: m.window.from ?? "", to: m.window.to ?? "", scenario: scenario ?? "" },
      }),
    );
  });

  registerAdminAiMutations(app, aiStore);

  return app;
}

/** Env default for wiring — config at call time, not import. */
export function wireAdminAiConfig(): AiEnvConfig | undefined {
  return getConfig().ai;
}
