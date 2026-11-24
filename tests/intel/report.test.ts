// EPIC-262 (SLICE-262-5): canonical intel report — schema, signature
// roundtrip, two independent scores, evidence freshness summary.
import { describe, it, expect } from "vitest";
import {
  assembleIntelReport,
  verifyIntelReport,
  intelReportSchema,
} from "../../src/server/lib/intel/report";
import { INTEL_WP_PROFILE_V1 } from "../../src/server/lib/intel/rules";
import type { CanonicalEnvelope } from "../../src/server/lib/intel/evidence";
import { resolveIntelSigningKey } from "../../src/server/lib/intel/keys";

const KEY = resolveIntelSigningKey({
  signingPrivateKey: Buffer.alloc(32, 7).toString("base64"),
  keyId: "test-key",
} as never)!;

let seq = 0;
function env(payload: unknown, over: Partial<CanonicalEnvelope> = {}): CanonicalEnvelope {
  seq += 1;
  return {
    schema_version: "1.0",
    envelope_id: `env_${String(seq).padStart(4, "0")}`,
    scan_id: "scan_1",
    site_id: "site_t",
    collector: { type: "wp_plugin", id: "wp_plugin@site_t", version: "1" },
    verifier: { id: "b", check_type: "schema-and-channel" },
    provenance: "PLUGIN_SELF_REPORTED",
    collected_at: "2026-11-20T10:00:00Z",
    received_at: "2026-11-20T10:00:04Z",
    subject: { type: "site" },
    payload: payload as CanonicalEnvelope["payload"],
    evidence_refs: [],
    signature: { algorithm: "ed25519", key_id: "k", value: "x" },
    ...over,
  };
}

const sampleEnvs = () => [
  env({
    type: "http_observation",
    url: "https://site.test/",
    status: 200,
    content_type: "text/html",
    headers: { server: "nginx" },
  }),
  env(
    { type: "file_presence", path: "/wp-content/debug.log", present: true },
    {
      collected_at: "2026-11-20T10:00:01Z",
      received_at: "2026-11-20T10:00:05Z",
      provenance: "EXTERNAL_OBSERVED",
      collector: { type: "external_scan", id: "scan-1", version: "1" },
    },
  ),
];

function assemble(over: Record<string, unknown> = {}) {
  return assembleIntelReport(sampleEnvs(), {
    site_id: "site_t",
    scan_id: "scan_1",
    completeness: "complete",
    generated_at: "2026-11-20T10:05:00Z",
    report_id: "01KABCDEFGHJKMNPQRSTVWXYZ0",
    previous_hash: null,
    ruleset: INTEL_WP_PROFILE_V1,
    key: KEY,
    ...over,
  } as never);
}

describe("assembleIntelReport", () => {
  it("produces a schema-valid signed report", () => {
    const report = assemble();
    const parsed = intelReportSchema.safeParse(report);
    expect(parsed.success).toBe(true);
    expect(report.report_id).toBe("01KABCDEFGHJKMNPQRSTVWXYZ0");
    expect(report.ruleset.version).toBe("1.1.0");
    expect(report.scan.completeness).toBe("complete");
    expect(report.integrity.signature.algorithm).toBe("ed25519");
    expect(report.integrity.signature.value).toBeTruthy();
    expect(report.integrity.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("verify roundtrip: ok with the same public key", () => {
    const report = assemble();
    const res = verifyIntelReport(report, [KEY]);
    expect(res).toEqual({ ok: true, report });
  });

  it("two independent scores — no merged key", () => {
    const report = assemble();
    expect(Object.keys(report.scores).sort()).toEqual([
      "exposure",
      "readiness",
    ]);
    expect(report.scores.exposure.score).toBeLessThan(
      report.scores.readiness.score!,
    );
  });

  it("evidence summary: count, time bounds, provenance counts", () => {
    const report = assemble();
    expect(report.evidence.envelope_count).toBe(2);
    expect(report.evidence.collected_at_min).toBe("2026-11-20T10:00:00Z");
    expect(report.evidence.received_at_max).toBe("2026-11-20T10:00:05Z");
    expect(report.evidence.provenance.PLUGIN_SELF_REPORTED).toBe(1);
    expect(report.evidence.provenance.EXTERNAL_OBSERVED).toBe(1);
  });

  it("completeness partial is propagated, not decided", () => {
    const report = assemble({ completeness: "partial" });
    expect(report.scan.completeness).toBe("partial");
  });

  it("previous_hash round-trips and validates", () => {
    const report = assemble({
      previous_hash: `sha256:${"a".repeat(64)}`,
    });
    expect(report.previous_hash).toBe(`sha256:${"a".repeat(64)}`);
    expect(intelReportSchema.safeParse(report).success).toBe(true);
  });

  it("deterministic: same envelopes → identical findings+scores", () => {
    const envs = sampleEnvs();
    const a = assembleIntelReport(envs, {
      site_id: "site_t", scan_id: "scan_1", completeness: "complete",
      generated_at: "2026-11-20T10:05:00Z",
      report_id: "01KABCDEFGHJKMNPQRSTVWXYZ0",
      previous_hash: null, ruleset: INTEL_WP_PROFILE_V1, key: KEY,
    });
    const b = assembleIntelReport(envs, {
      site_id: "site_t", scan_id: "scan_1", completeness: "complete",
      generated_at: "2026-11-20T10:05:00Z",
      report_id: "01KABCDEFGHJKMNPQRSTVWXYZ0",
      previous_hash: null, ruleset: INTEL_WP_PROFILE_V1, key: KEY,
    });
    expect(a.findings).toEqual(b.findings);
    expect(a.scores).toEqual(b.scores);
    expect(a.evidence).toEqual(b.evidence);
  });
});

describe("verifyIntelReport — tamper resistance", () => {
  it("mutated findings → bad_signature", () => {
    const report = assemble();
    const tampered = {
      ...report,
      findings: report.findings.map((f) => ({ ...f, status: "pass" })),
    };
    const res = verifyIntelReport(tampered, [KEY]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("bad_signature");
  });

  it("unknown key_id → unknown_key_id", () => {
    const report = assemble();
    const res = verifyIntelReport(report, [
      { keyId: "other", publicKey: KEY.publicKey },
    ]);
    expect(res).toEqual({ ok: false, error: "unknown_key_id" });
  });

  it("wrong structure → invalid_report", () => {
    expect(verifyIntelReport({ hello: 1 }, [KEY]).ok).toBe(false);
  });
});
