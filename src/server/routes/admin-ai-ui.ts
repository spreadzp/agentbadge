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

import type { AiEnvConfig } from "../../config/env/ai-types";
import { getConfig } from "../../config/env";
import { capabilityGate } from "../middleware/operator-gate";
import {
  operatorBrowserAuth,
  requirePrincipal,
} from "../middleware/operatorAuth";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import type { OperatorStore } from "../lib/operators";
import {
  consumeFormToken,
  mintFormToken,
} from "../lib/knowledge/form-tokens";
import { wrapFragment } from "./ui/helpers";
import { rejectCtrl } from "./admin-operator-guard";

import {
  resolveEffectiveMode,
  checkBudget,
  type BudgetState,
} from "../lib/ai/budget";
import { FEEDBACK_EXTRACT_SCENARIO } from "../lib/ai/feedback-runner";
import { INTAKE_AI_SCENARIOS } from "../lib/ai/intake";
import {
  setPolicyMode,
  setPolicyModel,
  setPolicyThreshold,
} from "../lib/ai/policies";
import { REVIEW_ASSIST_SCENARIO } from "../lib/ai/review-runner";
import { AI_MODES } from "../lib/ai/types";
import type {
  AiMode,
  AiStore,
  AutomationPolicyRecord,
} from "../lib/ai/types";

import type { InteractionStore } from "../lib/request-inbox/interaction-store";
import type { ReviewStore } from "../lib/reviews/store";
import { computeAiMetrics } from "../lib/ai/metrics/projection";

import {
  adminAiPage,
  type AiPolicyRow,
} from "../../views/admin-ai/policies";
import { aiMetricsPage } from "../../views/admin-ai/metrics";

const FORM_TOKEN_ERR = "form_expired_or_duplicate";
const str = (b: Record<string, unknown>, k: string): string =>
  typeof b[k] === "string" ? (b[k] as string).trim() : "";

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

const backWith = (flash: { ok?: string; err?: string }): string => {
  const q = new URLSearchParams();
  if (flash.err) q.set("err", flash.err.slice(0, 120));
  else if (flash.ok) q.set("ok", flash.ok.slice(0, 120));
  const qs = q.toString();
  return `/admin/ai${qs ? `?${qs}` : ""}`;
};

/** All known scenario ids = registered sets ∪ rows that exist. */
const scenarioIds = (rows: AutomationPolicyRecord[]): string[] =>
  [
    ...new Set([
      ...INTAKE_AI_SCENARIOS,
      FEEDBACK_EXTRACT_SCENARIO,
      REVIEW_ASSIST_SCENARIO,
      ...rows.map((r) => r.scenario),
    ]),
  ].sort();

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
      },
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

  app.post("/admin/ai/policies/:scenario", async (c) => {
    const actor = requirePrincipal(c);
    if (actor instanceof Response) return actor;
    const scenario = c.req.param("scenario") ?? "";
    const b = await c.req.parseBody();
    const bad = rejectCtrl(c, scenario, str(b, "mode"), str(b, "reason"));
    if (bad) return bad;
    if (!consumeFormToken(str(b, "formToken"))) {
      return c.redirect(backWith({ err: FORM_TOKEN_ERR }), 303);
    }
    const reason = str(b, "reason").slice(0, 200) || undefined;
    const before = await aiStore.getPolicy(scenario);

    const mode = str(b, "mode");
    if (mode && mode !== before?.mode) {
      if (!(AI_MODES as readonly string[]).includes(mode)) {
        return c.redirect(backWith({ err: "bad_mode" }), 303);
      }
      await setPolicyMode(aiStore, scenario, mode as AiMode, actor.id, reason);
    }
    const thRaw = str(b, "confidenceThreshold");
    if (thRaw !== "") {
      const th =
        thRaw === "clear" ? null : Number.parseFloat(thRaw);
      if (th !== null && (!Number.isFinite(th) || th < 0 || th > 1)) {
        return c.redirect(backWith({ err: "bad_threshold" }), 303);
      }
      if (th !== (before?.confidenceThreshold ?? null)) {
        await setPolicyThreshold(aiStore, scenario, th, actor.id, reason);
      }
    }
    const modelRaw = str(b, "model");
    if (modelRaw !== "") {
      const model = modelRaw === "clear" ? null : modelRaw.slice(0, 64);
      if (model !== (before?.model ?? null)) {
        await setPolicyModel(aiStore, scenario, model, actor.id, reason);
      }
    }
    return c.redirect(backWith({ ok: `updated_${scenario}` }), 303);
  });

  app.post("/admin/ai/policies/:scenario/kill", async (c) => {
    const actor = requirePrincipal(c);
    if (actor instanceof Response) return actor;
    const scenario = c.req.param("scenario") ?? "";
    const b = await c.req.parseBody();
    const bad = rejectCtrl(c, scenario, str(b, "reason"));
    if (bad) return bad;
    if (!consumeFormToken(str(b, "formToken"))) {
      return c.redirect(backWith({ err: FORM_TOKEN_ERR }), 303);
    }
    await setPolicyMode(
      aiStore,
      scenario,
      "off",
      actor.id,
      str(b, "reason").slice(0, 200) || "kill-switch",
    );
    return c.redirect(backWith({ ok: `killed_${scenario}` }), 303);
  });

  return app;
}

/** Env default for wiring — config at call time, not import. */
export function wireAdminAiConfig(): AiEnvConfig | undefined {
  return getConfig().ai;
}
