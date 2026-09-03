import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRuntimeTargetServer } from "../../fixtures/runtime-target-server";
import { runTask, runTasks } from "../../../src/agent-readiness/runtime/executor";
import type { ExecutionTrace } from "../../../src/agent-readiness/runtime/trace";
import { RT01_DISCOVER } from "../../../src/agent-readiness/runtime/tasks/rt01-discover";
import { RT02_DOCS } from "../../../src/agent-readiness/runtime/tasks/rt02-docs";
import { RT03_AUTH } from "../../../src/agent-readiness/runtime/tasks/rt03-auth";

describe("SLICE-98-3: Executor + Trace recording", () => {
  let server: ReturnType<typeof createRuntimeTargetServer>;
  let baseUrl: string;

  beforeAll(async () => {
    server = createRuntimeTargetServer({ port: 0 });
    baseUrl = await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  describe("Happy path RT-01", () => {
    it("executes all steps → success, completed", async () => {
      const trace = await runTask(RT01_DISCOVER, baseUrl, {});

      expect(trace.task_id).toBe("RT-01");
      expect(trace.target).toBe(baseUrl);
      expect(trace.outcome).toBe("success");
      expect(trace.stop_reason).toBe("completed");
      expect(trace.steps.length).toBe(3);
      expect(trace.steps[0].seq).toBe(1);
      expect(trace.steps[0].outcome).toBe("ok");
      expect(trace.steps[1].seq).toBe(2);
      expect(trace.steps[1].outcome).toBe("ok");
      expect(trace.steps[2].seq).toBe(3);
      expect(trace.steps[2].outcome).toBe("ok");
    });

    it("records snapshot refs (not inlined bodies)", async () => {
      const trace = await runTask(RT01_DISCOVER, baseUrl, {});

      for (const step of trace.steps) {
        if (step.request_ref) {
          expect(typeof step.request_ref).toBe("string");
          expect(step.request_ref.length).toBeGreaterThan(0);
        }
        if (step.response_ref) {
          expect(typeof step.response_ref).toBe("string");
          expect(step.response_ref.length).toBeGreaterThan(0);
        }
      }
    });

    it("has deterministic trace_id", async () => {
      const trace1 = await runTask(RT01_DISCOVER, baseUrl, {});
      const trace2 = await runTask(RT01_DISCOVER, baseUrl, {});
      expect(trace1.trace_id).toBe(trace2.trace_id);
    });
  });

  describe("RT-03 without creds → auth_blocked", () => {
    it("stops at auth step with auth_blocked stop_reason", async () => {
      const trace = await runTask(RT03_AUTH, baseUrl, {});

      expect(trace.task_id).toBe("RT-03");
      expect(trace.stop_reason).toBe("auth_blocked");
      // First step (read-declared-auth) should be ok
      expect(trace.steps[0].outcome).toBe("ok");
      // The auth step should be stopped
      const authStep = trace.steps.find((s) => s.phase === "auth");
      expect(authStep).toBeDefined();
      expect(authStep!.outcome).toBe("stopped");
    });

    it("trace outcome is partial (some steps ok, stopped mid-way)", async () => {
      const trace = await runTask(RT03_AUTH, baseUrl, {});
      expect(trace.outcome).toBe("partial");
    });
  });

  describe("Budget exhaustion", () => {
    it("stops with budget_exhausted when max_requests is too low", async () => {
      const tinyTask = {
        ...RT01_DISCOVER,
        task_id: "RT-01-tiny",
        budget: { max_requests: 1, max_steps: 10, timeout_ms: 15000 },
      };
      const trace = await runTask(tinyTask, baseUrl, {});

      expect(trace.stop_reason).toBe("budget_exhausted");
      // Only 1 request should have been made
      const okSteps = trace.steps.filter((s) => s.outcome === "ok");
      expect(okSteps.length).toBe(1);
    });
  });

  describe("Determinism", () => {
    it("two runs of same task produce equal traces (modulo time fields)", async () => {
      const trace1 = await runTask(RT01_DISCOVER, baseUrl, {});
      const trace2 = await runTask(RT01_DISCOVER, baseUrl, {});

      // Strip time fields
      const strip = (t: ExecutionTrace) => ({
        ...t,
        started_at: "",
        duration_ms: 0,
        steps: t.steps.map((s) => ({ ...s, notes: s.notes ?? "" })),
      });

      expect(JSON.stringify(strip(trace1))).toBe(JSON.stringify(strip(trace2)));
    });
  });

  describe("Redaction holds on real traces", () => {
    it("seeded fake token never appears in serialized trace", async () => {
      const FAKE_TOKEN = "AKIAIOSFODNN7EXAMPLE-super-secret-99999";
      const trace = await runTask(RT03_AUTH, baseUrl, {
        credentials: { "X-Api-Key": FAKE_TOKEN },
      });

      const serialized = JSON.stringify(trace);
      expect(serialized).not.toContain(FAKE_TOKEN);
    });
  });

  describe("runTasks (multi-task)", () => {
    it("runs multiple tasks sequentially and returns Trace[]", async () => {
      const traces = await runTasks([RT01_DISCOVER, RT02_DOCS], baseUrl, {});

      expect(traces.length).toBe(2);
      expect(traces[0].task_id).toBe("RT-01");
      expect(traces[1].task_id).toBe("RT-02");
      expect(traces[0].outcome).toBe("success");
      expect(traces[1].outcome).toBe("success");
    });
  });

  describe("Trace schema compliance (§9.2)", () => {
    it("trace has all required fields", async () => {
      const trace = await runTask(RT01_DISCOVER, baseUrl, {});

      expect(trace.trace_id).toBeDefined();
      expect(trace.target).toBeDefined();
      expect(trace.task_id).toBeDefined();
      expect(trace.started_at).toBeDefined();
      expect(typeof trace.duration_ms).toBe("number");
      expect(Array.isArray(trace.steps)).toBe(true);
      expect(["success", "partial", "failed"]).toContain(trace.outcome);
      expect([
        "completed",
        "auth_blocked",
        "error_unrecoverable",
        "budget_exhausted",
        "timeout",
      ]).toContain(trace.stop_reason);
    });

    it("each step has required fields", async () => {
      const trace = await runTask(RT01_DISCOVER, baseUrl, {});

      for (const step of trace.steps) {
        expect(typeof step.seq).toBe("number");
        expect(typeof step.phase).toBe("string");
        expect(typeof step.action).toBe("string");
        expect(["ok", "error", "stopped"]).toContain(step.outcome);
      }
    });
  });
});
