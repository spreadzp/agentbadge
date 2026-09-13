import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRuntimeTargetServer } from "../../fixtures/runtime-target-server";
import { runTasks } from "../../../src/agent-readiness/runtime/executor";
import { RT01_DISCOVER } from "../../../src/agent-readiness/runtime/tasks/rt01-discover";
import { RT05_CALL } from "../../../src/agent-readiness/runtime/tasks/rt05-call";

/**
 * SLICE-98-9: Safety sweep — read-only proof, budget caps, redaction.
 *
 * Verifies that runtime tests:
 * 1. Only make GET requests (no mutating routes called)
 * 2. Budget caps are enforced
 * 3. Redaction works (no secrets in trace output)
 */

describe("SLICE-98-9: Safety sweep", () => {
  let server: ReturnType<typeof createRuntimeTargetServer>;
  let baseUrl: string;

  beforeAll(async () => {
    server = createRuntimeTargetServer({ port: 0 });
    baseUrl = await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("all trace steps only have GET actions (read-only)", async () => {
    const traces = await runTasks(
      [RT01_DISCOVER, RT05_CALL],
      baseUrl,
      { stepOutputs: new Map() },
    );
    for (const trace of traces) {
      for (const step of trace.steps) {
        if (step.action.startsWith("GET ")) {
          // OK — read-only
          continue;
        }
        // Non-HTTP steps (parse, validate, etc.) are fine
        expect(step.action).not.toMatch(/^POST |^PUT |^DELETE |^PATCH /);
      }
    }
  });

  it("budget cap of 1 request produces partial outcome for multi-request tasks", async () => {
    const taskWithBudget = {
      ...RT01_DISCOVER,
      budget: { ...RT01_DISCOVER.budget, max_requests: 1 },
    };
    const traces = await runTasks([taskWithBudget], baseUrl, { stepOutputs: new Map() });
    expect(traces[0].stop_reason).toBe("budget_exhausted");
    expect(traces[0].outcome).toBe("partial");
  });

  it("redaction: no seeded secret appears in trace output", async () => {
    const ctx = {
      credentials: { API_KEY: "super-secret-value-12345" },
      stepOutputs: new Map<string, unknown>(),
    };
    const traces = await runTasks([RT01_DISCOVER], baseUrl, ctx);
    const serialized = JSON.stringify(traces);
    expect(serialized).not.toContain("super-secret-value-12345");
  });

  it("trace steps do not contain response bodies (only refs)", async () => {
    const traces = await runTasks([RT05_CALL], baseUrl, { stepOutputs: new Map() });
    for (const trace of traces) {
      for (const step of trace.steps) {
        // Steps should not have inline response bodies
        expect(step).not.toHaveProperty("body");
        expect(step).not.toHaveProperty("response_body");
      }
    }
  });
});
