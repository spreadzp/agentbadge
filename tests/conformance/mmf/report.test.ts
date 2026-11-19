/**
 * SLICE-255-6: consolidated report — joins the four results
 * artifacts into report.json (machine) + report.md (human).
 * Deterministic: no timestamps, re-run produces identical bytes.
 *
 * Vectors are re-derived in-process (not read from sibling test
 * files' side-effects) so the report can't lag a generation behind
 * a harness change; committed files are asserted fresh below.
 */
import { describe, expect, it, beforeAll } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";

import { corpusSha256, loadCorpus } from "./lib/corpus";
import { buildReport, renderMarkdown } from "./lib/report-gen";
import type { VectorResult } from "./lib/result";
import { runCoreVector } from "./lib/spend-harness";
import { runDelegationVector } from "./lib/delegation-harness";
import { runLifecycleVector } from "./lib/lifecycle-harness";
import { runCredentialVector, runEvidenceVector } from "./lib/crypto-harness";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const file = (name: string) =>
  JSON.parse(
    readFileSync(path.join(DIR, "results", name), "utf8"),
  ) as VectorResult[];

/** JSON round-trip: writeTrackResults drops undefined-valued keys —
 *  compare files against what is actually persisted. */
const asJson = (rows: VectorResult[]) =>
  JSON.parse(JSON.stringify(rows)) as VectorResult[];

describe("SLICE-255-6 consolidated report", () => {
  const corpus = loadCorpus();
  const sha = corpusSha256();

  let derived: VectorResult[] = [];
  beforeAll(async () => {
    derived = [];
    for (const v of corpus.core.vectors)
      derived.push(await runCoreVector(v, sha.core));
    for (const v of corpus.delegation.vectors)
      derived.push(await runDelegationVector(v, sha.delegation));
    for (const v of corpus.lifecycle.vectors)
      derived.push(await runLifecycleVector(v, sha.lifecycle));
    for (const v of corpus.credential)
      derived.push(runCredentialVector(v, sha.credential));
    for (const v of corpus.evidence.vectors)
      derived.push(runEvidenceVector(v, sha.evidence));
  });

  it("re-derives all 92 vectors in-process", () => {
    expect(derived).toHaveLength(92);
    for (const r of derived) {
      expect(r.schema_version).toBe(1);
      expect(r.corpus_sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("committed results/*.json are fresh (match this harness)", () => {
    const spend = derived.filter(
      (r) => r.track === "spend" || r.track === "delegation",
    );
    const lifecycle = derived.filter((r) => r.track === "lifecycle");
    const crypto = derived.filter((r) => r.track === "crypto");
    expect(file("spend.json")).toEqual(asJson(spend));
    expect(file("lifecycle.json")).toEqual(asJson(lifecycle));
    expect(file("crypto.json")).toEqual(asJson(crypto));
  });

  it("summary counts and findings match committed tallies", () => {
    const report = buildReport(derived, sha);
    expect(report.summary["spend-decision"].n).toBe(36);
    expect(report.summary["delegation"].n).toBe(18);
    expect(report.summary["lifecycle"].n).toBe(29);
    expect(report.summary["crypto-evidence"].n).toBe(9);

    const bugIds = report.findings.bugs.map((b) => b.vector_id).sort();
    expect(bugIds).toEqual(["L05", "L09", "V04", "V17", "V29", "V33"]);
    expect(report.findings.gate_exceptions.sort()).toEqual(["L24", "V21"]);
    expect(report.findings.not_mappable_count).toBe(15);
  });

  it("writes report.json + report.md (deterministic, metric-aware)", () => {
    const report = buildReport(derived, sha);
    const own = JSON.parse(
      readFileSync(path.join(DIR, "results", "own-invariants.json"), "utf8"),
    ) as Parameters<typeof renderMarkdown>[1];

    const outJson = path.join(DIR, "results", "report.json");
    writeFileSync(outJson, JSON.stringify(report, null, 2) + "\n");
    const md = renderMarkdown(report, own);
    writeFileSync(path.join(DIR, "results", "report.md"), md);
    expect(md).toContain("spend-decision | 36");
    expect(md).toContain("delegation | 18");
    expect(md).toContain("lifecycle | 29");
    expect(md).toContain("crypto-evidence | 9");
    expect(md).toContain("V04");
    expect(md).toContain("OWN-1");
    expect(report.vectors).toHaveLength(92);
  });
});
