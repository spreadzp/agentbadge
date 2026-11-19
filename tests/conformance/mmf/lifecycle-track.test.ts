/**
 * SLICE-255-3: lifecycle track — lifecycle.json (29 vectors) through
 * REAL prod ops (begin / settleEntry / releaseEntry). Lifecycle
 * compatibility metric is SEPARATE from spend-decision (track tag).
 *
 * Known honest deltas (do not emulate — D-255-Q3):
 *  - no CLAIMED state / claim op → claim steps "unmapped"
 *  - no tx_id dedup → replays reserve fresh (REPLAY/TX_CONFLICT absent)
 *  - no MMF evidence-event stream → dimension None
 *  - reserve atomicity under db backend = documented Partial note
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadCorpus, corpusSha256 } from "./lib/corpus";
import { runLifecycleVector } from "./lib/lifecycle-harness";
import { STATE_EQ } from "./lib/lifecycle-support";
import {
  writeTrackResults,
  summarize,
  RESULT_SCHEMA_VERSION,
  type VectorResult,
} from "./lib/result";
import { initSpendAlerts } from "../../../src/server/lib/agent-wallet/audit";

const corpus = loadCorpus();
const sha = corpusSha256();

describe("lifecycle state map", () => {
  it("maps MMF statuses to our SpendStates honestly (CLAIMED=null)", () => {
    expect(STATE_EQ.AUTHORIZED).toBe("reserved");
    expect(STATE_EQ.CLAIMED).toBeNull();
    expect(STATE_EQ.SETTLED).toBe("settled");
    expect(STATE_EQ.VOIDED).toBe("released");
    expect(STATE_EQ.DENIED).toBe("denied");
  });
});

describe("lifecycle track run", () => {
  beforeEach(() => initSpendAlerts(null));
  afterEach(() => {
    vi.useRealTimers();
    initSpendAlerts(null);
  });

  it("every lifecycle vector produces a unified-format result", async () => {
    const results: VectorResult[] = [];
    for (const v of corpus.lifecycle.vectors) {
      results.push(await runLifecycleVector(v, sha.lifecycle));
    }
    expect(results).toHaveLength(29);
    for (const r of results) {
      expect(r.schema_version).toBe(RESULT_SCHEMA_VERSION);
      expect(r.corpus_version).toBe("v0.4.24");
      expect(r.corpus_sha256).toBe(sha.lifecycle);
      expect(r.track).toBe("lifecycle");
      expect(r.vector_id).toMatch(/^L\d+$/);
      expect(r.result).toMatch(
        /^(PASS|DIVERGENCE-BUG|DIVERGENCE-MODEL|NOT_MAPPABLE|HARNESS_ERROR|GATE_EXCEPTION)$/,
      );
      expect(r.production_path).toContain("begin");
      expect(r.steps?.length).toBeGreaterThan(0);
      expect(Array.isArray(r.expected.events)).toBe(true);
    }
    // sanity anchors
    const byId = Object.fromEntries(results.map((r) => [r.vector_id, r]));
    // L10: settle/void of unknown tx_id → both rejected ↔ missing handle
    expect(byId["L10"].result).toBe("PASS");
    // L01: same tx_id replay expected replayed:true — we re-reserve
    expect(byId["L01"].result).not.toBe("PASS");
    const l01 = byId["L01"].actual as { replayMatrix: Array<{ case: string }> };
    expect(l01.replayMatrix[0].case).toBe("same_params");
    // no harness failures tolerated in the run
    expect(results.filter((r) => r.result === "HARNESS_ERROR")).toHaveLength(0);
  });

  it("writes results/lifecycle.json + fills the replay matrix", async () => {
    const results: VectorResult[] = [];
    for (const v of corpus.lifecycle.vectors) {
      results.push(await runLifecycleVector(v, sha.lifecycle));
    }
    const out = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "results",
      "lifecycle.json",
    );
    writeTrackResults(results, out);
    // replay vectors: every vector that reuses a tx_id must have
    // a matrix row per reuse
    const replayVecs = results.filter((r) => {
      const ids = corpus.lifecycle.vectors
        .find((x) => x.id === r.vector_id)!
        .steps.filter((s) => s.tx)
        .map((s) => s.tx!.tx_id);
      return new Set(ids).size < ids.length;
    });
    for (const r of replayVecs) {
      const m = (r.actual as { replayMatrix: unknown[] }).replayMatrix;
      expect(m.length).toBeGreaterThan(0);
    }
    // metric separation: lifecycle counts are its own object
    const sums = summarize(results);
    expect(Object.values(sums).reduce((a, b) => a + b, 0)).toBe(29);
    // determinism: rerun L01 identical
    const again = await runLifecycleVector(corpus.lifecycle.vectors[0], sha.lifecycle);
    expect(JSON.stringify(results[0])).toBe(JSON.stringify(again));
  });
});
