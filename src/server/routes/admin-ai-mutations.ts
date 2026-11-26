/**
 * EPIC-232 (SLICE-232-8/232-12): POST mutations for the AI policies
 * console — split from admin-ai-ui.ts (300-line cap).
 *
 * POST /admin/ai/policies/:scenario      → PRG field updates
 * POST /admin/ai/policies/:scenario/kill → per-scenario kill-switch
 *
 * 232-12 hardening: every field is validated BEFORE any write
 * (no half-updated rows), the scenario must be registered (a forged
 * :scenario otherwise mints policy rows the runner registry never
 * consults), strict Number() threshold parse, and supervised
 * requires a calibrated threshold — fail-open prefill refused.
 */

import type { Hono } from "hono";

import { consumeFormToken } from "../lib/knowledge/form-tokens";
import { requirePrincipal } from "../middleware/operatorAuth";
import { rejectCtrl } from "./admin-operator-guard";
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

export const FORM_TOKEN_ERR = "form_expired_or_duplicate";

export const str = (b: Record<string, unknown>, k: string): string =>
  typeof b[k] === "string" ? (b[k] as string).trim() : "";

export const backWith = (flash: { ok?: string; err?: string }): string => {
  const q = new URLSearchParams();
  if (flash.err) q.set("err", flash.err.slice(0, 120));
  else if (flash.ok) q.set("ok", flash.ok.slice(0, 120));
  const qs = q.toString();
  return `/admin/ai${qs ? `?${qs}` : ""}`;
};

/** All known scenario ids = registered sets ∪ rows that exist. */
export const scenarioIds = (rows: AutomationPolicyRecord[]): string[] =>
  [
    ...new Set([
      ...INTAKE_AI_SCENARIOS,
      FEEDBACK_EXTRACT_SCENARIO,
      REVIEW_ASSIST_SCENARIO,
      ...rows.map((r) => r.scenario),
    ]),
  ].sort();

export function registerAdminAiMutations(
  app: Hono,
  aiStore: AiStore,
): void {
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
    const before = await aiStore.getPolicy(scenario);
    // 232-12: the scenario must be a registered one (or an existing
    // row) — a forged :scenario otherwise mints policy rows for
    // names the runner registry never consults.
    if (!before && !scenarioIds([]).includes(scenario)) {
      return c.redirect(backWith({ err: "unknown_scenario" }), 303);
    }

    // 232-12: validate EVERY field before any write — previously the
    // mode was applied first and a bad threshold then refused,
    // leaving a half-updated row.
    const mode = str(b, "mode");
    if (mode && !(AI_MODES as readonly string[]).includes(mode)) {
      return c.redirect(backWith({ err: "bad_mode" }), 303);
    }
    const thRaw = str(b, "confidenceThreshold");
    let th: number | null | undefined; // undefined = field untouched
    if (thRaw !== "") {
      // 232-12: strict parse — parseFloat("0.6junk") silently read
      // 0.6; Number() returns NaN on any trailing garbage.
      th = thRaw === "clear" ? null : Number(thRaw);
      if (th !== null && (!Number.isFinite(th) || th < 0 || th > 1)) {
        return c.redirect(backWith({ err: "bad_threshold" }), 303);
      }
    }
    const modelRaw = str(b, "model");
    const model =
      modelRaw === "" ? undefined : modelRaw === "clear" ? null : modelRaw.slice(0, 64);

    // 232-12 H-5: supervised without a calibrated threshold is a
    // fail-open prefill path — refuse the FINAL state, whichever
    // field(s) the form actually changed.
    const finalMode = mode !== "" ? mode : before?.mode ?? "off";
    const finalTh = th !== undefined ? th : before?.confidenceThreshold ?? null;
    if (finalMode === "supervised" && finalTh === null) {
      return c.redirect(
        backWith({ err: "supervised_requires_threshold" }),
        303,
      );
    }

    const reason = str(b, "reason").slice(0, 200) || undefined;
    if (mode && mode !== before?.mode) {
      await setPolicyMode(aiStore, scenario, mode as AiMode, actor.id, reason);
    }
    if (th !== undefined && th !== (before?.confidenceThreshold ?? null)) {
      await setPolicyThreshold(aiStore, scenario, th, actor.id, reason);
    }
    if (model !== undefined && model !== (before?.model ?? null)) {
      await setPolicyModel(aiStore, scenario, model, actor.id, reason);
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
    // 232-12: same allowlist as the update route — upsert would mint
    // a policy row for an unregistered name.
    if (
      !(await aiStore.getPolicy(scenario)) &&
      !scenarioIds([]).includes(scenario)
    ) {
      return c.redirect(backWith({ err: "unknown_scenario" }), 303);
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
}
