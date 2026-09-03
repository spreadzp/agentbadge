import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * SLICE-98-1: Spec v0.6 — Runtime Layer
 *
 * Spec-as-document lint: verifies that AGENT-READINESS-SPEC-v0.6.md
 * contains §9 Runtime Layer with:
 * - §9.1 Task model (TaskDefinition, 8-task library RT-01..RT-08, safety classes)
 * - §9.2 ExecutionTrace schema (field table, determinism, snapshot-ref-only)
 * - §9.3 RuntimeEvidence (variant fields, source_class: runtime, confidence ≥ 0.9)
 * - §9.4 Declared vs Observed comparison rules (5 rules → CONFLICT, failed step → GAP)
 * - §9.5 Agent Success Rate (formula, per-category, beside not inside static score)
 * - §9.6 Safety rails (SSRF, budgets, read-only defaults, no load testing, credential redaction)
 * - Appendix A.7 Runtime payload JSON Schema
 * - Changelog v0.5 → v0.6 (additive only)
 */

const specPath = resolve(
  __dirname,
  "../../../../../docs/EPICS/32-agent-readiness-spec/spec/AGENT-READINESS-SPEC-v0.6.md",
);
const spec = readFileSync(specPath, "utf-8");

describe("SLICE-98-1: Spec v0.6 — Runtime Layer", () => {
  it("spec file exists and is non-empty", () => {
    expect(spec.length).toBeGreaterThan(5000);
  });

  it("has v0.6 in title", () => {
    expect(spec).toMatch(/v0\.6/);
  });

  it("has §9 Runtime Layer section", () => {
    expect(spec).toMatch(/##\s*9\.\s*Runtime\s*Layer/i);
  });

  // §9.1 Task model
  it("has §9.1 Task model with TaskDefinition", () => {
    expect(spec).toMatch(/§9\.1.*[Tt]ask.*model/i);
    expect(spec).toContain("TaskDefinition");
  });

  it("TaskDefinition has required fields", () => {
    const fields = [
      "task_id",
      "name",
      "category",
      "steps",
      "preconditions",
      "safety",
      "budget",
    ];
    for (const field of fields) {
      expect(spec, `missing TaskDefinition field: ${field}`).toContain(
        `\`${field}\``,
      );
    }
  });

  it("TaskDefinition safety has mode and auth_required", () => {
    expect(spec).toContain("read_only");
    expect(spec).toContain("mutating");
    expect(spec).toContain("auth_required");
  });

  it("TaskDefinition budget has max_requests, max_steps, timeout_ms", () => {
    expect(spec).toContain("max_requests");
    expect(spec).toContain("max_steps");
    expect(spec).toContain("timeout_ms");
  });

  it("has 8-task library RT-01 through RT-08", () => {
    for (let i = 1; i <= 8; i++) {
      const id = `RT-0${i}`;
      expect(spec, `missing task: ${id}`).toContain(id);
    }
  });

  it("task library has categories: discover, docs, auth, construct, call, handle, observe, version", () => {
    const categories = [
      "discover",
      "docs",
      "auth",
      "construct",
      "call",
      "handle",
      "observe",
      "version",
    ];
    for (const cat of categories) {
      expect(spec, `missing task category: ${cat}`).toContain(cat);
    }
  });

  it("has anti-explosion note (library capped)", () => {
    expect(spec).toMatch(/anti-explosion|library.*capped|new tasks.*spec change/i);
  });

  // §9.2 ExecutionTrace schema
  it("has §9.2 ExecutionTrace schema", () => {
    expect(spec).toMatch(/§9\.2.*ExecutionTrace/i);
    expect(spec).toContain("ExecutionTrace");
  });

  it("ExecutionTrace has required fields", () => {
    const fields = [
      "trace_id",
      "target",
      "task_id",
      "steps",
      "outcome",
      "stop_reason",
      "duration_ms",
    ];
    for (const field of fields) {
      expect(spec, `missing ExecutionTrace field: ${field}`).toContain(
        `\`${field}\``,
      );
    }
  });

  it("ExecutionTrace step has required fields", () => {
    const fields = [
      "seq",
      "phase",
      "action",
      "request_ref",
      "response_ref",
      "outcome",
      "retry_of",
      "notes",
    ];
    for (const field of fields) {
      expect(spec, `missing step field: ${field}`).toContain(`\`${field}\``);
    }
  });

  it("ExecutionTrace outcome has success, partial, failed", () => {
    expect(spec).toContain("success");
    expect(spec).toContain("partial");
    expect(spec).toContain("failed");
  });

  it("has 5 stop_reason values", () => {
    const reasons = [
      "completed",
      "auth_blocked",
      "error_unrecoverable",
      "budget_exhausted",
      "timeout",
    ];
    for (const reason of reasons) {
      expect(spec, `missing stop_reason: ${reason}`).toContain(reason);
    }
  });

  it("states determinism requirement", () => {
    expect(spec).toMatch(/determinism|same.*target.*state.*identical/i);
  });

  it("states snapshot-ref-only rule (no inlined bodies)", () => {
    expect(spec).toMatch(/snapshot.*ref|no.*inlined.*bod/i);
  });

  // §9.3 RuntimeEvidence
  it("has §9.3 RuntimeEvidence", () => {
    expect(spec).toMatch(/§9\.3.*RuntimeEvidence/i);
    expect(spec).toContain("RuntimeEvidence");
  });

  it("RuntimeEvidence has source_class: runtime", () => {
    expect(spec).toMatch(/source_class.*runtime/i);
  });

  it("RuntimeEvidence has confidence floor 0.9", () => {
    expect(spec).toMatch(/0\.9/);
  });

  it("RuntimeEvidence has task_id, step_seq, snapshot refs, observed_fact, outcome", () => {
    const fields = [
      "task_id",
      "step_seq",
      "observed_fact",
      "outcome",
    ];
    for (const field of fields) {
      expect(spec, `missing RuntimeEvidence field: ${field}`).toContain(
        `\`${field}\``,
      );
    }
  });

  // §9.4 Declared vs Observed comparison rules
  it("has §9.4 Declared vs Observed comparison rules", () => {
    expect(spec).toMatch(/§9\.4.*[Dd]eclared.*[Oo]bserved/i);
  });

  it("has 5 comparison rules", () => {
    const rules = [
      "Auth scheme mismatch",
      "Response schema mismatch",
      "Error semantics mismatch",
      "Rate-limit header contradiction",
      "Versioning contradiction",
    ];
    for (const rule of rules) {
      expect(spec, `missing comparison rule: ${rule}`).toContain(rule);
    }
  });

  it("comparison rules output CONFLICT with runtime evidence", () => {
    expect(spec).toMatch(/CONFLICT.*runtime/i);
  });

  it("failed step with nothing declared produces GAP", () => {
    expect(spec).toMatch(/failed.*step.*nothing.*declared.*GAP|GAP.*runtime/i);
  });

  it("states zero engine changes to 96 gap engine", () => {
    expect(spec).toMatch(/zero.*engine.*change|no.*change.*96|unchanged/i);
  });

  it("comparison rules have pseudocode or worked examples", () => {
    expect(spec).toMatch(/pseudocode|worked example/i);
  });

  // §9.5 Agent Success Rate
  it("has §9.5 Agent Success Rate", () => {
    expect(spec).toMatch(/§9\.5.*Agent Success Rate/i);
  });

  it("ASR formula is successful/tested", () => {
    expect(spec).toMatch(/successful.*tested/i);
  });

  it("ASR has per-category breakdown", () => {
    expect(spec).toMatch(/per.category/i);
  });

  it("ASR is beside not inside the static score", () => {
    expect(spec).toMatch(/beside.*not.*inside|alongside.*not.*inside|separate.*axis/i);
  });

  // §9.6 Safety rails
  it("has §9.6 Safety rails", () => {
    expect(spec).toMatch(/§9\.6.*[Ss]afety/i);
  });

  it("safety rails mandate SSRF suite", () => {
    expect(spec).toMatch(/SSRF/i);
  });

  it("safety rails have per-task and per-run budgets", () => {
    expect(spec).toMatch(/per.task.*budget|per.run.*budget/i);
  });

  it("safety rails state read-only defaults, mutating = explicit opt-in", () => {
    expect(spec).toMatch(/read.only.*default/i);
    expect(spec).toMatch(/mutating.*opt-in|opt-in.*mutating/i);
  });

  it("safety rails prohibit load testing / deliberate rate limit tripping", () => {
    expect(spec).toMatch(/no.*load.*test|never.*trip.*rate|observe.*only/i);
  });

  it("safety rails require credential redaction, never persisted", () => {
    expect(spec).toMatch(/redact/i);
    expect(spec).toMatch(/never.*persist/i);
  });

  it("safety rails specify credentials via env/flags only", () => {
    expect(spec).toMatch(/env.*flag|flag.*env/i);
  });

  // Appendix A.7
  it("has Appendix A.7 Runtime payload JSON Schema", () => {
    expect(spec).toMatch(/A\.7.*[Rr]untime.*[Pp]ayload/i);
  });

  it("A.7 has trace schema reference", () => {
    expect(spec).toMatch(/trace.*schema|ExecutionTrace.*schema/i);
  });

  it("A.7 has ASR in runtime report section", () => {
    expect(spec).toMatch(/asr/i);
  });

  it("A.7 has conflicts_generated field", () => {
    expect(spec).toContain("conflicts_generated");
  });

  it("A.7 has per_category field", () => {
    expect(spec).toContain("per_category");
  });

  it("A.7 states additive evolution note", () => {
    expect(spec).toMatch(/additive/i);
  });

  // Changelog
  it("has changelog v0.5 → v0.6", () => {
    expect(spec).toMatch(/v0\.5.*v0\.6|0\.5.*0\.6/i);
  });

  it("changelog is additive only (no renames)", () => {
    expect(spec).toMatch(/additive/i);
  });

  it("changelog mentions renumbering", () => {
    expect(spec).toMatch(/renumber/i);
  });

  // v0.5 untouched
  it("v0.5 spec is untouched (v0.6 is a separate file)", () => {
    const v05Path = resolve(
      __dirname,
      "../../../../../docs/EPICS/32-agent-readiness-spec/spec/AGENT-READINESS-SPEC-v0.5.md",
    );
    const v05 = readFileSync(v05Path, "utf-8");
    // v0.5 should NOT contain §9 Runtime Layer
    expect(v05).not.toMatch(/##\s*9\.\s*Runtime\s*Layer/i);
  });
});
