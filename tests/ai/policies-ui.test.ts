/**
 * SLICE-232-8 (E8, D-232-3): /admin/ai policies console —
 * per-scenario controls render behind operator auth; updates write
 * AutomationPolicy + PolicyChange atomically; kill-switch → off;
 * audit view shows actor/reason incl. budget-guard entries; effective
 * mode reflects env kill + budget state.
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";

import type { AiEnvConfig } from "../../src/config/env/ai-types";
import { createAdminAiUi } from "../../src/server/routes/admin-ai-ui";
import { resolveEffectiveMode } from "../../src/server/lib/ai/budget";
import { InMemoryAiStore } from "../../src/server/lib/ai/store-memory";
import { AI_MODES } from "../../src/server/lib/ai/types";
import {
  createMemoryOperatorStore,
  seedOperator,
} from "../helpers/operators";

const CFG: AiEnvConfig = {
  enabled: true,
  baseUrl: "https://llm.test",
  apiKey: "k",
  model: "m-1",
  dailyCallLimit: 0,
  monthlyBudgetUsd: 0,
  usdPer1MTokens: 1,
  shadowReserveCalls: 0,
  timeoutMs: 5_000,
  retryOnce: false,
  workerEnabled: false,
  workerIntervalMs: 5_000,
  jobLeaseMs: 60_000,
  jobMaxAttempts: 1,
};

const FORM = "application/x-www-form-urlencoded";
let ai: InMemoryAiStore;
let basic = "";
let operatorId = "";

const mkApp = async () => {
  ai = new InMemoryAiStore();
  const opStore = createMemoryOperatorStore();
  const s = await seedOperator(opStore, "Ops");
  basic = `Basic ${Buffer.from(`ops:${s.key}`).toString("base64")}`;
  operatorId = s.operatorId;
  const app = new Hono();
  app.route(
    "/",
    createAdminAiUi({ aiStore: ai, operatorStore: opStore, config: CFG }),
  );
  return app;
};

const getToken = async (app: Hono): Promise<string> => {
  const r = await app.request("/admin/ai", {
    headers: { authorization: basic },
  });
  const m = (await r.text()).match(/name="formToken" value="([^"]+)"/);
  return m![1]!;
};

const post = (app: Hono, path: string, body: URLSearchParams) =>
  app.request(path, {
    method: "POST",
    headers: { authorization: basic, "content-type": FORM },
    body,
  });

beforeEach(() => {});

describe("/admin/ai policies console", () => {
  it("GET renders per-scenario controls behind auth (401 without)", async () => {
    const app = await mkApp();
    expect((await app.request("/admin/ai")).status).toBe(401);
    const r = await app.request("/admin/ai", {
      headers: { authorization: basic },
    });
    expect(r.status).toBe(200);
    const html = await r.text();
    for (const s of ["classification", "feedback_extract", "review_assist"]) {
      expect(html).toContain(s);
    }
    expect(html).toContain("name=\"mode\"");
    expect(html).toContain("name=\"confidenceThreshold\"");
    expect(html).toContain("AI_AUTOMATION_ENABLED");
  });

  it("POST updates mode + threshold atomically with PolicyChange rows", async () => {
    const app = await mkApp();
    const t = await getToken(app);
    const r = await post(app, "/admin/ai/policies/classification",
      new URLSearchParams({
        formToken: t,
        mode: "assist",
        confidenceThreshold: "0.75",
        model: "m-custom",
        reason: "rollout",
      }));
    expect(r.status).toBe(303);
    const p = (await ai.getPolicy("classification"))!;
    expect(p.mode).toBe("assist");
    expect(p.confidenceThreshold).toBe(0.75);
    expect(p.model).toBe("m-custom");
    const changes = await ai.listPolicyChanges({ scenario: "classification" });
    const fields = changes.map((ch) => ch.field).sort();
    expect(fields).toEqual(["confidenceThreshold", "mode", "model"]);
    for (const ch of changes) {
      expect(ch.actor).toBe(operatorId);
      expect(ch.reason).toBe("rollout");
    }
  });

  it("kill-switch sets mode off — next worker tick reads off", async () => {
    const app = await mkApp();
    await ai.upsertPolicy("review_assist", {
      mode: "supervised",
      updatedBy: "seed",
    });
    const r = await post(
      app,
      "/admin/ai/policies/review_assist/kill",
      new URLSearchParams({ formToken: await getToken(app), reason: "bad outputs" }),
    );
    expect(r.status).toBe(303);
    expect((await ai.getPolicy("review_assist"))!.mode).toBe("off");
    const ch = (await ai.listPolicyChanges({ scenario: "review_assist" }))[0]!;
    expect(ch.field).toBe("mode");
    expect(ch.newValue).toBe("off");
    expect(ch.reason).toBe("bad outputs");
  });

  it("audit view renders budget-guard degradation entries", async () => {
    const app = await mkApp();
    await ai.appendPolicyChange({
      scenario: "summary",
      field: "mode",
      oldValue: "assist",
      newValue: "off",
      actor: "budget-guard",
      reason: "budget_exhausted: 500/500 calls",
    });
    const r = await app.request("/admin/ai", {
      headers: { authorization: basic },
    });
    const html = await r.text();
    expect(html).toContain("budget-guard");
    expect(html).toContain("budget_exhausted");
    expect(html).toContain("assist → off");
  });

  it("rejects bad mode / threshold / ctrl-chars / replayed token", async () => {
    const app = await mkApp();
    const t = await getToken(app);
    const bad = await post(app, "/admin/ai/policies/classification",
      new URLSearchParams({ formToken: t, mode: "auto" }));
    expect(bad.status).toBe(303);
    expect(bad.headers.get("location")).toContain("bad_mode");
    // token was consumed by the failed post — replay refused
    const replay = await post(app, "/admin/ai/policies/classification",
      new URLSearchParams({ formToken: t, mode: "assist" }));
    expect(replay.headers.get("location")).toContain("form_expired");
    const t2 = await getToken(app);
    const bt = await post(app, "/admin/ai/policies/classification",
      new URLSearchParams({ formToken: t2, confidenceThreshold: "9" }));
    expect(bt.headers.get("location")).toContain("bad_threshold");
  });
});

describe("resolveEffectiveMode — env + budget gates", () => {
  it.each(
    AI_MODES.map((m) => [m]),
  )("declared %s folds to off when master kill engaged", (m) => {
    expect(resolveEffectiveMode(m!, { enabled: false, budget: "ok" })).toBe("off");
  });
  it("exhausted → everything off; shadow_cut folds shadow only", () => {
    expect(resolveEffectiveMode("assist", { enabled: true, budget: "exhausted" })).toBe("off");
    expect(resolveEffectiveMode("shadow", { enabled: true, budget: "shadow_cut" })).toBe("off");
    expect(resolveEffectiveMode("supervised", { enabled: true, budget: "shadow_cut" })).toBe("supervised");
    expect(resolveEffectiveMode("assist", { enabled: true, budget: "ok" })).toBe("assist");
  });
});
