/**
 * SLICE-255-2: spend track — core.json (36) + delegation.json (18)
 * through the REAL createSpendEnforcer / spendAsDelegate.
 *
 * Faithful-or-flagged (D-255-Q3): vectors run against production code
 * paths only; dimensions with no prod equivalent are marked
 * NOT_MAPPABLE / equivalence None, never emulated.
 *
 * Covered here:
 *  - adapter: bounds→SpendCaps scalar projection, prior_txns→seed,
 *    tx.at→fake-time (sec→ms), registry scenarios
 *  - check-map: deny-reason → MMF check-id table
 *  - runner: all 54 vectors produce a result in the unified format
 *    (D-255-Q25), results written to results/spend.json
 *  - replay-probe: same refId twice → observed behaviour recorded
 *    (own-invariant, NOT in MMF metrics)
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadCorpus, corpusSha256 } from "./lib/corpus";
import type { CoreVector, MmfTx } from "./lib/mmf-types";
import {
  boundsToCaps,
  mmfAmountToScalar,
  mmfAtToMs,
  checkIdForDeny,
  CAPS_TO_WINDOW,
} from "./lib/adapter";
import { classifyCore, classifyStep } from "./lib/classify";
import { runCoreVector } from "./lib/spend-harness";
import { runDelegationVector } from "./lib/delegation-harness";
import {
  writeTrackResults,
  RESULT_SCHEMA_VERSION,
  type VectorResult,
} from "./lib/result";
import { initSpendAlerts } from "../../../src/server/lib/agent-wallet/audit";

const corpus = loadCorpus();
const sha = corpusSha256();

/* ------------------------------- adapter -------------------------------- */

describe("adapter: bounds → SpendCaps (scalar projection)", () => {
  it("max_amount→perTxUsd, W=1→dailyUsd, W=30→monthlyUsd, velocity→maxTxPerHour", () => {
    const { caps, unmapped } = boundsToCaps({
      max_amount: 500,
      total_budget: 900,
      budget_window_days: 30,
      velocity_limit: 3,
    });
    expect(caps).toEqual({
      perTxUsd: 500,
      monthlyUsd: 900,
      maxTxPerHour: 3,
    });
    expect(unmapped).toEqual([]);
    const day = boundsToCaps({ total_budget: 100, budget_window_days: 1 });
    expect(day.caps.dailyUsd).toBe(100);
    expect(CAPS_TO_WINDOW).toEqual({ 1: "dailyUsd", 7: "weeklyUsd", 30: "monthlyUsd" });
  });

  it("unmapped bounds are reported, not dropped", () => {
    const { caps, unmapped } = boundsToCaps({
      max_amount: 1,
      currency: "GBP",
      allowed_payees: ["a"],
      expires_in_days: 30,
      budget_window_days: 14,
      total_budget: 50,
    });
    expect(caps.perTxUsd).toBe(1);
    expect(caps.dailyUsd).toBeUndefined();
    expect(unmapped).toEqual(
      expect.arrayContaining(["currency", "allowed_payees", "expires_in_days"]),
    );
    expect(unmapped).toContain("budget_window_days:14");
  });
});

describe("adapter: tx scalar projection + time", () => {
  it("amount passes 1:1 including non-integer classes", () => {
    expect(mmfAmountToScalar({ amount: 4999 } as MmfTx)).toBe(4999);
    expect(mmfAmountToScalar({ amount_json: "1.0" } as MmfTx)).toBe(1.0);
    expect(mmfAmountToScalar({ amount_json: "-0" } as MmfTx)).toBe(-0);
    expect(mmfAmountToScalar({ amount: -50 } as MmfTx)).toBe(-50);
    expect(mmfAmountToScalar({ amount: "10" } as unknown as MmfTx)).toBe("10");
  });
  it("tx.at seconds → ms", () => {
    expect(mmfAtToMs(1000)).toBe(1_000_000);
    expect(mmfAtToMs(1000.5)).toBe(1_000_500);
    expect(mmfAtToMs(undefined)).toBeUndefined();
  });
});

describe("check-map: deny-reason → MMF check-id", () => {
  it("maps our denies onto MMF check ids", () => {
    expect(checkIdForDeny("perTx")).toBe("CAP_EXCEEDED");
    expect(checkIdForDeny("daily")).toBe("BUDGET");
    expect(checkIdForDeny("monthly")).toBe("BUDGET");
    expect(checkIdForDeny("velocity_tx")).toBe("VELOCITY");
    expect(checkIdForDeny("spend_suspended")).toBe("REVOKED");
    expect(checkIdForDeny("no-active-delegate")).toBe("REVOKED");
    expect(checkIdForDeny("delegate-suspended")).toBe("REVOKED");
    expect(checkIdForDeny("cap-exceeded")).toBe("CAP_EXCEEDED");
    expect(checkIdForDeny("kind_not_allowed")).toBeNull();
    expect(checkIdForDeny("whatever-else")).toBeNull();
  });
});

/* ------------------------------ classification -------------------------- */

describe("classifyCore", () => {
  const base = (over: Partial<CoreVector["expect"]> = {}) =>
    ({ allowed: true, check: "WITHIN", ...over }) as CoreVector["expect"];

  it("PASS when allow/deny + mapped check match", () => {
    expect(classifyCore({ allowed: true }, base())).toBe("PASS");
    expect(
      classifyCore(
        { allowed: false, checkId: "CAP_EXCEEDED" },
        base({ allowed: false, check: "CAP_EXCEEDED" }),
      ),
    ).toBe("PASS");
  });

  it("NOT_MAPPABLE when the decisive check is a None dimension", () => {
    expect(
      classifyCore(
        { allowed: true },
        base({ allowed: false, check: "PAYEE" }),
      ),
    ).toBe("NOT_MAPPABLE");
  });

  it("DIVERGENCE-MODEL on mapped-mechanism semantic mismatch", () => {
    expect(
      classifyCore(
        { allowed: false, checkId: "CAP_EXCEEDED" },
        base({ allowed: true }),
      ),
    ).toBe("DIVERGENCE-MODEL");
  });
});

/* -------------------------------- runner -------------------------------- */

describe("spend track run", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "mmf-spend-"));
    initSpendAlerts(null);
  });
  afterEach(() => {
    vi.useRealTimers();
    initSpendAlerts(null);
    rmSync(dir, { recursive: true, force: true });
  });

  it("every core vector produces a unified-format result", async () => {
    const results: VectorResult[] = [];
    for (const v of corpus.core.vectors) {
      results.push(await runCoreVector(v, sha.core));
    }
    expect(results).toHaveLength(36);
    for (const r of results) {
      expect(r.schema_version).toBe(RESULT_SCHEMA_VERSION);
      expect(r.corpus_version).toBe("v0.4.24");
      expect(r.corpus_sha256).toBe(sha.core);
      expect(r.track).toBe("spend");
      expect(r.vector_id).toMatch(/^V\d+$/);
      expect(r.result).toMatch(
        /^(PASS|DIVERGENCE-BUG|DIVERGENCE-MODEL|NOT_MAPPABLE|HARNESS_ERROR|GATE_EXCEPTION)$/,
      );
      expect(r.equivalence).toMatch(/^(Exact|Partial|None)$/);
      expect(r.production_path).toContain("createSpendEnforcer");
      expect(r.expected).toBeDefined();
      expect(r.actual).toBeDefined();
    }
    // sanity anchors — these must hold for the run to be meaningful
    const byId = Object.fromEntries(results.map((r) => [r.vector_id, r]));
    expect(byId["V01"].result).toBe("PASS");
    expect(byId["V05"].result).toBe("PASS"); // CAP_EXCEEDED↔perTx
    expect(byId["V09"].result).toBe("NOT_MAPPABLE"); // payee
    expect(byId["V11"].result).toBe("PASS"); // velocity↔maxTxPerHour
    expect(byId["V14"].result).toBe("PASS"); // BUDGET↔monthlyUsd
    writeTrackResults(results, path.join(dir, "spend.json"));
    expect(existsSync(path.join(dir, "spend.json"))).toBe(true);
    const written = JSON.parse(readFileSync(path.join(dir, "spend.json"), "utf8"));
    expect(written).toHaveLength(36);
  });

  it("every delegation vector produces a unified-format result", async () => {
    const results: VectorResult[] = [];
    for (const v of corpus.delegation.vectors) {
      results.push(await runDelegationVector(v, sha.delegation));
    }
    expect(results).toHaveLength(18);
    for (const r of results) {
      expect(r.schema_version).toBe(RESULT_SCHEMA_VERSION);
      expect(r.track).toBe("spend");
      expect(r.corpus_sha256).toBe(sha.delegation);
    }
  });

  it("classifyStep marks valid/invalid delegate verdicts", () => {
    expect(classifyStep("valid", { ok: true })).toBe("match");
    expect(classifyStep("invalid", { ok: false })).toBe("match");
    expect(classifyStep("valid", { ok: false })).toBe("mismatch");
  });

  /**
   * Canonical output: results/spend.json — regenerated on every suite
   * run so the artefact can never drift from the harness code.
   * (255-6 consumes this file for the consolidated report.)
   */
  it("writes results/spend.json for the full spend track (54 vectors)", async () => {
    const results: VectorResult[] = [];
    for (const v of corpus.core.vectors) {
      results.push(await runCoreVector(v, sha.core));
    }
    for (const v of corpus.delegation.vectors) {
      results.push(await runDelegationVector(v, sha.delegation));
    }
    expect(results).toHaveLength(54);
    const out = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "results",
      "spend.json",
    );
    writeTrackResults(results, out);
    // determinism check: rerun one vector, must match byte-for-byte
    const again = await runCoreVector(corpus.core.vectors[0], sha.core);
    expect(JSON.stringify(results[0])).toBe(JSON.stringify(again));
    // no silent harness failures allowed in the artefact
    const bad = results.filter((r) => r.result === "HARNESS_ERROR");
    expect(bad, JSON.stringify(bad.map((r) => r.vector_id))).toHaveLength(0);
  });

  /**
   * Own-invariant probe (NOT part of MMF metrics — source:"own-invariant").
   * MMF dedups authorizations on mandate_id+tx_id (serializable
   * check-and-record, §5). Our `refId` is correlation-only: replaying
   * the same refId inserts a SECOND reservation under a fresh spend id.
   * Run it, record what the ledger actually shows → routed to EPIC-234
   * (double-reserve / idempotency candidate), NOT to MMF counts.
   */
  it("replay probe: same refId twice → ledger shows both entries", async () => {
    const { freshSpendEnv, runTx, W } = await import("./lib/harness-env");
    const { createSpendEnforcer } = await import(
      "../../../src/server/lib/agent-wallet/enforcer"
    );
    const env = freshSpendEnv({ perTxUsd: 100 }, false);
    await env.save();
    const enforcer = createSpendEnforcer({
      ledger: env.ledger,
      registry: env.registry,
      requireRegistered: true,
    });
    const tx = { tx_id: "dup-1", amount: 10, at: 1000 };
    const a = await runTx(enforcer, tx, 10);
    const b = await runTx(enforcer, tx, 10);
    const entries = await env.ledger.listByWallet(W);
    const settled = entries.filter(
      (e) => e.refId === "dup-1" && e.state === "settled",
    );
    expect(a.allowed && b.allowed).toBe(true);
    // Faithful record of actual behaviour — no dedup on refId.
    expect(settled).toHaveLength(2);
    expect(new Set(settled.map((e) => e.id)).size).toBe(2);
  });
});
