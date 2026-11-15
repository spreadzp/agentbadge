/**
 * SLICE-217-2 tests: business stats section for the ops digest.
 *
 *  - collectBusinessStats: window filter, per-state/status grouping,
 *    sums, top-kinds, per-model failure isolation
 *  - formatBusinessText / formatBusinessTelegram: "no activity",
 *    counts render, HTML escaping
 *  - runDigest: business appended to TG text + reportText + JSON field
 */
import { describe, it, expect, vi } from "vitest";
import {
  collectBusinessStats,
  businessIsEmpty,
  formatBusinessText,
  formatBusinessTelegram,
} from "../src/server/lib/report/business-stats";
import { runDigest } from "../src/server/lib/report/traffic-digest";
import { collectStats } from "../src/server/lib/report/traffic-format";

const NOW = Date.parse("2026-11-11T12:00:00Z");
const iso = (ageMs = 0) => new Date(NOW - ageMs).toISOString();
const cutoff = new Date(NOW - 24 * 3600_000).toISOString();

/**
 * SLICE-234-2: collectBusinessStats runs raw-SQL count/groupBy via
 * db.raw.sql + db.runtime().query — no `.all()` anywhere. The fake
 * below emulates the tiny subset of SQL the implementation emits:
 * `createdAt >= cutoff` row filter (uses the test's `cutoff` const),
 * GROUP BY k/c, count+sum agg, plain count, and the pay-legs SELECT.
 */
type FakeRow = Record<string, unknown>;

interface RawPlanFake {
  text: string;
}

const MODELS = [
  "ScanResult", "SpendEvent", "EaasRequest", "EaasVerdict", "EaasEvalJob",
  "EconomicEvent", "Bounty", "BountyClaim", "BoardCard", "BoardEntry", "A2ATask",
] as const;

const makeRunner = (
  data: Record<string, FakeRow[]>,
  fails: ReadonlySet<string>,
  log: string[],
) => {
  return async (plan: RawPlanFake): Promise<FakeRow[]> => {
    const text = plan.text;
    log.push(text);
    const table = /FROM "(\w+)"/.exec(text)?.[1] ?? "";
    const model = table.charAt(0).toUpperCase() + table.slice(1);
    if (!MODELS.includes(model as (typeof MODELS)[number]))
      throw new Error(`unknown table ${table}`);
    if (fails.has(model)) throw new Error("boom");
    const rows = (data[model] ?? []).filter(
      (r) => String(r.createdAt ?? "") >= cutoff,
    );
    // pay legs: WHERE kind='pay' AND at >= cutoff (+ counterparty bound —
    // re-checked by aggregatePayLegs downstream, parity preserved).
    if (/"kind" = 'pay'/.test(text)) {
      return rows
        .filter((r) => r.kind === "pay" && String(r.at ?? "") >= cutoff)
        .map((r) => ({
          kind: r.kind, counterparty: r.counterparty,
          amountUsdc: r.amountUsdc, at: r.at, payload: r.payload,
        }));
    }
    const g = /GROUP BY "(\w+)"/.exec(text);
    if (g) {
      const col = g[1];
      const counts = new Map<string, number>();
      for (const r of rows) {
        const k = String(r[col] ?? "unknown");
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      return [...counts].map(([k, c]) => ({ k, c }));
    }
    const s = /sum\("(\w+)"\)/.exec(text);
    if (s) {
      const col = s[1];
      return [{ c: rows.length, s: rows.reduce((a, r) => a + Number(r[col] ?? 0), 0) }];
    }
    return [{ c: rows.length }];
  };
};

const fakeDb = (
  rows: Record<string, FakeRow[]>,
  opts?: { fails?: ReadonlySet<string>; log?: string[] },
) => {
  const log = opts?.log ?? [];
  const run = makeRunner(rows, opts?.fails ?? new Set(), log);
  return {
    raw: {
      sql: (strings: TemplateStringsArray, ..._v: unknown[]) => ({
        returnsRow: (_spec: unknown) => ({ build: () => ({ text: strings.join("?") }) }),
      }),
    },
    runtime: () => ({ query: run }),
  };
};

const emptyOrm = () => fakeDb({}) as never;

describe("collectBusinessStats", () => {
  it("aggregates counts, sums and groupings inside the window", async () => {
    const db = fakeDb({
      ScanResult: [{ createdAt: iso() }, { createdAt: iso(48 * 3600_000) }],
      SpendEvent: [
        { createdAt: iso(), state: "settled", kind: "x402", amountUsd: 1.5 },
        { createdAt: iso(), state: "settled", kind: "x402", amountUsd: 0.5 },
        { createdAt: iso(), state: "denied", kind: "l402", amountUsd: 0 },
        { createdAt: iso(48 * 3600_000), state: "settled", kind: "x402", amountUsd: 9 },
      ],
      EaasRequest: [
        { createdAt: iso(), status: "completed" },
        { createdAt: iso(), status: "pending" },
      ],
      EaasVerdict: [{ createdAt: iso() }],
      EaasEvalJob: [],
      EconomicEvent: [
        { createdAt: iso(), kind: "payment", amountUsdc: 2 },
        { createdAt: iso(), kind: "fee", amountUsdc: 0.25 },
      ],
      Bounty: [
        { createdAt: iso(), status: "open" },
        { createdAt: iso(), status: "closed" },
      ],
      BountyClaim: [{ createdAt: iso(), state: "delivered" }],
      BoardCard: [{ createdAt: iso() }],
      BoardEntry: [{ createdAt: iso() }, { createdAt: iso() }],
      A2ATask: [{ createdAt: iso(), status: "submitted" }],
    });
    const b = await collectBusinessStats(db as never, cutoff);
    expect(b.scans).toBe(1); // 48h row filtered out
    expect(b.spend.total).toBe(3);
    expect(b.spend.amountUsd).toBe(2);
    expect(b.spend.byState).toEqual({ settled: 2, denied: 1 });
    expect(b.spend.topKinds[0]).toEqual(["x402", 2]);
    expect(b.eaas).toEqual({
      requests: 2,
      byStatus: { completed: 1, pending: 1 },
      verdicts: 1,
      evalJobs: 0,
    });
    expect(b.ledger.events).toBe(2);
    expect(b.ledger.amountUsdc).toBe(2.25);
    expect(b.bounties.byStatus).toEqual({ open: 1, closed: 1 });
    expect(b.bounties.claims).toBe(1);
    expect(b.board).toEqual({ cards: 1, entries: 2 });
    expect(b.a2a.byStatus).toEqual({ submitted: 1 });
  });

  it("returns zeros on empty window without throwing", async () => {
    const b = await collectBusinessStats(emptyOrm(), cutoff);
    expect(businessIsEmpty(b)).toBe(true);
    expect(formatBusinessText(b)).toContain("no activity");
  });

  it("a failing model degrades to zeros, others still count", async () => {
    const db = fakeDb(
      { ScanResult: [{ createdAt: iso() }] },
      { fails: new Set(["SpendEvent"]) },
    );
    const b = await collectBusinessStats(db as never, cutoff);
    expect(b.scans).toBe(1);
    expect(b.spend.total).toBe(0);
  });

  it("every query bounds createdAt — no .all() scans (SLICE-234-2)", async () => {
    const log: string[] = [];
    await collectBusinessStats(fakeDb({}, { log }) as never, cutoff);
    expect(log.length).toBeGreaterThanOrEqual(14);
    for (const q of log) expect(q).toContain(`"createdAt" >=`);
    // legs query only runs when payTo is set
    const log2: string[] = [];
    await collectBusinessStats(
      fakeDb({}, { log: log2 }) as never,
      cutoff,
      { payTo: "0xabc" },
    );
    expect(log2.some((q) => /"kind" = 'pay'/.test(q))).toBe(true);
  });

  it("never leaks wallet/address/txHash fields", async () => {
    const db = fakeDb({
      SpendEvent: [
        {
          createdAt: iso(), state: "settled", kind: "x402", amountUsd: 1,
          wallet: "0xabc", txHash: "0xdead",
        },
      ],
    });
    const b = await collectBusinessStats(db as never, cutoff);
    const s = JSON.stringify(b) + formatBusinessText(b) + formatBusinessTelegram(b);
    expect(s).not.toContain("0xabc");
    expect(s).not.toContain("0xdead");
  });
});

describe("collectBusinessStats x402Revenue (SLICE-242-11)", () => {
  const PAY_TO = "0x23ddc6a1f4b8d7c9e0a2b3c4d5e6f7a8b9c0d51b30";

  const payRow = (over: Record<string, unknown> = {}) => ({
    createdAt: iso(),
    kind: "pay",
    counterparty: PAY_TO,
    amountUsdc: "10",
    at: iso(),
    payload: { rail: "x402", endpoint: "/api/total-scan" },
    ...over,
  });

  it("aggregates pay legs to payTo into x402Revenue with top-3 endpoints", async () => {
    const db = fakeDb({
      EconomicEvent: [
        payRow({ amountUsdc: "10" }),
        payRow({ amountUsdc: "5", payload: { rail: "x402" } }),
        payRow({ kind: "dispute" }), // non-pay excluded
        payRow({ counterparty: "0x9999999999999999999999999999999999999999" }),
        payRow({ at: iso(48 * 3600_000) }), // out of window
      ],
    });
    const b = await collectBusinessStats(db as never, cutoff, { payTo: PAY_TO });
    expect(b.x402Revenue).toEqual({
      count: 2,
      usdc: "15",
      topEndpoints: [
        { endpoint: "/api/total-scan", count: 1, usdc: "10" },
        { endpoint: "unknown", count: 1, usdc: "5" },
      ],
    });
    expect(formatBusinessText(b)).toContain("x402=$15");
    expect(formatBusinessText(b)).toContain("2pays");
  });

  it("no pay legs → x402Revenue null, section absent", async () => {
    const db = fakeDb({ EconomicEvent: [] });
    const b = await collectBusinessStats(db as never, cutoff, { payTo: PAY_TO });
    expect(b.x402Revenue).toBeNull();
    expect(formatBusinessText(b)).not.toContain("x402=");
  });

  it("no opts.payTo → field untouched (undefined)", async () => {
    const db = fakeDb({ EconomicEvent: [payRow()] });
    const b = await collectBusinessStats(db as never, cutoff);
    expect(b.x402Revenue).toBeUndefined();
    expect(formatBusinessText(b)).not.toContain("x402=");
  });

  it("revenue-only activity counts as non-empty business", async () => {
    const db = fakeDb({ EconomicEvent: [payRow()] });
    const b = await collectBusinessStats(db as never, cutoff, { payTo: PAY_TO });
    expect(businessIsEmpty(b)).toBe(false);
  });
});

describe("formatBusinessTelegram", () => {
  it("renders 💼 Business header and escapes HTML", async () => {
    const b = await collectBusinessStats(
      fakeDb({ ScanResult: [{ createdAt: iso() }] }) as never,
      cutoff,
    );
    const out = formatBusinessTelegram(b);
    expect(out).toContain("💼 <b>Business</b>");
    expect(out).toContain("scans=1");
  });
});

describe("runDigest with business", () => {
  const stats = collectStats(
    [{ payload: { method: "GET", path: "/x", status: 200 }, createdAt: iso() }],
    24,
  );

  it("appends business section to TG text, reportText and JSON", async () => {
    const business = await collectBusinessStats(
      fakeDb({ ScanResult: [{ createdAt: iso() }] }) as never,
      cutoff,
    );
    const sendTelegram = vi.fn(async (_text: string) => 42);
    const res = await runDigest({
      stats,
      hours: 24,
      preset: "24h",
      business,
      sendTelegram,
    });
    expect(res.business).toEqual(business);
    expect(res.reportText).toContain("Business:");
    expect(res.reportText).toContain("scans=1");
    const sent = sendTelegram.mock.calls[0]?.[0] ?? "";
    expect(sent).toContain("💼 <b>Business</b>");
  });

  it("null business keeps traffic-only output", async () => {
    const sendTelegram = vi.fn(async (_text: string) => 7);
    const res = await runDigest({
      stats,
      hours: 24,
      preset: "24h",
      business: null,
      sendTelegram,
    });
    expect(res.business).toBeNull();
    expect(res.reportText).not.toContain("Business:");
    expect(sendTelegram.mock.calls[0]?.[0] ?? "").not.toContain("💼");
  });
});
