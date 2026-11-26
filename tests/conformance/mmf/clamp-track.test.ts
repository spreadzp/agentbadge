/**
 * EPIC-263-3: draft v0.5-clamp corpus run — 16 K-vectors through the
 * REAL createSpendEnforcer.begin + 5 KD-vectors through the REAL
 * spendAsDelegate (D-263-Q4: no emulation).
 *
 * Writes results/clamp.json + results/clamp-report.md — the v0.4.24
 * artifacts are NOT touched (separate corpus_version, separate file).
 *
 * Honest classification (D-263-Q5): PASS only where the decisive
 * mechanism exists; NOT_MAPPABLE where it does not (decision-store,
 * claim op, payee/currency/expiry checks, unwindowed budget,
 * delegate-path ancestor budget).
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import {
  loadDraftCorpus,
  loadDraftManifest,
  verifyManifest,
  draftDir,
} from "./lib/draft-corpus";
import {
  runClampCoreVector,
  runClampDelegationVector,
} from "./lib/clamp-harness";
import { boundsToCaps } from "./lib/adapter";
import { classifyStep } from "./lib/classify";
import { evidenceChain } from "./lib/mmf-canon";
import { renderClampReport } from "./lib/clamp-report";
import {
  writeTrackResults,
  RESULT_SCHEMA_VERSION,
  DRAFT_CORPUS_VERSION,
  type VectorResult,
} from "./lib/result";
import type { EvidenceVector } from "./lib/mmf-types";
import { initSpendAlerts } from "../../../src/server/lib/agent-wallet/audit";

const corpus = loadDraftCorpus();
const manifest = loadDraftManifest();

describe("draft corpus pin (D-263-Q6)", () => {
  it("MANIFEST carries commit-sha + sha256 of every fetched file; all match disk", () => {
    expect(manifest.commit_sha).toBe("a91b7f4");
    expect(manifest.draft_version).toBe("mmf-v0.5-draft");
    expect(Object.keys(manifest.files).sort()).toEqual([
      "clamp-core.json",
      "clamp-delegation.json",
      "mmf-v0.5-clamp-proposal.md",
    ]);
    for (const sha of Object.values(manifest.files)) {
      expect(sha).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(verifyManifest()).toEqual([]);
    expect(corpus.core.vectors).toHaveLength(16);
    expect(corpus.delegation.vectors).toHaveLength(5);
  });
});

describe("adapter — bounds.clamp reaches both surfaces", () => {
  it("envelope path: boundsToCaps maps true/false; absent → off", () => {
    expect(boundsToCaps({ max_amount: 10, clamp: true }).caps.clamp).toBe(true);
    expect(boundsToCaps({ max_amount: 10, clamp: false }).caps.clamp).toBe(false);
    const noClamp = boundsToCaps({ max_amount: 10 });
    expect("clamp" in noClamp.caps).toBe(false);
    expect(noClamp.unmapped).toHaveLength(0);
  });
});

describe("classify — clamp expect-keys", () => {
  it("distinguishes allowed+clamped / allowed / deny; fields compare exactly", () => {
    const clamped = {
      ok: true,
      checkId: "CAP_EXCEEDED",
      clamped: true,
      requested_amount: 150,
      effective_amount: 100,
      effective_cap: 100,
    };
    // Shape 2: allowed+clamped with CAP_EXCEEDED → match.
    expect(
      classifyStep(
        {
          allowed: true,
          check: "CAP_EXCEEDED",
          clamped: true,
          requested_amount: 150,
          effective_amount: 100,
          effective_cap: 100,
        },
        clamped,
      ),
    ).toBe("match");
    // Same verdict, wrong effective_cap → mismatch (exact compare).
    expect(
      classifyStep(
        { allowed: true, check: "CAP_EXCEEDED", clamped: true, effective_cap: 90 },
        clamped,
      ),
    ).toBe("mismatch");
    // clamped:true emitted where expected false → mismatch.
    expect(
      classifyStep({ allowed: false, check: "CAP_EXCEEDED", clamped: false }, clamped),
    ).toBe("mismatch");
    // Unclamped allow + WITHIN vs clamp-fields absent → match.
    expect(
      classifyStep(
        { allowed: true, check: "WITHIN", clamped: false },
        { ok: true, checkId: "WITHIN", clamped: false },
      ),
    ).toBe("match");
  });
});

describe("clamp corpus run", () => {
  beforeEach(() => initSpendAlerts(null));
  afterEach(() => {
    vi.useRealTimers();
    initSpendAlerts(null);
  });

  async function runAll(): Promise<VectorResult[]> {
    const results: VectorResult[] = [];
    for (const v of corpus.core.vectors) {
      results.push(await runClampCoreVector(v, corpus.sha256.core));
    }
    for (const v of corpus.delegation.vectors) {
      results.push(
        await runClampDelegationVector(v, corpus.sha256.delegation),
      );
    }
    return results;
  }

  it("all 21 vectors produce unified-format results through real prod paths", async () => {
    const results = await runAll();
    expect(results).toHaveLength(21);
    for (const r of results) {
      expect(r.schema_version).toBe(RESULT_SCHEMA_VERSION);
      expect(r.corpus_version).toBe(DRAFT_CORPUS_VERSION);
      expect(r.track).toBe("clamp");
      expect(r.vector_id).toMatch(/^KD?\d+$/);
      expect(r.result).toMatch(
        /^(PASS|DIVERGENCE-BUG|DIVERGENCE-MODEL|NOT_MAPPABLE|HARNESS_ERROR|GATE_EXCEPTION)$/,
      );
      // expected kept verbatim (D-263-Q6-4)
      expect(
        (r.expected as { steps?: unknown[] }).steps?.length,
      ).toBeGreaterThan(0);
    }
    // D-263-Q4: real prod entry points, never emulation.
    expect(results[0].production_path).toContain("begin");
    const kd = results.find((r) => r.vector_id === "KD01")!;
    expect(kd.production_path).toContain("spendAsDelegate");
    // No broken harness, no prod throw — every verdict is real.
    expect(results.filter((r) => r.result === "HARNESS_ERROR")).toHaveLength(0);
    expect(results.filter((r) => r.result === "GATE_EXCEPTION")).toHaveLength(0);
  });

  it("sanity anchors: K01/K02/K08/K10/K11 PASS; K14/K15/K16 + KD05 NOT_MAPPABLE with notes", async () => {
    const results = await runAll();
    const byId = Object.fromEntries(results.map((r) => [r.vector_id, r]));
    for (const id of ["K01", "K02", "K03", "K04", "K05", "K08", "K10", "K11", "KD01", "KD02", "KD03", "KD04"]) {
      expect(byId[id].result, id).toBe("PASS");
    }
    // payee/currency/expiry unmodeled (K06/K07/K09) + unwindowed budget
    // (K12/K13) + decision-store replay (K14/K15) + claim op (K16) +
    // delegate-path ancestor budget (KD05).
    for (const id of ["K06", "K07", "K09", "K12", "K13", "K14", "K15", "K16", "KD05"]) {
      expect(byId[id].result, id).toBe("NOT_MAPPABLE");
    }
    expect(byId["K14"].notes).toContain("decision-store");
    expect(byId["K15"].notes).toContain("TX_CONFLICT");
    // K16's unmapped claim step carries its own note; vector stays NM.
    expect(byId["K16"].result).toBe("NOT_MAPPABLE");
    expect(byId["KD05"].notes ?? "").toBeTruthy();
  });

  it("K01 step detail: Shape-2 check + all four clamp fields recorded", async () => {
    const r = await runClampCoreVector(corpus.core.vectors[0], corpus.sha256.core);
    expect(r.vector_id).toBe("K01");
    const step = (r.steps ?? [])[0];
    expect(step.verdict).toBe("match");
    const actual = step.actual as Record<string, unknown>;
    expect(actual).toMatchObject({
      allowed: true,
      checkId: "CAP_EXCEEDED",
      clamped: true,
      requested_amount: 60000,
      effective_amount: 50000,
      effective_cap: 50000,
      state: "reserved",
    });
  });

  it("writes results/clamp.json + clamp-report.md (old results untouched)", async () => {
    const results = await runAll();
    const dir = path.dirname(fileURLToPath(import.meta.url));
    writeTrackResults(results, path.join(dir, "results", "clamp.json"));
    const report = renderClampReport(
      results.filter((r) => r.vector_id.startsWith("K") && !r.vector_id.startsWith("KD")),
      results.filter((r) => r.vector_id.startsWith("KD")),
      manifest,
    );
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path.join(dir, "results", "clamp-report.md"), report);
    // metric separation: two tracks inside one file.
    expect(results.filter((r) => r.vector_id.startsWith("KD"))).toHaveLength(5);
    // determinism: rerun K01 identical
    const again = await runClampCoreVector(corpus.core.vectors[0], corpus.sha256.core);
    expect(JSON.stringify(results[0])).toBe(JSON.stringify(again));
    // AC6: the v0.4 artifacts were not overwritten — results/clamp.json
    // is the only file this test writes besides clamp-report.md.
  });
});

describe("golden evidence vectors — mmf-canon §6 (offer accepted DM 15:28)", () => {
  const goldenPath = path.join(draftDir(), "golden-evidence-clamped.json");
  const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as {
    vectors: EvidenceVector[];
  };

  it("recomputing the chain reproduces every payload+hash byte-exact", () => {
    for (const v of golden.vectors) {
      const chain = evidenceChain(v.records);
      expect(chain).toEqual(v.expect);
      expect(chain.at(-1)!.hash).toBe(v.head);
    }
  });

  it("unclamped records in the same chains serialize exactly as v0.3.24 (§6 rule)", () => {
    // KE02's SETTLE + KE03's deny carry no clamped flag → the §6
    // three-field insert MUST NOT appear in their payloads.
    const ke02 = golden.vectors.find((v) => v.id === "KE02")!;
    const settle = ke02.expect[2];
    expect(settle.payload.split("|").filter((f) => f === "4:true")).toHaveLength(1);
    const ke03 = golden.vectors.find((v) => v.id === "KE03")!;
    const deny = ke03.expect[1];
    // deny carries the REQUESTED amount (70000), no clamp tail.
    expect(deny.payload).toContain("5:70000");
    expect(deny.payload).not.toContain("|4:true|");
  });
});
