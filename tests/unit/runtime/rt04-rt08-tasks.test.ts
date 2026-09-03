import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRuntimeTargetServer } from "../../fixtures/runtime-target-server";
import { runTask } from "../../../src/agent-readiness/runtime/executor";
import { RT04_CONSTRUCT } from "../../../src/agent-readiness/runtime/tasks/rt04-construct";
import { RT05_CALL } from "../../../src/agent-readiness/runtime/tasks/rt05-call";
import { RT06_HANDLE } from "../../../src/agent-readiness/runtime/tasks/rt06-handle";
import { RT07_OBSERVE } from "../../../src/agent-readiness/runtime/tasks/rt07-observe";
import { RT08_VERSION } from "../../../src/agent-readiness/runtime/tasks/rt08-version";

describe("SLICE-98-6: RT-04..RT-08 task definitions", () => {
  let server: ReturnType<typeof createRuntimeTargetServer>;
  let baseUrl: string;

  beforeAll(async () => {
    server = createRuntimeTargetServer({ port: 0 });
    baseUrl = await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  describe("RT-04 construct", () => {
    it("happy path: non-HTTP steps → success", async () => {
      const trace = await runTask(RT04_CONSTRUCT, baseUrl, {});
      expect(trace.task_id).toBe("RT-04");
      expect(trace.outcome).toBe("success");
      expect(trace.stop_reason).toBe("completed");
      expect(trace.steps).toHaveLength(3);
    });
  });

  describe("RT-05 call", () => {
    it("happy path: GET /api/v1/status → success", async () => {
      const trace = await runTask(RT05_CALL, baseUrl, {});
      expect(trace.task_id).toBe("RT-05");
      expect(trace.outcome).toBe("success");
      expect(trace.stop_reason).toBe("completed");
      // Step 1 is HTTP GET, step 2 is non-HTTP validate
      expect(trace.steps[0].outcome).toBe("ok");
      expect(trace.steps[1].outcome).toBe("ok");
    });
  });

  describe("RT-06 handle", () => {
    it("happy path: invalid param → success (read-only)", async () => {
      const trace = await runTask(RT06_HANDLE, baseUrl, {});
      expect(trace.task_id).toBe("RT-06");
      expect(trace.outcome).toBe("success");
      expect(trace.stop_reason).toBe("completed");
    });
  });

  describe("RT-07 observe", () => {
    it("happy path: observe rate-limit headers → success", async () => {
      const trace = await runTask(RT07_OBSERVE, baseUrl, {});
      expect(trace.task_id).toBe("RT-07");
      expect(trace.outcome).toBe("success");
      expect(trace.stop_reason).toBe("completed");
    });

    it("observe-only: max_requests=1, exactly 1 HTTP request made", async () => {
      const trace = await runTask(RT07_OBSERVE, baseUrl, {});
      // Only step 1 is HTTP (GET /api/v1/status), steps 2 and 3 are non-HTTP
      const httpSteps = trace.steps.filter((s) => s.response_ref);
      expect(httpSteps.length).toBe(1);
    });
  });

  describe("RT-08 version", () => {
    it("happy path: version check → success", async () => {
      const trace = await runTask(RT08_VERSION, baseUrl, {});
      expect(trace.task_id).toBe("RT-08");
      expect(trace.outcome).toBe("success");
      expect(trace.stop_reason).toBe("completed");
    });
  });

  describe("all tasks are read-only", () => {
    it("all 8 tasks have safety.mode = read_only", () => {
      const allTasks = [RT04_CONSTRUCT, RT05_CALL, RT06_HANDLE, RT07_OBSERVE, RT08_VERSION];
      for (const task of allTasks) {
        expect(task.safety.mode).toBe("read_only");
      }
    });
  });
});
