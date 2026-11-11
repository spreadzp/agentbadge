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

const emptyOrm = () => {
  const pub: Record<string, { all: () => Promise<unknown[]> }> = {};
  for (const m of [
    "ScanResult", "SpendEvent", "EaasRequest", "EaasVerdict", "EaasEvalJob",
    "EconomicEvent", "Bounty", "BountyClaim", "BoardCard", "BoardEntry", "A2ATask",
  ]) pub[m] = { all: async () => [] };
  return { orm: { public: pub } } as never;
};

const fakeDb = (rows: Record<string, Record<string, unknown>[]>) => {
  const base = emptyOrm() as { orm: { public: Record<string, { all: () => Promise<unknown[]> }> } };
  for (const [k, v] of Object.entries(rows)) base.orm.public[k] = { all: async () => v };
  return base;
};

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
    const db = emptyOrm() as { orm: { public: Record<string, { all: () => Promise<unknown[]> }> } };
    db.orm.public.ScanResult.all = async () => [{ createdAt: iso() }];
    db.orm.public.SpendEvent.all = async () => {
      throw new Error("boom");
    };
    const b = await collectBusinessStats(db as never, cutoff);
    expect(b.scans).toBe(1);
    expect(b.spend.total).toBe(0);
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
