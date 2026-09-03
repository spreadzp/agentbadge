import { describe, it, expect } from "vitest";
import { computeAsr } from "../../../src/agent-readiness/runtime/success-rate";
import type { ExecutionTrace } from "../../../src/agent-readiness/runtime/trace";

function makeTrace(task_id: string, outcome: "success" | "partial" | "failed"): ExecutionTrace {
  return {
    trace_id: `trace-${task_id}`,
    target: "http://localhost:9999",
    task_id,
    started_at: "2026-01-01T00:00:00.000Z",
    duration_ms: 100,
    steps: [{ seq: 1, phase: "test", action: "test", outcome: "ok" }],
    outcome,
    stop_reason: outcome === "success" ? "completed" : "error_unrecoverable",
  };
}

describe("SLICE-98-6: ASR computation", () => {
  it("empty traces → asr 0, all buckets 0", () => {
    const result = computeAsr([]);
    expect(result.total).toBe(0);
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.partial).toBe(0);
    expect(result.asr).toBe(0);
  });

  it("all success → asr 1.0", () => {
    const traces = [
      makeTrace("RT-01", "success"),
      makeTrace("RT-02", "success"),
    ];
    const result = computeAsr(traces);
    expect(result.total).toBe(2);
    expect(result.successful).toBe(2);
    expect(result.asr).toBe(1);
  });

  it("mixed outcomes → correct asr", () => {
    const traces = [
      makeTrace("RT-01", "success"),
      makeTrace("RT-02", "success"),
      makeTrace("RT-03", "partial"),
      makeTrace("RT-04", "failed"),
    ];
    const result = computeAsr(traces);
    expect(result.total).toBe(4);
    expect(result.successful).toBe(2);
    expect(result.partial).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.asr).toBe(0.5);
  });

  it("partial is NOT counted as success or failure", () => {
    const traces = [
      makeTrace("RT-01", "partial"),
      makeTrace("RT-02", "partial"),
    ];
    const result = computeAsr(traces);
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.partial).toBe(2);
    expect(result.asr).toBe(0);
  });

  it("per-category breakdown is correct", () => {
    const traces = [
      makeTrace("RT-01", "success"), // discover
      makeTrace("RT-01", "failed"),  // discover
      makeTrace("RT-03", "success"), // auth
      makeTrace("RT-05", "partial"), // call
    ];
    const result = computeAsr(traces);
    expect(result.per_category.discover).toEqual({
      total: 2, successful: 1, failed: 1, partial: 0, asr: 0.5,
    });
    expect(result.per_category.auth).toEqual({
      total: 1, successful: 1, failed: 0, partial: 0, asr: 1,
    });
    expect(result.per_category.call).toEqual({
      total: 1, successful: 0, failed: 0, partial: 1, asr: 0,
    });
  });

  it("golden vector: 8-trace set → exact asr + per_category", () => {
    const traces: ExecutionTrace[] = [
      makeTrace("RT-01", "success"), // discover
      makeTrace("RT-02", "success"), // docs
      makeTrace("RT-03", "partial"), // auth
      makeTrace("RT-04", "success"), // construct
      makeTrace("RT-05", "success"), // call
      makeTrace("RT-06", "failed"),  // handle
      makeTrace("RT-07", "success"), // observe
      makeTrace("RT-08", "success"), // version
    ];
    const result = computeAsr(traces);
    expect(result.total).toBe(8);
    expect(result.successful).toBe(6);
    expect(result.partial).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.asr).toBe(0.75);
    // Per-category
    expect(result.per_category.discover.asr).toBe(1);
    expect(result.per_category.docs.asr).toBe(1);
    expect(result.per_category.auth.asr).toBe(0);
    expect(result.per_category.construct.asr).toBe(1);
    expect(result.per_category.call.asr).toBe(1);
    expect(result.per_category.handle.asr).toBe(0);
    expect(result.per_category.observe.asr).toBe(1);
    expect(result.per_category.version.asr).toBe(1);
  });

  it("rounding: 1/3 → 0.3333", () => {
    const traces = [
      makeTrace("RT-01", "success"),
      makeTrace("RT-02", "failed"),
      makeTrace("RT-03", "failed"),
    ];
    const result = computeAsr(traces);
    expect(result.asr).toBe(0.3333);
  });
});
