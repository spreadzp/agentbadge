/**
 * SLICE-206-10 (EPIC-206): OpenAPI x-examples + onboarding extension.
 *
 * Contracts:
 * - openApiConfig carries x-agent-badge-onboarding with the ordered
 *   register → discover → pay/earn steps (mirrors llms.txt funnel).
 * - describeRoute'd write operations keep x-examples through
 *   generateSpecs — codegen/scraper tools can see real body shapes.
 * - Examples match the real request contract (register: name/endpoint;
 *   board claim: payoutWallet/claimSig/sigExpiresAt; submit:
 *   deliverableHash).
 */

import { describe, it, expect } from "vitest";
import { Hono, type Context } from "hono";
import { isAddress } from "viem";
import { describeRoute, generateSpecs } from "hono-openapi";
import { openApiConfig } from "../src/server/openapi";
import {
  BOARD_CLAIM_X_EXAMPLES,
  BOARD_SUBMIT_X_EXAMPLES,
  WORK_REQUEST_X_EXAMPLES,
  EAAS_EVALUATE_X_EXAMPLES,
  TASK_BID_X_EXAMPLES,
  TASK_AWARD_X_EXAMPLES,
  TASK_DELIVERABLE_X_EXAMPLES,
  TASK_VERDICT_X_EXAMPLES,
} from "../src/server/routes/openapi-examples";
import {
  awardBodySchema,
  bidBodySchema,
  deliverableBodySchema,
} from "../src/server/lib/tasks/bids";
import { verdictBodySchema } from "../src/server/lib/tasks/verdict";
import { REGISTER_X_EXAMPLES } from "../src/server/routes/agents-register-examples";
import { workRequestRoutes } from "../src/server/routes/api/work-requests";
import { validateEvaluate } from "../src/server/lib/eaas/eval-request";

describe("openApiConfig — x-agent-badge-onboarding", () => {
  const ob = (
    openApiConfig as Record<string, unknown>
  )["x-agent-badge-onboarding"] as {
    guide: string;
    pricing: string;
    services: string;
    steps: Array<{ n: number | string; goal: string; path: string }>;
  };

  it("exists with guide + pricing + services pointers", () => {
    expect(ob).toBeDefined();
    expect(ob.guide).toBe("/agent-guide/getting-started");
    expect(ob.pricing).toBe("/pricing.json");
    expect(ob.services).toBe("/api/v1/services");
  });

  it("covers the register → discover → work funnel", () => {
    const goals = ob.steps.map((s) => s.goal);
    expect(goals).toContain("register");
    expect(goals).toContain("discover_prices");
    expect(goals).toContain("first_paid_call");
    expect(goals).toContain("earn");
    const paths = ob.steps.map((s) => s.path);
    expect(paths).toContain("/api/v1/agents/register");
    expect(paths).toContain("/api/v1/services");
  });

  it("covers the agent-native task contour (206-6)", () => {
    const goals = ob.steps.map((s) => s.goal);
    expect(goals).toContain("earn_task_contour");
    const step = ob.steps.find((s) => s.goal === "earn_task_contour");
    expect(step?.path).toBe("/api/tasks/{taskId}/bids");
  });
});

describe("x-examples survive generateSpecs", () => {
  function miniApp() {
    const app = new Hono();
    app.post(
      "/api/v1/agents/register",
      describeRoute({
        description: "register",
        responses: { 201: { description: "created" } },
        "x-examples": {
          request: { name: "my-agent", endpoint: "https://agent.example.com" },
        },
      } as Parameters<typeof describeRoute>[0]),
      (c) => c.json({ agent_id: "x" }, 201),
    );
    return app;
  }

  it("spec operation carries the extension verbatim", async () => {
    const spec = await generateSpecs(miniApp());
    const op = spec.paths?.["/api/v1/agents/register"]?.post as Record<
      string,
      unknown
    >;
    expect(op).toBeDefined();
    const ex = op["x-examples"] as { request: { name: string } };
    expect(ex).toBeDefined();
    expect(ex.request.name).toBe("my-agent");
  });
});

describe("x-examples drift-check — examples pass real validators", () => {
  it("work-request example gets a real 202 from the mounted route", async () => {
    const res = await workRequestRoutes.fetch(
      new Request("http://t/api/work-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(WORK_REQUEST_X_EXAMPLES.request),
      }),
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { request_id: string };
    expect(body.request_id).toMatch(/^wr-/);
  });

  it("real spec for POST /api/work-requests carries x-examples", async () => {
    const app = new Hono();
    app.route("/", workRequestRoutes);
    const spec = await generateSpecs(app);
    const op = spec.paths?.["/api/work-requests"]?.post as Record<
      string,
      unknown
    >;
    const ex = op?.["x-examples"] as typeof WORK_REQUEST_X_EXAMPLES;
    expect(ex).toBeDefined();
    expect(ex.request.request.title).toBe(
      WORK_REQUEST_X_EXAMPLES.request.request.title,
    );
  });

  it("eaas evaluate example passes validateEvaluate", () => {
    // Minimal Context stub — bad() only calls c.json.
    const stub = {
      json: (b: unknown, s?: number) =>
        new Response(JSON.stringify(b), { status: s ?? 200 }),
    } as unknown as Context;
    const parsed = validateEvaluate(
      EAAS_EVALUATE_X_EXAMPLES.request,
      stub,
    );
    expect(parsed instanceof Response).toBe(false);
  });

  it("board claim example carries the real contract fields", () => {
    const req = BOARD_CLAIM_X_EXAMPLES.request;
    expect(Object.keys(req).sort()).toEqual(
      ["claimSig", "payoutWallet", "sigExpiresAt"].sort(),
    );
    expect(isAddress(req.payoutWallet)).toBe(true);
    expect(req.claimSig).toMatch(/^0x/);
    expect(typeof req.sigExpiresAt).toBe("number");
  });

  it("board submit example carries the real contract fields", () => {
    const req = BOARD_SUBMIT_X_EXAMPLES.request;
    expect(req.deliverableHash).toMatch(/^0x/);
    expect(Object.keys(req)).toEqual(
      expect.arrayContaining(["deliverableHash"]),
    );
  });

  it("task-contour examples pass the real body schemas (206-6)", () => {
    expect(bidBodySchema.safeParse(TASK_BID_X_EXAMPLES.request).success)
      .toBe(true);
    expect(awardBodySchema.safeParse(TASK_AWARD_X_EXAMPLES.request).success)
      .toBe(true);
    expect(
      deliverableBodySchema.safeParse(TASK_DELIVERABLE_X_EXAMPLES.request)
        .success,
    ).toBe(true);
    expect(
      verdictBodySchema.safeParse(TASK_VERDICT_X_EXAMPLES.request).success,
    ).toBe(true);
  });

  it("register examples carry the real contract fields", () => {
    const req = REGISTER_X_EXAMPLES.request;
    expect(Object.keys(req).sort()).toEqual(["endpoint", "name"].sort());
    const sp = REGISTER_X_EXAMPLES.sponsoredRequest;
    expect(isAddress(sp.owner)).toBe(true);
    expect(Object.keys(sp).sort()).toEqual(
      ["expiresAt", "name", "owner", "signature"].sort(),
    );
  });
});
