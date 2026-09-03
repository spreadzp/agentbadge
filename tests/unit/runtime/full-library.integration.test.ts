import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRuntimeTargetServer } from "../../fixtures/runtime-target-server";
import { runTasks } from "../../../src/agent-readiness/runtime/executor";
import { computeAsr } from "../../../src/agent-readiness/runtime/success-rate";
import { compareDeclaredVsObserved, type DeclaredFact, type ObservedFact } from "../../../src/agent-readiness/runtime/comparison";
import { deriveGaps } from "../../../src/agent-readiness/gap-engine/gap-engine";
import { RT01_DISCOVER } from "../../../src/agent-readiness/runtime/tasks/rt01-discover";
import { RT02_DOCS } from "../../../src/agent-readiness/runtime/tasks/rt02-docs";
import { RT03_AUTH } from "../../../src/agent-readiness/runtime/tasks/rt03-auth";
import { RT04_CONSTRUCT } from "../../../src/agent-readiness/runtime/tasks/rt04-construct";
import { RT05_CALL } from "../../../src/agent-readiness/runtime/tasks/rt05-call";
import { RT06_HANDLE } from "../../../src/agent-readiness/runtime/tasks/rt06-handle";
import { RT07_OBSERVE } from "../../../src/agent-readiness/runtime/tasks/rt07-observe";
import { RT08_VERSION } from "../../../src/agent-readiness/runtime/tasks/rt08-version";

const ALL_TASKS = [
  RT01_DISCOVER,
  RT02_DOCS,
  RT03_AUTH,
  RT04_CONSTRUCT,
  RT05_CALL,
  RT06_HANDLE,
  RT07_OBSERVE,
  RT08_VERSION,
];

describe("SLICE-98-6: Full-library integration — complete runtime pipeline", () => {
  let server: ReturnType<typeof createRuntimeTargetServer>;
  let baseUrl: string;

  beforeAll(async () => {
    server = createRuntimeTargetServer({
      port: 0,
      scenarios: { authMismatch: true, rateLimitMismatch: true },
    });
    baseUrl = await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("runs all 8 tasks → 8 traces", async () => {
    const traces = await runTasks(ALL_TASKS, baseUrl, {});
    expect(traces).toHaveLength(8);
    for (const trace of traces) {
      expect(trace.task_id).toMatch(/^RT-0[1-8]$/);
      expect(trace.steps.length).toBeGreaterThan(0);
    }
  });

  it("computes ASR from full-library traces", async () => {
    const traces = await runTasks(ALL_TASKS, baseUrl, {});
    const asr = computeAsr(traces);
    expect(asr.total).toBe(8);
    // RT-03 will be partial (auth_blocked) with authMismatch=true
    expect(asr.partial).toBeGreaterThanOrEqual(1);
    // ASR < 1.0 because not all tasks succeed
    expect(asr.asr).toBeLessThan(1.0);
    // Per-category should have entries
    expect(Object.keys(asr.per_category).length).toBeGreaterThan(0);
  });

  it("full chain: traces → observedFacts → compare → assertions → gaps", async () => {
    const traces = await runTasks(ALL_TASKS, baseUrl, {});

    // Extract observed facts from traces
    const observed: ObservedFact[] = [];
    for (const trace of traces) {
      for (const step of trace.steps) {
        if (step.phase === "auth" && step.outcome === "stopped") {
          observed.push({
            family: "auth_scheme",
            task_id: trace.task_id,
            step_seq: step.seq,
            observed_value: "api_key",
            observed_detail: step.notes ?? "auth blocked",
            response_ref: step.response_ref ?? "",
          });
        }
      }
    }

    // Declared facts (from fixture server's OpenAPI — OAuth2 declared)
    const declared: DeclaredFact[] = [
      { family: "auth_scheme", rule_id: "AB-007", value: "oauth2", claim: "Auth scheme is OAuth2" },
    ];

    const results = compareDeclaredVsObserved(declared, observed);
    expect(results.length).toBeGreaterThan(0);

    // Convert to assertions and derive gaps
    const assertions = results.map((r) => r.assertion);
    const gaps = deriveGaps(assertions, []);
    expect(gaps.length).toBeGreaterThan(0);

    // Should have an evidence gap from the auth CONFLICT
    const evidenceGap = gaps.find((g) => g.type === "evidence");
    expect(evidenceGap).toBeDefined();
  });

  it("determinism: two full-library runs produce equal traces (modulo time)", async () => {
    const traces1 = await runTasks(ALL_TASKS, baseUrl, {});
    const traces2 = await runTasks(ALL_TASKS, baseUrl, {});

    const strip = (t: typeof traces1) =>
      t.map((trace) => ({
        ...trace,
        started_at: "",
        duration_ms: 0,
      }));

    expect(JSON.stringify(strip(traces1))).toBe(JSON.stringify(strip(traces2)));
  });
});
