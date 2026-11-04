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
import { Hono } from "hono";
import { describeRoute, generateSpecs } from "hono-openapi";
import { openApiConfig } from "../src/server/openapi";

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
