import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * SLICE-96-1: Spec v0.5 — Gap Entity & Derivation Rules
 *
 * Spec-as-document lint: verifies that AGENT-READINESS-SPEC-v0.5.md
 * contains §8 Gap Model with:
 * - Gap entity field table
 * - 4 gap types (documentation, semantic, capability, evidence)
 * - 4 priority levels (CRITICAL, HIGH, MEDIUM, LOW)
 * - Derivation rules for all 5 assertion statuses
 * - gap_id format regex
 * - §8.2 priority function pseudocode + worked example
 * - §8.3 fix hints
 * - Appendix A.6 Gap JSON Schema
 * - Changelog v0.4 → v0.5 (additive only)
 */

const specPath = resolve(
  __dirname,
  "../../../../../docs/EPICS/32-agent-readiness-spec/spec/AGENT-READINESS-SPEC-v0.5.md",
);
const spec = readFileSync(specPath, "utf-8");

describe("SLICE-96-1: Spec v0.5 — Gap Model", () => {
  it("spec file exists and is non-empty", () => {
    expect(spec.length).toBeGreaterThan(5000);
  });

  it("has version 0.5 header", () => {
    expect(spec).toMatch(/Version.*0\.5/i);
  });

  it("has §8 Gap Model section", () => {
    expect(spec).toMatch(/## 8\. Gap Model/i);
  });

  it("has gap entity field table with all required fields", () => {
    const requiredFields = [
      "gap_id",
      "type",
      "title",
      "description",
      "priority",
      "priority_reason",
      "related_rules",
      "evidence_refs",
      "fix_hint",
      "fix_artifacts",
      "pillar",
      "category",
      "frequency",
    ];
    for (const field of requiredFields) {
      expect(spec, `missing field: ${field}`).toContain(`\`gap_id\``);
      expect(spec, `missing field: ${field}`).toContain(`\`${field}\``);
    }
  });

  it("defines 4 gap types", () => {
    const types = ["documentation", "semantic", "capability", "evidence"];
    for (const t of types) {
      expect(spec, `missing gap type: ${t}`).toContain(t);
    }
  });

  it("defines 4 priority levels", () => {
    const priorities = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
    for (const p of priorities) {
      expect(spec, `missing priority: ${p}`).toContain(p);
    }
  });

  it("has derivation rules for all 5 assertion statuses", () => {
    const statuses = ["VERIFIED", "INFERRED", "GAP", "CONFLICT", "NOT_APPLICABLE"];
    for (const s of statuses) {
      expect(spec, `missing derivation rule for: ${s}`).toContain(s);
    }
  });

  it("GAP → gap candidate; CONFLICT → evidence gap; others → no gap", () => {
    expect(spec).toMatch(/GAP.*gap candidate/i);
    expect(spec).toMatch(/CONFLICT.*evidence.*gap/i);
    // Derivation table: VERIFIED/INFERRED/NOT_APPLICABLE → **No**
    expect(spec).toMatch(/VERIFIED.*\*\*No\*\*/i);
    expect(spec).toMatch(/INFERRED.*\*\*No\*\*/i);
  });

  it("specifies gap_id format with regex", () => {
    expect(spec).toContain('gap_id');
    expect(spec).toContain('gap:{type}:{topic}');
    expect(spec).toMatch(/\^gap:\(documentation\|semantic\|capability\|evidence\):\[a-z_\]\+\$/);
  });

  it("states stability guarantee for gap_id", () => {
    expect(spec).toMatch(/stable.*scan|rescan.*diff|deterministic.*gap_id/i);
  });

  it("has §8.2 priority function", () => {
    expect(spec).toMatch(/§8\.2.*[Pp]riority/i);
  });

  it("priority function uses severity, impact, frequency, floor, clamp", () => {
    const terms = ["severity", "impact", "frequency", "floor", "clamp"];
    for (const term of terms) {
      expect(spec, `missing priority term: ${term}`).toContain(term);
    }
  });

  it("has worked example for priority", () => {
    expect(spec).toMatch(/worked example|example.*priority/i);
  });

  it("has §8.3 fix hints", () => {
    expect(spec).toMatch(/§8\.3.*[Ff]ix.*hint/i);
  });

  it("fix hints define deterministic / assisted / manual semantics", () => {
    expect(spec).toMatch(/documentation.*deterministic/i);
    expect(spec).toMatch(/semantic.*assisted/i);
    expect(spec).toMatch(/capability.*manual|evidence.*manual/i);
  });

  it("has Appendix A.6 Gap JSON Schema", () => {
    expect(spec).toMatch(/A\.6.*[Gg]ap.*[Ss]chema/i);
  });

  it("has changelog v0.4 → v0.5", () => {
    expect(spec).toMatch(/v0\.4.*v0\.5|0\.4.*0\.5/i);
  });

  it("changelog is additive only (no renames)", () => {
    expect(spec).toMatch(/additive/i);
  });

  it("v0.4 spec is untouched (v0.5 is a separate file)", () => {
    const v04Path = resolve(
      __dirname,
      "../../../../../docs/EPICS/32-agent-readiness-spec/spec/AGENT-READINESS-SPEC-v0.4.md",
    );
    const v04 = readFileSync(v04Path, "utf-8");
    // v0.4 should NOT contain §8 Gap Model
    expect(v04).not.toMatch(/##.*§8.*Gap Model/i);
  });
});
