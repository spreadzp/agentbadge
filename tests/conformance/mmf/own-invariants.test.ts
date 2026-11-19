/**
 * SLICE-255-5: own invariants — race probe + caller-dedup table +
 * evidence matrix. Source tag: "own-invariant" — NOT MMF vectors,
 * excluded from conformance metrics. Findings → EPIC-234 candidates.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";
import { Hono } from "hono";
import type { Context } from "hono";

import { runRaceProbe } from "./lib/race-probe";
import {
  runEvidenceMatrix,
  runEvidenceFailClosed,
} from "./lib/evidence-probe";
import { CORPUS_VERSION, RESULT_SCHEMA_VERSION } from "./lib/result";
import { createSpendEnforcer } from "../../../src/server/lib/agent-wallet/enforcer";
import type { SpendLedger } from "../../../src/server/lib/agent-wallet/ledger";
import { freshSpendEnv, W } from "./lib/harness-env";

/** One begin() against an existing ledger+wallet env → HTTP status. */
async function beginOnce(
  ledger: SpendLedger,
  caps: Record<string, number>,
  amountUsd = 20,
): Promise<number> {
  const env = freshSpendEnv(caps, false);
  await env.save();
  const enforcer = createSpendEnforcer({
    ledger,
    registry: env.registry,
    requireRegistered: false,
  });
  const app = new Hono();
  app.post("/e", async (c: Context) => {
    const b = await enforcer.begin(c, amountUsd, "x402", "after");
    if (b instanceof Response) return b;
    return c.json({ ok: true });
  });
  const res = await app.request("/e", {
    method: "POST",
    headers: { "x-wallet": W },
  });
  return res.status;
}

/* ------------------------------- race probe ----------------------------- */

describe("own-invariant: reserve check-then-insert race (D-255-Q22)", () => {
  it("db-backed ledger + barrier: all 8 begins pass, $60 overshoot", async () => {
    // dailyUsd 100, 8×$20 — sequential allows 5 (80+20==100 allowed,
    // 6th sees 100 → 120>100 denied).
    const { probe, ledger } = await runRaceProbe({
      n: 8,
      amountUsd: 20,
      dailyUsd: 100,
      backend: "db-barrier",
    });
    expect(probe.sequentialAllowed).toBe(5); // sanity: caps work at all
    // Barrier → every checkEnvelope saw the same pre-insert state.
    expect(probe.allowed).toBe(8);
    expect(probe.reservedEntries).toBe(8);
    expect(probe.overshootUsd).toBe(60);

    // Post-settle: settled still counts → next begin denied.
    const entries = await ledger.listByWallet(W);
    for (const e of entries) await ledger.transition(e.id, "settled");
    expect(await beginOnce(ledger, { dailyUsd: 100 })).toBe(402);
  });

  it("memory backend stress (no barrier): N=32 — observation only", async () => {
    const { probe } = await runRaceProbe({
      n: 32,
      amountUsd: 10,
      dailyUsd: 100,
      backend: "memory",
    });
    // Observation, not proof: every begin awaits registry.get →
    // listByWallet → insert; coroutines interleave in lockstep so
    // all see pre-insert state. Recorded, whatever the count.
    expect(probe.allowed).toBeGreaterThanOrEqual(1);
    expect(probe.sequentialAllowed).toBe(10);
  });
});

/* ----------------------------- evidence matrix --------------------------- */

describe("own-invariant: evidence matrix 7×6 (D-255-Q24)", () => {
  it("every deny branch classified by what it leaves behind", async () => {
    const rows = await runEvidenceMatrix();
    const by = Object.fromEntries(rows.map((r) => [r.branch, r]));

    // suspended → denied entry + wallet.suspended_deny alert + 402.
    expect(by["suspended"].http).toBe(402);
    expect(by["suspended"].durable).toBe("denied:spend_suspended");
    expect(by["suspended"].alert).toBe("wallet.suspended_deny");

    // kind → denied entry + spend.kind_denied + 402.
    expect(by["kind"].durable).toBe("denied:kind_not_allowed");
    expect(by["kind"].alert).toBe("spend.kind_denied");

    // cap → denied entry + spend.cap_denied + 402 spend_cap.
    expect(by["cap"].durable).toBe("denied:perTx");
    expect(by["cap"].alert).toBe("spend.cap_denied");
    expect(by["cap"].reason).toBe("spend_cap");

    // velocity → denied entry + spend.velocity_denied, wire=cap name.
    expect(by["velocity"].durable).toBe("denied:velocity_tx");
    expect(by["velocity"].alert).toBe("spend.velocity_denied");
    expect(by["velocity"].reason).toBe("velocity_tx");

    // not-registered → 402 but ZERO evidence (no entry, no alert).
    expect(by["not-registered"].http).toBe(402);
    expect(by["not-registered"].durable).toBeNull();
    expect(by["not-registered"].alert).toBeNull();

    // registry-throw → 500, ZERO evidence — the V21 gap, again.
    expect(by["registry-throw"].http).toBe(500);
    expect(by["registry-throw"].durable).toBeNull();
    expect(by["registry-throw"].alert).toBeNull();

    // corrupted-json → spend ALLOWED (fail-open) + file clobbered.
    expect(by["corrupted-json"].http).toBe(200);
    expect(by["corrupted-json"].reservation).toBe(true);
  });

  it("evidence-write failure → fail-closed 500, no alert, no spend", async () => {
    const r = await runEvidenceFailClosed();
    expect(r.http).toBe(500);
    expect(r.reservation).toBe(false);
    expect(r.alertEmitted).toBe(false);
  });
});

/* ---------------------------- caller-dedup table ------------------------- */

const CALLER_DEDUP = [
  {
    caller: "x402-hooks (requirePayment seam)",
    site: "src/server/lib/agent-wallet/x402-hooks.ts:28",
    refId: "x402:{METHOD} {path}",
    idempotency: "none — refId is correlation-only; ledger has no dedup key",
    verified: "code-read + replay probes (255-2/255-3 double-reserve)",
  },
  {
    caller: "envelope-gate middleware (venue subscribe)",
    site: "src/server/wiring/agent-wallet.ts:84",
    refId: "sub:{instanceId}",
    idempotency: "none — same instance resubscribe re-reserves",
    verified: "code-read",
  },
  {
    caller: "envelope-gate fallback refIdFor",
    site: "src/server/lib/agent-wallet/envelope-gate.ts:41",
    refId: "${kind}:{random12}",
    idempotency: "none — random per request, no caller correlation at all",
    verified: "code-read",
  },
  {
    caller: "withEnvelope call-site",
    site: "src/server/lib/agent-wallet/envelope-gate.ts:60",
    refId: "caller-supplied",
    idempotency: "none — no prod call sites found in src/",
    verified: "code-read (no wired callers)",
  },
  {
    caller: "bstock-freemium (mcp/bstock pay path)",
    site: "src/server/middleware/bstock-freemium.ts:189",
    refId: "bstock:{serviceId}",
    idempotency: "none — every payment to a service shares one refId",
    verified: "code-read",
  },
  {
    caller: "buy-gateway (fx-rate → buyPay)",
    site: "src/server/lib/buy/fx-rate.ts:67",
    refId: "buyfx:{fiatPair}",
    idempotency: "none — enforcer-mirror path, same check-then-insert",
    verified: "code-read",
  },
  {
    caller: "delegate-api / spendAsDelegate",
    site: "src/server/lib/agent-wallet/delegate.ts:136",
    refId: "—",
    idempotency: "n/a — NOT WIRED: no route calls spendAsDelegate in src/",
    verified: "code-read (grep: only tests + comment refs)",
  },
];

/* ------------------------------ results write ---------------------------- */

describe("own-invariant results", () => {
  it("writes results/own-invariants.json (source=own-invariant)", async () => {
    const barrier = await runRaceProbe({
      n: 8,
      amountUsd: 20,
      dailyUsd: 100,
      backend: "db-barrier",
    });
    const memory = await runRaceProbe({
      n: 32,
      amountUsd: 10,
      dailyUsd: 100,
      backend: "memory",
    });
    const matrix = await runEvidenceMatrix();
    const failClosed = await runEvidenceFailClosed();
    const out = {
      schema_version: RESULT_SCHEMA_VERSION,
      corpus_version: CORPUS_VERSION,
      source: "own-invariant",
      race: {
        db_barrier: barrier.probe,
        memory_stress: memory.probe,
        note: "observation, not proof — absence of overshoot would not prove atomicity",
      },
      evidence: { matrix, failClosed },
      callerDedup: CALLER_DEDUP,
      findings: [
        {
          id: "OWN-1",
          title: "check-then-insert TOCTOU: parallel begins overshoot caps",
          severity: "high",
          evidence: `${barrier.probe.allowed}/${barrier.probe.n} parallel begins reserved ($${barrier.probe.reservedUsd} vs $100 cap); sequential baseline ${barrier.probe.sequentialAllowed}/${barrier.probe.n}`,
          candidate_for:
            "EPIC-234: atomic check+insert (conditional insert / lock / serializable txn)",
        },
        {
          id: "OWN-2",
          title: "corrupted-JSON ledger fails OPEN and clobbers history",
          severity: "high",
          evidence:
            "garbage ledger.json → readJson catch → entries={} → spend allowed; insert overwrites file",
          candidate_for:
            "EPIC-234: fail-closed on unreadable ledger, or quarantine + alert",
        },
        {
          id: "OWN-3",
          title:
            "not-registered + registry-throw deny without evidence",
          severity: "medium",
          evidence:
            "402/500 with no ledger entry and no alert (V21 GATE_EXCEPTION reproduces)",
          candidate_for:
            "EPIC-234: denied-attempt evidence for all deny paths",
        },
        {
          id: "OWN-4",
          title: "refId is never a dedup key — retries double-charge caps",
          severity: "medium",
          evidence:
            "all callers: static per-path/service/instance refIds or random; ledger idempotent only on sp_ uuid",
          candidate_for:
            "EPIC-234: caller idempotency key → ledger unique index",
        },
      ],
    };
    const file = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "results",
      "own-invariants.json",
    );
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
    expect(matrix).toHaveLength(7);
    expect(barrier.probe.overshootUsd).toBe(60);
  });
});
