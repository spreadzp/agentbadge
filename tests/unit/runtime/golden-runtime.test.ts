import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRuntimeTargetServer } from "../../fixtures/runtime-target-server";
import { runTasks } from "../../../src/agent-readiness/runtime/executor";
import { computeAsr } from "../../../src/agent-readiness/runtime/success-rate";
import { RT01_DISCOVER } from "../../../src/agent-readiness/runtime/tasks/rt01-discover";
import { RT02_DOCS } from "../../../src/agent-readiness/runtime/tasks/rt02-docs";
import { RT03_AUTH } from "../../../src/agent-readiness/runtime/tasks/rt03-auth";
import { RT04_CONSTRUCT } from "../../../src/agent-readiness/runtime/tasks/rt04-construct";
import { RT05_CALL } from "../../../src/agent-readiness/runtime/tasks/rt05-call";
import { RT06_HANDLE } from "../../../src/agent-readiness/runtime/tasks/rt06-handle";
import { RT07_OBSERVE } from "../../../src/agent-readiness/runtime/tasks/rt07-observe";
import { RT08_VERSION } from "../../../src/agent-readiness/runtime/tasks/rt08-version";

/**
 * SLICE-98-9: Golden runtime fixtures — frozen expectations.
 *
 * Hand-documented expected outcomes for the fixture server (no mismatches).
 * Any drift in executor/task definitions breaks these tests.
 * Exact equality — not approximate.
 */

const ALL_TASKS = [
  RT01_DISCOVER, RT02_DOCS, RT03_AUTH, RT04_CONSTRUCT,
  RT05_CALL, RT06_HANDLE, RT07_OBSERVE, RT08_VERSION,
];

interface GoldenTask {
  task_id: string;
  outcome: string;
  stop_reason: string;
  step_count: number;
  steps: Array<{ seq: number; phase: string; action: string; outcome: string }>;
}

const GOLDEN: GoldenTask[] = [
  {
    task_id: "RT-01",
    outcome: "success",
    stop_reason: "completed",
    step_count: 3,
    steps: [
      { seq: 1, phase: "discover", action: "GET /llms.txt", outcome: "ok" },
      { seq: 2, phase: "discover", action: "GET /agents.txt", outcome: "ok" },
      { seq: 3, phase: "discover", action: "GET /.well-known/ai-plugin.json", outcome: "ok" },
    ],
  },
  {
    task_id: "RT-02",
    outcome: "success",
    stop_reason: "completed",
    step_count: 4,
    steps: [
      { seq: 1, phase: "fetch", action: "GET /openapi.json", outcome: "ok" },
      { seq: 2, phase: "parse", action: "validate-openapi-schema", outcome: "ok" },
      { seq: 3, phase: "fetch", action: "GET /agent-guide.json", outcome: "ok" },
      { seq: 4, phase: "parse", action: "validate-guide-schema", outcome: "ok" },
    ],
  },
  {
    task_id: "RT-03",
    outcome: "partial",
    stop_reason: "auth_blocked",
    step_count: 2,
    steps: [
      { seq: 1, phase: "prepare", action: "read-declared-auth-from-openapi", outcome: "ok" },
      { seq: 2, phase: "auth", action: "GET /api/v1/protected with declared auth", outcome: "stopped" },
    ],
  },
  {
    task_id: "RT-04",
    outcome: "success",
    stop_reason: "completed",
    step_count: 3,
    steps: [
      { seq: 1, phase: "construct", action: "read-parsed-openapi-spec", outcome: "ok" },
      { seq: 2, phase: "construct", action: "select-first-read-endpoint", outcome: "ok" },
      { seq: 3, phase: "construct", action: "build-request-from-spec", outcome: "ok" },
    ],
  },
  {
    task_id: "RT-05",
    outcome: "success",
    stop_reason: "completed",
    step_count: 2,
    steps: [
      { seq: 1, phase: "call", action: "GET /api/v1/status", outcome: "ok" },
      { seq: 2, phase: "call", action: "validate-response-against-schema", outcome: "ok" },
    ],
  },
  {
    task_id: "RT-06",
    outcome: "success",
    stop_reason: "completed",
    step_count: 3,
    steps: [
      { seq: 1, phase: "handle", action: "GET /api/v1/status?invalid_param=bad_value", outcome: "ok" },
      { seq: 2, phase: "handle", action: "observe-error-response", outcome: "ok" },
      { seq: 3, phase: "handle", action: "compare-error-semantics-vs-declared", outcome: "ok" },
    ],
  },
  {
    task_id: "RT-07",
    outcome: "success",
    stop_reason: "completed",
    step_count: 3,
    steps: [
      { seq: 1, phase: "observe", action: "GET /api/v1/status", outcome: "ok" },
      { seq: 2, phase: "observe", action: "read-rate-limit-headers", outcome: "ok" },
      { seq: 3, phase: "observe", action: "compare-vs-declared-limits", outcome: "ok" },
    ],
  },
  {
    task_id: "RT-08",
    outcome: "success",
    stop_reason: "completed",
    step_count: 3,
    steps: [
      { seq: 1, phase: "version", action: "GET /api/v1/status", outcome: "ok" },
      { seq: 2, phase: "version", action: "read-sunset-deprecation-headers", outcome: "ok" },
      { seq: 3, phase: "version", action: "compare-vs-declared-versioning", outcome: "ok" },
    ],
  },
];

const GOLDEN_ASR = {
  total: 8,
  successful: 7,
  failed: 0,
  partial: 1,
  asr: 0.875,
};

describe("SLICE-98-9: Golden runtime fixtures — frozen expectations", () => {
  let server: ReturnType<typeof createRuntimeTargetServer>;
  let baseUrl: string;
  let traces: ReturnType<typeof runTasks> extends Promise<infer T> ? T : never;

  beforeAll(async () => {
    server = createRuntimeTargetServer({ port: 0 });
    baseUrl = await server.start();
    traces = await runTasks(ALL_TASKS, baseUrl, { stepOutputs: new Map() });
  });

  afterAll(async () => {
    await server.stop();
  });

  it("produces exactly 8 traces", () => {
    expect(traces).toHaveLength(8);
  });

  it("each trace matches golden: task_id, outcome, stop_reason, step_count", () => {
    for (let i = 0; i < GOLDEN.length; i++) {
      const trace = traces[i];
      const golden = GOLDEN[i];
      expect(trace.task_id).toBe(golden.task_id);
      expect(trace.outcome).toBe(golden.outcome);
      expect(trace.stop_reason).toBe(golden.stop_reason);
      expect(trace.steps.length).toBe(golden.step_count);
    }
  });

  it("each step matches golden: seq, phase, action, outcome", () => {
    for (let i = 0; i < GOLDEN.length; i++) {
      const trace = traces[i];
      const golden = GOLDEN[i];
      for (let j = 0; j < golden.steps.length; j++) {
        expect(trace.steps[j].seq).toBe(golden.steps[j].seq);
        expect(trace.steps[j].phase).toBe(golden.steps[j].phase);
        expect(trace.steps[j].action).toBe(golden.steps[j].action);
        expect(trace.steps[j].outcome).toBe(golden.steps[j].outcome);
      }
    }
  });

  it("ASR matches golden: 7/8 successful, 1 partial, 0 failed, 87.5%", () => {
    const asr = computeAsr(traces);
    expect(asr.total).toBe(GOLDEN_ASR.total);
    expect(asr.successful).toBe(GOLDEN_ASR.successful);
    expect(asr.failed).toBe(GOLDEN_ASR.failed);
    expect(asr.partial).toBe(GOLDEN_ASR.partial);
    expect(asr.asr).toBe(GOLDEN_ASR.asr);
  });

  it("per-category ASR: auth=0 (partial), all others=1 (success)", () => {
    const asr = computeAsr(traces);
    expect(asr.per_category.auth.asr).toBe(0);
    expect(asr.per_category.auth.partial).toBe(1);
    expect(asr.per_category.discover.asr).toBe(1);
    expect(asr.per_category.docs.asr).toBe(1);
    expect(asr.per_category.construct.asr).toBe(1);
    expect(asr.per_category.call.asr).toBe(1);
    expect(asr.per_category.handle.asr).toBe(1);
    expect(asr.per_category.observe.asr).toBe(1);
    expect(asr.per_category.version.asr).toBe(1);
  });

  it("RT-03 auth_blocked: step 2 has notes containing 401", () => {
    const rt03 = traces.find((t) => t.task_id === "RT-03");
    expect(rt03).toBeDefined();
    expect(rt03!.stop_reason).toBe("auth_blocked");
    const stoppedStep = rt03!.steps.find((s) => s.outcome === "stopped");
    expect(stoppedStep).toBeDefined();
    expect(stoppedStep!.notes).toContain("401");
  });

  it("determinism: two runs produce identical outcomes + stop_reasons", async () => {
    const traces2 = await runTasks(ALL_TASKS, baseUrl, { stepOutputs: new Map() });
    for (let i = 0; i < traces.length; i++) {
      expect(traces2[i].task_id).toBe(traces[i].task_id);
      expect(traces2[i].outcome).toBe(traces[i].outcome);
      expect(traces2[i].stop_reason).toBe(traces[i].stop_reason);
      expect(traces2[i].steps.length).toBe(traces[i].steps.length);
    }
  });
});
