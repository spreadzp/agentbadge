// EPIC-262 (SLICE-262-16): registry drift gate — the JSON spec in
// docs/EPICS/.../spec/pull-protocol is the SOURCE OF TRUTH the PHP
// plugin consumes verbatim; registry.ts must never drift from it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PULL_PROTOCOL_LIMITS,
  CONST_WHITELIST,
  OPTION_WHITELIST,
  PHPINFO_FIELDS,
  CAPABILITY_PROBE_IDS,
} from "../../src/server/lib/intel/pull";

const spec = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../docs/EPICS/262-agent-surface-intelligence/spec/pull-protocol/capability-registry.v1.json",
        import.meta.url,
      ),
    ),
    "utf8",
  ),
) as {
  limits: Record<string, number>;
  const_whitelist: string[];
  option_whitelist: Record<
    string,
    { type: string; enum?: number[]; values?: string[]; max?: number; emit?: string }
  >;
  capabilities: { probe_id: string; result?: Record<string, string> }[];
};

describe("pull registry ⇄ spec parity", () => {
  it("limits match the spec byte-for-byte", () => {
    expect(spec.limits).toEqual({
      params_max_bytes: PULL_PROTOCOL_LIMITS.paramsMaxBytes,
      result_max_bytes: PULL_PROTOCOL_LIMITS.resultMaxBytes,
      string_max_chars: PULL_PROTOCOL_LIMITS.stringMaxChars,
      results_per_job: PULL_PROTOCOL_LIMITS.resultsPerJob,
      capability_max_exec_ms: PULL_PROTOCOL_LIMITS.capabilityMaxExecMs,
      lease_seconds: PULL_PROTOCOL_LIMITS.leaseSeconds,
      job_ttl_seconds: PULL_PROTOCOL_LIMITS.jobTtlSeconds,
      max_reclaims: PULL_PROTOCOL_LIMITS.maxReclaims,
    });
  });

  it("const_whitelist is identical", () => {
    expect([...CONST_WHITELIST]).toEqual(spec.const_whitelist);
  });

  it("option_whitelist field specs are identical", () => {
    expect(Object.keys(OPTION_WHITELIST).sort()).toEqual(
      Object.keys(spec.option_whitelist).sort(),
    );
    for (const [name, field] of Object.entries(OPTION_WHITELIST)) {
      const s = spec.option_whitelist[name];
      expect(s.type).toBe(field.type);
      if (field.enum) expect(s.enum).toEqual([...field.enum]);
      if (field.values) expect(s.values).toEqual([...field.values]);
      if (field.max) expect(s.max).toBe(field.max);
      if (field.emit) expect(s.emit).toBe(field.emit);
    }
  });

  it("capability probe ids + phpinfo result fields are identical", () => {
    expect([...CAPABILITY_PROBE_IDS].sort()).toEqual(
      spec.capabilities.map((c) => c.probe_id).sort(),
    );
    const phpinfo = spec.capabilities.find((c) => c.probe_id === "phpinfo_summary");
    expect(Object.keys(phpinfo!.result!).sort()).toEqual(
      [...PHPINFO_FIELDS].sort(),
    );
  });
});
