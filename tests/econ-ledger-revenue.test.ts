/**
 * SLICE-242-9: /api/ledger/revenue — live aggregation over pay legs.
 * Mock-store tests: auth gate, kind/counterparty filters, unknown-endpoint
 * bucket, window bounds, no_data envelope.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryEconLedgerStore, type Database } from "@agentbadge/database";
import { emitEconomicBatch } from "../src/server/lib/econ-ledger/emit.js";
import type { BuildEventInput } from "@agentbadge/econ-events";
import { createRevenueRoutes } from "../src/server/routes/econ-ledger-revenue-api";

const PAY_TO = "0x23ddc6a1f4b8d7c9e0a2b3c4d5e6f7a8b9c0d51b3"
  .padEnd(42, "0")
  .slice(0, 42) as `0x${string}`;
const TOKEN = "test-ops-token";

const now = () => Date.parse("2026-11-12T12:00:00Z");
const ISO = (d: string) => `${d}T10:00:00.000Z`;

function payEvent(over: Partial<BuildEventInput> = {}): BuildEventInput {
  return {
    source: "x402",
    sourceId: `tx-${Math.random().toString(36).slice(2)}`,
    seq: 1,
    kind: "pay",
    actor: "0xpayer",
    counterparty: PAY_TO,
    amountUsdc: "5",
    at: ISO("2026-11-10"),
    payload: { rail: "x402", endpoint: "/api/total-scan" },
    ...over,
  };
}

function appWith(
  ledger: InMemoryEconLedgerStore,
  opts: { dbEnabled?: boolean; payTo?: string | undefined } = {},
) {
  const dbEnabled = opts.dbEnabled ?? true;
  const getDb = () =>
    ({
      db: dbEnabled ? ({} as unknown) : null,
      econLedger: ledger,
    }) as unknown as Database;
  return createRevenueRoutes({
    getDb,
    payTo: () => ("payTo" in opts ? opts.payTo : PAY_TO),
    now,
  });
}

const get = (app: ReturnType<typeof createRevenueRoutes>, qs = "", auth = true) =>
  app.request(`/api/ledger/revenue${qs}`, {
    headers: auth ? { Authorization: `Bearer ${TOKEN}` } : {},
  });

beforeEach(() => {
  vi.stubEnv("METRICS_BEARER_TOKEN", TOKEN);
});

describe("GET /api/ledger/revenue", () => {
  it("401 without ops bearer", async () => {
    const res = await get(appWith(new InMemoryEconLedgerStore()), "", false);
    expect(res.status).toBe(401);
  });

  it("aggregates pay legs by day and endpoint", async () => {
    const ledger = new InMemoryEconLedgerStore();
    await emitEconomicBatch(
      [
        payEvent({ amountUsdc: "10", at: ISO("2026-11-10") }),
        payEvent({ amountUsdc: "5", at: ISO("2026-11-10") }),
        payEvent({
          amountUsdc: "3.5",
          at: ISO("2026-11-11"),
          payload: { rail: "x402", endpoint: "/api/verify" },
        }),
      ],
      ledger,
    );
    const res = await get(appWith(ledger));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.payTo).toBe(PAY_TO);
    expect(body.total).toEqual({ count: 3, usdc: "18.5" });
    expect(body.byDay).toEqual([
      { day: "2026-11-10", count: 2, usdc: "15" },
      { day: "2026-11-11", count: 1, usdc: "3.5" },
    ]);
    expect(body.byEndpoint).toEqual([
      { endpoint: "/api/total-scan", count: 2, usdc: "15" },
      { endpoint: "/api/verify", count: 1, usdc: "3.5" },
    ]);
  });

  it("excludes non-pay kinds and wrong counterparty; missing endpoint → unknown", async () => {
    const ledger = new InMemoryEconLedgerStore();
    await emitEconomicBatch(
      [
        payEvent({ amountUsdc: "10" }),
        payEvent({ kind: "dispute", amountUsdc: "99" }),
        payEvent({
          counterparty: "0x9999999999999999999999999999999999999999",
          amountUsdc: "77",
        }),
        payEvent({ amountUsdc: "2", payload: { rail: "x402" } }),
      ],
      ledger,
    );
    const res = await get(appWith(ledger));
    const body = await res.json();
    expect(body.total).toEqual({ count: 2, usdc: "12" });
    expect(body.byEndpoint).toEqual([
      { endpoint: "/api/total-scan", count: 1, usdc: "10" },
      { endpoint: "unknown", count: 1, usdc: "2" },
    ]);
  });

  it("window bound: events older than days excluded", async () => {
    const ledger = new InMemoryEconLedgerStore();
    await emitEconomicBatch(
      [
        payEvent({ amountUsdc: "5", at: ISO("2026-11-11") }),
        payEvent({ amountUsdc: "100", at: ISO("2026-10-01") }),
      ],
      ledger,
    );
    const res = await get(appWith(ledger), "?days=7");
    const body = await res.json();
    expect(body.total).toEqual({ count: 1, usdc: "5" });
    expect(body.window.days).toBe(7);
  });

  it("invalid days → 400", async () => {
    const res = await get(appWith(new InMemoryEconLedgerStore()), "?days=0");
    expect(res.status).toBe(400);
    const res2 = await get(
      appWith(new InMemoryEconLedgerStore()),
      "?days=abc",
    );
    expect(res2.status).toBe(400);
  });

  it("DATABASE_ENABLED=false → no_data envelope, not 500", async () => {
    const res = await get(
      appWith(new InMemoryEconLedgerStore(), { dbEnabled: false }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error.code).toBe("no_data");
    expect(body.total).toEqual({ count: 0, usdc: "0" });
  });

  it("payTo missing → 500 unavailable", async () => {
    const res = await get(appWith(new InMemoryEconLedgerStore(), { payTo: undefined as unknown as string }));
    expect(res.status).toBe(500);
  });
});
