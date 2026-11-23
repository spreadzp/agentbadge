// EPIC-262 (SLICE-262-4): rules-on-envelope engine + WP profile.
// Pure deterministic evaluation over canonical envelopes; findings
// carry evidence_ids (provenance links) and a per-surface axis that
// is NEVER merged (D-UX-Q3).
import { describe, it, expect } from "vitest";
import {
  runRuleset,
  scoreFindings,
  INTEL_WP_PROFILE_V1,
  type IntelRule,
  type IntelFinding,
} from "../../src/server/lib/intel/rules";
import type { CanonicalEnvelope } from "../../src/server/lib/intel/evidence";

// ─── helpers ────────────────────────────────────────────────────────
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
    collected_at: "2026-11-23T10:00:00Z",
    received_at: "2026-11-23T10:00:04Z",
    subject: { type: "site" },
    payload: payload as CanonicalEnvelope["payload"],
    evidence_refs: [],
    signature: { algorithm: "ed25519", key_id: "k", value: "x" },
    ...over,
  };
}

const http = (over: Record<string, unknown> = {}) =>
  ({ type: "http_observation", url: "https://site.test/", status: 200, ...over });
const doc = (doc_type: string, facts: Record<string, unknown> = {}, url = "https://site.test/x") =>
  ({ type: "document_fact", doc_type, url, facts });
const file = (path: string, present: boolean) =>
  ({ type: "file_presence", path, present });

// ─── engine mechanics ───────────────────────────────────────────────
describe("runRuleset — mechanics", () => {
  const ping: IntelRule = {
    rule_id: "T-001",
    version: "1.0.0",
    surface: "readiness",
    severity: "medium",
    name: "test ping",
    select: (e) => e.payload.type === "file_presence",
    evaluate: (m) => ({
      status: m.some((e) => (e.payload as { present: boolean }).present)
        ? "pass"
        : "fail",
      reason: `${m.length} files`,
    }),
  };

  it("selects matching envelopes and links evidence_ids", () => {
    const e1 = env(file("/a", true));
    const e2 = env(http());
    const findings = runRuleset([e1, e2], [ping]);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe("pass");
    expect(findings[0].evidence_ids).toEqual([e1.envelope_id]);
    expect(findings[0].rule_version).toBe("1.0.0");
  });

  it("no matching envelopes → unknown (not fail)", () => {
    const findings = runRuleset([env(http())], [ping]);
    expect(findings[0].status).toBe("unknown");
    expect(findings[0].evidence_ids).toEqual([]);
    expect(findings[0].reason).toMatch(/no evidence/i);
  });

  it("deterministic: same envelopes in any order → identical findings", () => {
    const envs = [env(file("/a", true)), env(http()), env(file("/b", false))];
    const rules = [ping];
    const a = runRuleset(envs, rules);
    const b = runRuleset([...envs].reverse(), rules);
    expect(a).toEqual(b);
  });

  it("findings sorted by rule_id; each carries surface+severity", () => {
    const r2: IntelRule = { ...ping, rule_id: "T-002" };
    const r1: IntelRule = { ...ping, rule_id: "T-001" };
    const findings = runRuleset([env(file("/a", true))], [r2, r1]);
    expect(findings.map((f) => f.rule_id)).toEqual(["T-001", "T-002"]);
    expect(findings[0].surface).toBe("readiness");
    expect(findings[0].severity).toBe("medium");
  });
});

// ─── WP profile shape ───────────────────────────────────────────────
describe("INTEL_WP_PROFILE_V1 — profile contract", () => {
  it("holds 20–30 readiness + 10–15 exposure rules (D-PROD-Q16)", () => {
    const r = INTEL_WP_PROFILE_V1.rules.filter(
      (x) => x.surface === "readiness",
    );
    const x = INTEL_WP_PROFILE_V1.rules.filter(
      (x) => x.surface === "exposure",
    );
    expect(r.length).toBeGreaterThanOrEqual(20);
    expect(r.length).toBeLessThanOrEqual(30);
    expect(x.length).toBeGreaterThanOrEqual(10);
    expect(x.length).toBeLessThanOrEqual(15);
    // namespaces disjoint
    for (const rule of r) expect(rule.rule_id).toMatch(/^AB-INTEL-R-/);
    for (const rule of x) expect(rule.rule_id).toMatch(/^AB-INTEL-X-/);
    const ids = INTEL_WP_PROFILE_V1.rules.map((x) => x.rule_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(INTEL_WP_PROFILE_V1.ruleset_version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("every finding carries exactly one surface — never merged", () => {
    const findings = runRuleset(
      [env(http()), env(file("/wp-content/debug.log", true))],
      INTEL_WP_PROFILE_V1.rules,
    );
    for (const f of findings) {
      expect(["readiness", "exposure"]).toContain(f.surface);
    }
    // no aggregate score leaks into findings
    expect(
      findings.some(
        (f) => !["readiness", "exposure"].includes(f.surface),
      ),
    ).toBe(false);
  });
});

// ─── scoring ────────────────────────────────────────────────────────
describe("scoreFindings — two independent axes (D-UX-Q3)", () => {
  it("readiness and exposure are scored separately", () => {
    const findings = runRuleset(
      [
        env(file("/wp-content/debug.log", true)), // X-001 fails
        env(http({ status: 200, content_type: "text/html" })), // R-001/002/012 pass-ish
      ],
      INTEL_WP_PROFILE_V1.rules,
    );
    const s = scoreFindings(findings, INTEL_WP_PROFILE_V1.ruleset_version);
    expect(s.readiness.surface).toBe("readiness");
    expect(s.exposure.surface).toBe("exposure");
    // exposure dragged down by critical debug.log fail; readiness did
    // not inherit it — axes are independent
    expect(s.exposure.score).toBeLessThan(100);
    expect(s.readiness.score).toBeGreaterThan(s.exposure.score!);
    expect(s.readiness.pass + s.readiness.fail + s.readiness.warn +
      s.readiness.unknown).toBe(
      INTEL_WP_PROFILE_V1.rules.filter((r) => r.surface === "readiness")
        .length,
    );
  });

  it("all-unknown surface → score null, not 0", () => {
    const findings = runRuleset([], INTEL_WP_PROFILE_V1.rules);
    const s = scoreFindings(findings, INTEL_WP_PROFILE_V1.ruleset_version);
    expect(s.readiness.score).toBeNull();
    expect(s.exposure.score).toBeNull();
    expect(s.readiness.unknown).toBe(22);
    expect(s.exposure.unknown).toBe(15);
  });

  it("score is bounded [0,100] and deterministic", () => {
    const envs = [
      env(http({ status: 200, content_type: "text/html" })),
      env(file("/wp-content/debug.log", false)),
      env(file("/.env", true)),
      env(file("/wp-content/plugins/akismet/akismet.php", true)),
    ];
    const a = scoreFindings(
      runRuleset(envs, INTEL_WP_PROFILE_V1.rules),
      "1.0.0",
    );
    const b = scoreFindings(
      runRuleset([...envs].reverse(), INTEL_WP_PROFILE_V1.rules),
      "1.0.0",
    );
    expect(a).toEqual(b);
    for (const v of [a.readiness.score, a.exposure.score]) {
      if (v !== null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it("no merged/combined score exists in the result shape", () => {
    const s = scoreFindings([], "1.0.0");
    expect(Object.keys(s).sort()).toEqual([
      "exposure",
      "readiness",
      "ruleset_version",
    ]);
  });
});

// ─── spot rules ─────────────────────────────────────────────────────
function findById(findings: IntelFinding[], id: string) {
  const f = findings.find((x) => x.rule_id === id);
  expect(f, `finding ${id}`).toBeDefined();
  return f!;
}

describe("readiness rules", () => {
  it("robots blocking all AI agents → fail", () => {
    const findings = runRuleset(
      [
        env(
          doc("robots", { ai_agents_blocked: true }),
          { subject: { type: "url", url: "https://site.test/robots.txt" } },
        ),
      ],
      INTEL_WP_PROFILE_V1.rules,
    );
    expect(findById(findings, "AB-INTEL-R-004").status).toBe("fail");
  });

  it("llms.txt present + non-empty → both pass", () => {
    const findings = runRuleset(
      [
        env(
          doc("llms_txt", { non_empty: true }),
          { subject: { type: "url", url: "https://site.test/llms.txt" } },
        ),
      ],
      INTEL_WP_PROFILE_V1.rules,
    );
    expect(findById(findings, "AB-INTEL-R-007").status).toBe("pass");
    expect(findById(findings, "AB-INTEL-R-008").status).toBe("pass");
  });

  it("ua-matrix: GPTBot 403 → fail on the GPTBot rule", () => {
    const findings = runRuleset(
      [env(http({ ua: "GPTBot", status: 403 }))],
      INTEL_WP_PROFILE_V1.rules,
    );
    const r = findById(findings, "AB-INTEL-R-019");
    expect(r.status).toBe("fail");
    expect(r.evidence_ids).toHaveLength(1);
  });

  it("homepage 200 https html → core readiness pass", () => {
    const findings = runRuleset(
      [
        env(
          http({ status: 200, content_type: "text/html" }),
          { subject: { type: "url", url: "https://site.test/" } },
        ),
      ],
      INTEL_WP_PROFILE_V1.rules,
    );
    expect(findById(findings, "AB-INTEL-R-001").status).toBe("pass");
    expect(findById(findings, "AB-INTEL-R-002").status).toBe("pass");
  });
});

describe("exposure rules — presence inverts to fail", () => {
  it("debug.log present → fail; absent → pass", () => {
    const bad = runRuleset(
      [env(file("/wp-content/debug.log", true))],
      INTEL_WP_PROFILE_V1.rules,
    );
    expect(findById(bad, "AB-INTEL-X-001").status).toBe("fail");
    const good = runRuleset(
      [env(file("/wp-content/debug.log", false))],
      INTEL_WP_PROFILE_V1.rules,
    );
    expect(findById(good, "AB-INTEL-X-001").status).toBe("pass");
  });

  it("rest users enumeration 200 → fail", () => {
    const findings = runRuleset(
      [
        env(
          http({ url: "https://site.test/wp-json/wp/v2/users", status: 200 }),
        ),
      ],
      INTEL_WP_PROFILE_V1.rules,
    );
    expect(findById(findings, "AB-INTEL-X-004").status).toBe("fail");
  });

  it("WP_DEBUG option truthy → fail (plugin self-report)", () => {
    const findings = runRuleset(
      [
        env(
          {
            type: "wp_option_read",
            name: "WP_DEBUG",
            value: true,
          },
          { subject: { type: "wp_option", name: "WP_DEBUG" } },
        ),
      ],
      INTEL_WP_PROFILE_V1.rules,
    );
    expect(findById(findings, "AB-INTEL-X-009").status).toBe("fail");
  });

  it("server header leaks version → fail", () => {
    const findings = runRuleset(
      [
        env(
          http({
            headers: { server: "Apache/2.4.54 (Ubuntu)" },
          }),
        ),
      ],
      INTEL_WP_PROFILE_V1.rules,
    );
    expect(findById(findings, "AB-INTEL-X-013").status).toBe("fail");
  });
});
