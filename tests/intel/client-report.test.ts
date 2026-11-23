// EPIC-262 (SLICE-262-11): client report — canonical immutability,
// lifecycle transitions, editorial versioning, delta, markdown.
import { describe, it, expect } from "vitest";
import {
  computeDelta,
  editEditorial,
  generateClientReport,
  renderClientMarkdown,
  snapshotCanonical,
  transition,
  createMemoryIntelClientReportStore,
  type ClientReport,
} from "../../src/server/lib/intel/client-report";
import type { IntelReport } from "../../src/server/lib/intel/report";
import type { ScanJob } from "../../src/server/lib/intel/scan";

const mkReport = (over: Partial<IntelReport> = {}): IntelReport => ({
  schema_version: "1.0",
  report_id: "01J8ZZZZZZZZZZZZZZZZZZZZZZ",
  site_id: "site_1",
  ruleset: { name: "intel-wp-profile", version: "1" },
  scan: {
    scan_id: "scan_1",
    completeness: "complete",
    generated_at: "2026-11-20T10:00:00Z",
  },
  evidence: {
    envelope_count: 18,
    collected_at_min: "2026-11-20T10:00:00Z",
    received_at_max: "2026-11-20T10:01:00Z",
    provenance: { EXTERNAL_OBSERVED: 18 },
  },
  findings: [
    {
      rule_id: "AB-INTEL-X-001", rule_version: "1", surface: "exposure",
      severity: "high", name: "debug.log exposed", status: "fail",
      claim: "c", reason: "r", evidence_ids: ["env_1"],
    },
    {
      rule_id: "AB-INTEL-R-004", rule_version: "1", surface: "readiness",
      severity: "medium", name: "robots", status: "pass",
      claim: "c", reason: "r", evidence_ids: ["env_2"],
    },
  ],
  scores: {
    readiness: { surface: "readiness", score: 82, evaluable: 20, pass: 16, fail: 3, warn: 0, unknown: 1 },
    exposure: { surface: "exposure", score: 34, evaluable: 10, pass: 6, fail: 3, warn: 0, unknown: 1 },
  },
  previous_hash: null,
  integrity: {
    content_hash: `sha256:${"a".repeat(64)}`,
    signature: { algorithm: "ed25519", key_id: "k1", value: "sig" },
  },
  ...over,
});

const mkJob = (report: IntelReport | null = mkReport()): ScanJob => ({
  id: "job_1", siteId: "site_1", tenantId: "tnt_1", scanId: "scan_1",
  status: "complete", baseUrl: "https://bakery.com",
  probeFailures: 0, probeTotal: 18, error: null,
  reportId: report?.report_id ?? null, report,
  createdAt: "2026-11-20T10:00:00Z", updatedAt: "x", finishedAt: "x",
});

const mkClientReport = (over: Partial<ClientReport> = {}): ClientReport => ({
  id: "cr_1", siteId: "site_1", tenantId: "tnt_1", period: "2026-10",
  status: "GENERATED",
  canonical: snapshotCanonical(mkJob(mkReport()),
    mkReport({
      report_id: "01J8YYYYYYYYYYYYYYYYYYYYYY",
      scores: {
        readiness: { surface: "readiness", score: 76, evaluable: 20, pass: 15, fail: 4, warn: 0, unknown: 1 },
        exposure: { surface: "exposure", score: 46, evaluable: 10, pass: 5, fail: 4, warn: 0, unknown: 1 },
      },
      findings: [
        { rule_id: "AB-INTEL-X-001", rule_version: "1", surface: "exposure", severity: "high", name: "n", status: "fail", claim: "c", reason: "r", evidence_ids: ["e"] },
        { rule_id: "AB-INTEL-X-009", rule_version: "1", surface: "exposure", severity: "medium", name: "n", status: "warn", claim: "c", reason: "r", evidence_ids: ["e"] },
      ],
    })),
  delta: null,
  editorial: { version: 1, heroLine: "", whatChanged: "", nextMonth: "", internalNote: "", editedBy: "op_1", editedAt: "2026-10-20T00:00:00Z" },
  editorialHistory: [],
  approvedBy: null, sentBy: null, sentAt: null,
  createdAt: "2026-10-20T00:00:00Z", updatedAt: "x",
  ...over,
});

describe("generateClientReport", () => {
  it("canonical snapshot immutable + open rule ids + period from report month", () => {
    const cr = generateClientReport({
      siteId: "site_1", tenantId: "tnt_1", job: mkJob(), prev: null, operatorId: "op_1",
    });
    expect(cr.period).toBe("2026-11");
    expect(cr.status).toBe("GENERATED");
    expect(cr.canonical.openFindingRuleIds).toEqual(["AB-INTEL-X-001"]);
    expect(cr.canonical.findingCounts.fail).toBe(1);
    expect(cr.delta).toBeNull(); // first period
  });

  it("delta vs prev same ruleset: score deltas + new/closed rule ids", () => {
    const prev = mkClientReport(); // period 2026-10, open: X-001 fail + X-009 warn
    const cr = generateClientReport({
      siteId: "site_1", tenantId: "tnt_1", job: mkJob(), prev, operatorId: "op_1",
    });
    expect(cr.delta).not.toBeNull();
    expect(cr.delta!.readinessDelta).toBe(6); // 82-76
    expect(cr.delta!.exposureDelta).toBe(-12); // 34-46
    expect(cr.delta!.closedRuleIds).toEqual(["AB-INTEL-X-009"]);
    expect(cr.delta!.newOpenRuleIds).toEqual([]);
  });

  it("ruleset change → delta null even with prev", () => {
    const prev = mkClientReport();
    prev.canonical.ruleset.version = "0";
    const cur = snapshotCanonical(mkJob(), mkReport());
    expect(computeDelta(prev, cur)).toBeNull();
  });
});

describe("lifecycle", () => {
  it("forward-only: GENERATED→IN_REVIEW→APPROVED→SENT", () => {
    let r = mkClientReport();
    r = transition(r, "IN_REVIEW", "op_1");
    expect(r.status).toBe("IN_REVIEW");
    r = transition(r, "APPROVED", "op_1");
    expect(r.approvedBy).toBe("op_1");
    r = transition(r, "SENT", "op_1");
    expect(r.sentAt).toBeTruthy();
  });

  it("illegal transitions throw", () => {
    const r = mkClientReport();
    expect(() => transition(r, "APPROVED", "op")).toThrow(/illegal_transition/);
    expect(() => transition(r, "GENERATED", "op")).toThrow(/illegal_transition/);
    const sent = { ...mkClientReport(), status: "SENT" as const };
    expect(() => transition(sent, "IN_REVIEW", "op")).toThrow(/illegal_transition/);
  });
});

describe("editorial", () => {
  it("edit bumps version, archives prior, canonical untouched", () => {
    const r = mkClientReport();
    const hashBefore = r.canonical.contentHash;
    const edited = editEditorial(r, {
      heroLine: "Your site is ready for AI agents.",
      whatChanged: "- debug.log closed",
      nextMonth: "1 fix pending",
      internalNote: "ask about plan",
    }, "op_1");
    expect(edited.editorial.version).toBe(2);
    expect(edited.editorialHistory).toHaveLength(1);
    expect(edited.editorialHistory[0].version).toBe(1);
    expect(edited.canonical.contentHash).toBe(hashBefore);
  });

  it("SENT → edit throws", () => {
    const r = { ...mkClientReport(), status: "SENT" as const };
    expect(() => editEditorial(r, { heroLine: "x", whatChanged: "", nextMonth: "", internalNote: "" }, "op"))
      .toThrow(/report_sent/);
  });
});

describe("markdown", () => {
  it("hero slot, two scores with deltas, details + integrity, next month", () => {
    const prev = mkClientReport();
    let r = generateClientReport({
      siteId: "site_1", tenantId: "tnt_1", job: mkJob(), prev, operatorId: "op_1",
    });
    r = editEditorial(r, {
      heroLine: "Your site is ready for AI agents.",
      whatChanged: "- debug.log removed",
      nextMonth: "1 fix pending",
      internalNote: "internal only",
    }, "op_1");
    const md = renderClientMarkdown(r, "bakery.com");
    expect(md).toContain("# Agent Surface Report — bakery.com");
    expect(md).toContain("Your site is ready");
    expect(md).toContain("Agent readiness");
    expect(md).toContain("▲6");
    expect(md).toContain("▼12");
    expect(md).toContain("resolved: `AB-INTEL-X-009`");
    expect(md).toContain("ed25519");
    expect(md).toContain("signature proves this report was not modified");
    expect(md).toContain("1 fix pending");
    expect(md).not.toContain("internal only"); // internalNote never renders
  });

  it("no prev → first period, not fake zero deltas", () => {
    const r = generateClientReport({
      siteId: "site_1", tenantId: "tnt_1", job: mkJob(), prev: null, operatorId: "op_1",
    });
    const md = renderClientMarkdown(r, "bakery.com");
    expect(md).toContain("first period");
    expect(md).not.toContain("▲");
  });
});

describe("store", () => {
  it("latestBeforePeriod picks newest prior period", async () => {
    const store = createMemoryIntelClientReportStore();
    await store.insert(mkClientReport({ id: "cr_old", period: "2026-09" }));
    await store.insert(mkClientReport({ id: "cr_prev", period: "2026-10" }));
    expect((await store.latestBeforePeriod("site_1", "2026-11"))!.id).toBe("cr_prev");
    expect(await store.latestBeforePeriod("site_1", "2026-09")).toBeNull();
  });
});
