import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * SLICE-99-1: Spec v0.7 cross-check — doc-presence lint.
 *
 * Verifies that AGENT-READINESS-SPEC-v0.7.md exists and contains
 * all required §10 sections, A.8 appendix, and changelog entry.
 * Pattern: 94-1/95-1/96-1/98-1 doc-presence lint.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = join(process.cwd(), "..", "..", "docs", "EPICS", "32-agent-readiness-spec", "spec", "AGENT-READINESS-SPEC-v0.7.md");

function readSpec(): string {
  if (!existsSync(SPEC_PATH)) {
    throw new Error(`Spec v0.7 not found at ${SPEC_PATH}`);
  }
  return readFileSync(SPEC_PATH, "utf-8");
}

describe("SLICE-99-1: Spec v0.7 — Monitoring Layer cross-check", () => {
  let spec: string;

  it("spec v0.7 file exists", () => {
    spec = readSpec();
    expect(spec.length).toBeGreaterThan(1000);
  });

  it("contains §10.1 MonitoredProject", () => {
    spec = readSpec();
    expect(spec).toMatch(/§10\.1.*MonitoredProject/);
    expect(spec).toMatch(/project_id/);
    expect(spec).toMatch(/schedule.*daily.*weekly/);
    expect(spec).toMatch(/hour_utc/);
    expect(spec).toMatch(/day_of_week/);
    expect(spec).toMatch(/next_run_at/);
  });

  it("contains §10.2 RunRecord", () => {
    spec = readSpec();
    expect(spec).toMatch(/§10\.2.*RunRecord/);
    expect(spec).toMatch(/run_id/);
    expect(spec).toMatch(/trigger.*scheduled.*manual/);
    expect(spec).toMatch(/outcome.*ok.*error/);
    expect(spec).toMatch(/report_ref/);
  });

  it("contains §10.3 RegressionReport with 6 rules", () => {
    spec = readSpec();
    expect(spec).toMatch(/§10\.3.*RegressionReport/);
    const rules = ["score_drop", "new_gap", "reopened_gap", "status_flip", "new_conflict", "asr_drop"];
    for (const rule of rules) {
      expect(spec).toContain(rule);
    }
    expect(spec).toMatch(/reopened_gap.*absent.*prev.*present.*history/);
  });

  it("contains §10.4 Alerts with 4 channel types", () => {
    spec = readSpec();
    expect(spec).toMatch(/§10\.4.*Alerts/);
    const channels = ["webhook", "discord", "telegram", "email"];
    for (const ch of channels) {
      expect(spec).toContain(ch);
    }
    expect(spec).toMatch(/dedupe_key/);
    expect(spec).toMatch(/cooldown/);
    expect(spec).toMatch(/HMAC/);
  });

  it("contains §10.5 Tier gating", () => {
    spec = readSpec();
    expect(spec).toMatch(/§10\.5.*Tier.*gating/);
    expect(spec).toMatch(/free.*1.*project/);
    expect(spec).toMatch(/paid.*unlimited/);
  });

  it("contains §10.6 Storage & scheduler", () => {
    spec = readSpec();
    expect(spec).toMatch(/§10\.6.*Storage.*scheduler/);
    expect(spec).toMatch(/tick-loop|tick.loop/);
    expect(spec).toMatch(/next_run_at/);
    expect(spec).toMatch(/per-project.*lock/);
  });

  it("contains Appendix A.8 Monitoring JSON Schemas", () => {
    spec = readSpec();
    expect(spec).toMatch(/A\.8.*Monitoring/);
    expect(spec).toMatch(/MonitoredProject.*schema|schema.*MonitoredProject/);
    expect(spec).toMatch(/RunRecord.*schema|schema.*RunRecord/);
  });

  it("contains changelog v0.6 → v0.7", () => {
    spec = readSpec();
    expect(spec).toMatch(/v0\.6.*v0\.7/);
    expect(spec).toContain("Additive");
    expect(spec).toContain("§10");
  });

  it("v0.6 content preserved (§9 Runtime Layer still present)", () => {
    spec = readSpec();
    expect(spec).toMatch(/§9.*Runtime/);
    expect(spec).toContain("RT-01");
    expect(spec).toContain("ExecutionTrace");
  });

  it("default constants documented: score_drop=5, cooldown=24h, free=1 project", () => {
    spec = readSpec();
    expect(spec).toMatch(/score_drop.*5|threshold.*5.*score/);
    expect(spec).toMatch(/cooldown.*24/);
    expect(spec).toMatch(/free.*1.*project/);
  });
});
