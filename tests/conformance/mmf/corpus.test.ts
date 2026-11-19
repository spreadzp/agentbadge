/**
 * SLICE-255-1 sanity: vendored Mandata MMF corpus @ tag v0.4.24.
 *
 * Covered (per slice AC):
 *  - 5 vendored JSON load: core(36) + delegation(18) + lifecycle(29)
 *    + credential(6) + evidence(3) = 92 vectors
 *  - SHA-256 of each vendored file matches CORPUS.md manifest
 *  - every vector carries id + expected-verdict structure per track
 *  - tx.amount_json preserved as raw lexical string (D-255-Q16)
 *  - embedded conventions preserved: prior_txns, registry, steps,
 *    then_tx/then_expect
 *  - loader round-trip is lossless (no dropped keys)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  CORPUS_FILES,
  corpusSha256,
  loadCorpus,
  parseCorpusManifest,
  vectorDesc,
  vectorsDir,
  type CoreVector,
  type MmfCorpus,
} from "./lib/corpus";

const EXPECTED_COUNTS = {
  core: 36,
  delegation: 18,
  lifecycle: 29,
  credential: 6,
  evidence: 3,
} as const;

const corpus: MmfCorpus = loadCorpus();

describe("MMF corpus ingest (v0.4.24)", () => {
  it("loads all 92 vectors split by domain", () => {
    expect(corpus.core.vectors).toHaveLength(EXPECTED_COUNTS.core);
    expect(corpus.delegation.vectors).toHaveLength(
      EXPECTED_COUNTS.delegation,
    );
    expect(corpus.lifecycle.vectors).toHaveLength(
      EXPECTED_COUNTS.lifecycle,
    );
    expect(corpus.credential).toHaveLength(EXPECTED_COUNTS.credential);
    expect(corpus.evidence.vectors).toHaveLength(EXPECTED_COUNTS.evidence);
    expect(corpus.all).toHaveLength(92);
    expect(new Set(corpus.all.map((v) => v.track)).size).toBe(5);
  });

  it("SHA-256 of vendored files matches CORPUS.md manifest", () => {
    const manifest = parseCorpusManifest(
      readFileSync(path.join(vectorsDir(), "CORPUS.md"), "utf8"),
    );
    const actual = corpusSha256();
    for (const f of CORPUS_FILES) {
      const name = `${f}.json`;
      expect(manifest[name], `manifest missing ${name}`).toMatch(
        /^[0-9a-f]{64}$/,
      );
      expect(actual[f]).toBe(manifest[name]);
    }
  });

  it("every vector has id + expected-verdict structure per track", () => {
    for (const v of corpus.core.vectors) {
      expect(v.id).toBeTruthy();
      expect(v.expect).toBeDefined();
      expect(v.tx).toBeDefined();
      expect(v.mandate?.bounds).toBeDefined();
    }
    for (const v of corpus.delegation.vectors) {
      expect(v.id).toBeTruthy();
      expect(v.parent).toBeDefined();
      expect(v.steps.length).toBeGreaterThan(0);
    }
    for (const v of corpus.lifecycle.vectors) {
      expect(v.id).toBeTruthy();
      expect(v.steps.length).toBeGreaterThan(0);
      expect(v.events.length).toBeGreaterThan(0);
    }
    for (const v of corpus.credential) {
      expect(v.id).toBeTruthy();
      expect(v.expected).toBeDefined();
      // C01 carries `inputs`+seed; C02+ carry `credential`+mandate_inputs
      expect(v.inputs ?? v.mandate_inputs).toBeDefined();
    }
    for (const v of corpus.evidence.vectors) {
      expect(v.id).toBeTruthy();
      expect(v.records.length).toBeGreaterThan(0);
      expect(v.expect.length).toBeGreaterThan(0);
      expect(v.head).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("tx.amount_json preserved as raw lexical string (V31-V35)", () => {
    const lexical = corpus.core.vectors.filter(
      (v) => v.tx.amount_json !== undefined,
    );
    expect(lexical.length).toBeGreaterThanOrEqual(5);
    for (const v of lexical) {
      expect(typeof v.tx.amount_json).toBe("string");
      expect(v.tx.amount).toBeUndefined();
    }
    const v31 = corpus.core.vectors.find((v) => v.id === "V31");
    expect(v31?.tx.amount_json).toBe("1.0");
  });

  it("embedded conventions survive: prior_txns, registry, then_tx", () => {
    const withPrior = corpus.core.vectors.filter(
      (v) => v.prior_txns !== undefined,
    );
    expect(withPrior.length).toBeGreaterThanOrEqual(5);
    expect(withPrior[0].prior_txns?.[0]).toHaveProperty("at");
    expect(withPrior[0].prior_txns?.[0]).toHaveProperty("amount");

    const revoked = corpus.core.vectors.find((v) => v.id === "V20");
    expect(revoked?.registry?.revoked).toEqual(["m-reg"]);
    const unavailable = corpus.core.vectors.find((v) => v.id === "V21");
    expect(unavailable?.registry?.unavailable).toBe(true);

    const twoPhase = corpus.core.vectors.find((v) => v.id === "V19");
    expect(twoPhase?.then_tx).toBeDefined();
    expect(twoPhase?.then_expect?.allowed).toBe(true);
  });

  it("delegation/lifecycle steps carry their ops (delegate/tx/claim/settle/void)", () => {
    const dsteps = corpus.delegation.vectors.flatMap((v) => v.steps);
    expect(dsteps.some((s) => s.delegate !== undefined)).toBe(true);
    expect(dsteps.some((s) => s.tx !== undefined)).toBe(true);
    expect(dsteps.some((s) => s.revoke === "parent")).toBe(true);
    expect(dsteps.some((s) => s.claim !== undefined)).toBe(true);
    const lsteps = corpus.lifecycle.vectors.flatMap((v) => v.steps);
    expect(lsteps.some((s) => typeof s.settle === "string")).toBe(true);
    expect(lsteps.some((s) => typeof s.void === "string")).toBe(true);
    expect(lsteps.some((s) => s.claim !== undefined)).toBe(true);
    expect(lsteps.some((s) => s.cancellation !== undefined)).toBe(true);
  });

  it("vectorDesc handles desc vs description (V30 uses description)", () => {
    const v30 = corpus.core.vectors.find((v) => v.id === "V30");
    expect(v30?.desc).toBeUndefined();
    expect(vectorDesc(v30 as CoreVector)).toContain("currency");
  });

  it("loader round-trip is lossless for one vector per file", () => {
    const dir = vectorsDir();
    for (const f of CORPUS_FILES) {
      const raw = JSON.parse(
        readFileSync(path.join(dir, `${f}.json`), "utf8"),
      ) as unknown;
      const loaded =
        f === "credential"
          ? corpus.credential
          : f === "core"
            ? corpus.core
            : f === "delegation"
              ? corpus.delegation
              : f === "lifecycle"
                ? corpus.lifecycle
                : corpus.evidence;
      expect(JSON.stringify(loaded)).toBe(JSON.stringify(raw));
    }
  });
});
