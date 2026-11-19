/**
 * SLICE-255-6: consolidated report — joins the four results
 * artifacts into report.json (machine) + report.md (human).
 * Deterministic: no timestamps, re-run produces identical bytes.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";

import { corpusSha256 } from "./lib/corpus";
import { buildReport, renderMarkdown } from "./lib/report-gen";
import type { VectorResult } from "./lib/result";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const results = (name: string) =>
  JSON.parse(
    readFileSync(path.join(DIR, "results", name), "utf8"),
  ) as VectorResult[];

const spend = results("spend.json");
const lifecycle = results("lifecycle.json");
const crypto = results("crypto.json");
const own = JSON.parse(
  readFileSync(path.join(DIR, "results", "own-invariants.json"), "utf8"),
) as {
  race: {
    db_barrier: { overshootUsd: number; allowed: number; n: number };
    memory_stress: { overshootUsd: number; allowed: number; n: number };
  };
  findings: Array<{ id: string; title: string; severity: string }>;
};

describe("SLICE-255-6 consolidated report", () => {
  const sha = corpusSha256();
  const report = buildReport([...spend, ...lifecycle, ...crypto], sha);

  it("splits metrics per decision — never a single 92/92", () => {
    expect(report.summary["spend-decision"].n).toBe(36);
    expect(report.summary["delegation"].n).toBe(18);
    expect(report.summary["lifecycle"].n).toBe(29);
    expect(report.summary["crypto-evidence"].n).toBe(9);
    const total =
      report.summary["spend-decision"].n +
      report.summary["delegation"].n +
      report.summary["lifecycle"].n +
      report.summary["crypto-evidence"].n;
    expect(total).toBe(92);
  });

  it("status counts match the per-slice tallies", () => {
    expect(report.summary["spend-decision"].by_status).toEqual({
      PASS: 20,
      "DIVERGENCE-MODEL": 3,
      NOT_MAPPABLE: 8,
      "DIVERGENCE-BUG": 4,
      GATE_EXCEPTION: 1,
    });
    expect(report.summary["delegation"].by_status).toEqual({
      PASS: 4,
      "DIVERGENCE-MODEL": 13,
      NOT_MAPPABLE: 1,
    });
    expect(report.summary["lifecycle"].by_status).toEqual({
      PASS: 2,
      "DIVERGENCE-MODEL": 16,
      "DIVERGENCE-BUG": 2,
      NOT_MAPPABLE: 8,
      GATE_EXCEPTION: 1,
    });
    expect(report.summary["crypto-evidence"].by_status).toEqual({
      PASS: 9,
    });
  });

  it("collects all BUG findings + gate exceptions", () => {
    const bugIds = report.findings.bugs.map((b) => b.vector_id).sort();
    expect(bugIds).toEqual(["L05", "L09", "V04", "V17", "V29", "V33"]);
    expect(report.findings.gate_exceptions.sort()).toEqual(["L24", "V21"]);
    expect(report.findings.not_mappable_count).toBe(17);
  });

  it("writes report.json + report.md", () => {
    const outJson = path.join(DIR, "results", "report.json");
    writeFileSync(outJson, JSON.stringify(report, null, 2) + "\n");
    const md = renderMarkdown(report, own);
    const outMd = path.join(DIR, "results", "report.md");
    writeFileSync(outMd, md);
    expect(md).toContain("spend-decision | 36");
    expect(md).toContain("delegation | 18");
    expect(md).toContain("lifecycle | 29");
    expect(md).toContain("crypto-evidence | 9");
    expect(md).toContain("V04");
    expect(md).toContain("OWN-1");
    expect(report.vectors).toHaveLength(92);
  });
});
