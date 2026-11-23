// EPIC-262 (SLICE-262-12): MoM delta — rule-status diff semantics,
// report-level delta under ruleset compat, previous_hash chain.
import { describe, it, expect } from "vitest";
import {
  computeMoMDelta,
  diffRuleStatuses,
  ruleStatusMap,
  rulesetsCompatible,
} from "../../src/server/lib/intel/delta";
import { runScanJob, SCAN_PLAN } from "../../src/server/lib/intel/scan";
import type { ScanJob, ScanFetch } from "../../src/server/lib/intel/scan";
import { createMemoryScanJobStore } from "../../src/server/lib/intel/scan/memory";
import { createMemoryIntelEvidenceStore } from "../../src/server/lib/intel/evidence/store";
import { INTEL_WP_PROFILE_V1 } from "../../src/server/lib/intel/rules";
import { resolveIntelSigningKey } from "../../src/server/lib/intel/keys";
import type { IntelEnvConfig } from "../../src/config/env";
import type { IntelReport } from "../../src/server/lib/intel/report";

const key = resolveIntelSigningKey({
  enabled: true,
  keyId: "intel-test-1",
  signingPrivateKey: Buffer.alloc(32, 7).toString("base64"),
} as IntelEnvConfig)!;

describe("diffRuleStatuses", () => {
  it("new/closed/still-open/transitions semantics", () => {
    const diff = diffRuleStatuses(
      { a: "fail", b: "warn", c: "pass", d: "fail" },
      { a: "fail", b: "pass", c: "fail", e: "warn" },
    );
    expect(diff.stillOpen).toEqual(["a"]);
    expect(diff.closed).toEqual(["b", "d"]); // d vanished → resolved
    expect(diff.newOpen.sort()).toEqual(["c", "e"]);
    expect(diff.transitions).toEqual([
      { rule_id: "b", from: "warn", to: "pass" },
      { rule_id: "c", from: "pass", to: "fail" },
    ]);
  });

  it("warn→fail is a transition but stays still-open", () => {
    const diff = diffRuleStatuses({ a: "warn" }, { a: "fail" });
    expect(diff.stillOpen).toEqual(["a"]);
    expect(diff.newOpen).toEqual([]);
    expect(diff.closed).toEqual([]);
    expect(diff.transitions).toEqual([{ rule_id: "a", from: "warn", to: "fail" }]);
  });
});

const mkReport = (
  findings: { id: string; status: "pass" | "fail" | "warn" | "unknown" }[],
  rScore = 80,
  xScore = 40,
  rulesetVersion = "1",
): IntelReport => ({
  schema_version: "1.0",
  report_id: "01J8ZZZZZZZZZZZZZZZZZZZZZZ",
  site_id: "s",
  ruleset: { name: "agent-surface-wp", version: rulesetVersion },
  scan: { scan_id: "scan_1", completeness: "complete", generated_at: "2026-11-01T00:00:00Z" },
  evidence: { envelope_count: 1, collected_at_min: null, received_at_max: null, provenance: {} },
  findings: findings.map((f) => ({
    rule_id: f.id, rule_version: "1", surface: "readiness", severity: "low",
    name: f.id, status: f.status, claim: "c", reason: "r", evidence_ids: [],
  })),
  scores: {
    readiness: { surface: "readiness", score: rScore, evaluable: 1, pass: 1, fail: 0, warn: 0, unknown: 0 },
    exposure: { surface: "exposure", score: xScore, evaluable: 1, pass: 1, fail: 0, warn: 0, unknown: 0 },
  },
  previous_hash: null,
  integrity: { content_hash: `sha256:${"b".repeat(64)}`, signature: { algorithm: "ed25519", key_id: "k", value: "v" } },
});

describe("computeMoMDelta", () => {
  const prev = mkReport([
    { id: "a", status: "fail" },
    { id: "b", status: "pass" },
  ], 70, 50);
  const cur = mkReport([
    { id: "a", status: "pass" },
    { id: "b", status: "fail" },
  ], 80, 40);

  it("score deltas both axes + rule diff", () => {
    const d = computeMoMDelta(prev, cur)!;
    expect(d.readinessDelta).toBe(10);
    expect(d.exposureDelta).toBe(-10);
    expect(d.closed).toEqual(["a"]);
    expect(d.newOpen).toEqual(["b"]);
    expect(d.stillOpen).toEqual([]);
    expect(d.transitions).toHaveLength(2);
  });

  it("ruleset change → null; no prev → null", () => {
    expect(computeMoMDelta(mkReport([], 0, 0, "2"), cur)).toBeNull();
    expect(computeMoMDelta(null, cur)).toBeNull();
    expect(rulesetsCompatible({ name: "x", version: "1" }, { name: "x", version: "1" })).toBe(true);
    expect(ruleStatusMap(cur)).toEqual({ a: "pass", b: "fail" });
  });
});

describe("previous_hash chain", () => {
  const mkJob = (id: string, createdAt: string): ScanJob => ({
    id, siteId: "site_c", tenantId: "tnt_c", scanId: `scan_${id}`,
    status: "queued", baseUrl: "https://x.com", probeFailures: 0,
    probeTotal: SCAN_PLAN.length, error: null, reportId: null, report: null,
    createdAt, updatedAt: createdAt, finishedAt: null,
  });
  const fetch_: ScanFetch = async () => ({ status: 200, headers: {}, bodyText: "ok", resolvedIp: "1.1.1.1" });
  const depsFor = (jobs: ReturnType<typeof createMemoryScanJobStore>) => ({
    fetch: fetch_, evidence: createMemoryIntelEvidenceStore(), jobs,
    key, ruleset: INTEL_WP_PROFILE_V1,
  });

  it("genesis null; second report links first report's hash", async () => {
    const jobs = createMemoryScanJobStore();
    const j1 = await jobs.insert(mkJob("job_1", "2026-11-01T00:00:00Z"));
    const r1 = await runScanJob(j1, depsFor(jobs));
    expect(r1.report!.previous_hash).toBeNull();

    const j2 = await jobs.insert(mkJob("job_2", "2026-11-02T00:00:00Z"));
    const r2 = await runScanJob(j2, depsFor(jobs));
    expect(r2.report!.previous_hash).toBe(r1.report!.integrity.content_hash);
  });

  it("failed prior job (no report) does not chain", async () => {
    const jobs = createMemoryScanJobStore();
    const failJob = await jobs.insert({
      ...mkJob("job_f", "2026-11-01T00:00:00Z"),
      status: "failed",
    });
    await jobs.update(failJob);
    const j = await jobs.insert(mkJob("job_ok", "2026-11-02T00:00:00Z"));
    const r = await runScanJob(j, depsFor(jobs));
    expect(r.report!.previous_hash).toBeNull();
  });
});
