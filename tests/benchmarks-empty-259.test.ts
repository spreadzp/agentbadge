import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";

// SLICE-259-21: empty corpus is a 200 empty collection — not a 503.
// 503 is reserved for genuine source failure (store throws).

interface StoreStub {
  query(): Promise<unknown[]>;
  getStats(): Promise<unknown>;
}

async function appWithStore(store: StoreStub) {
  vi.resetModules();
  vi.doMock("../src/agent-readiness/corpus/corpus-store", () => ({
    FileCorpusStore: class {
      query() {
        return store.query();
      }
      getStats() {
        return store.getStats();
      }
    },
  }));
  const { benchmarkRoutes } = await import(
    "../src/server/routes/benchmark/benchmark-api"
  );
  return new Hono().route("/", benchmarkRoutes);
}

const EMPTY: StoreStub = {
  async query() {
    return [];
  },
  async getStats() {
    return { total: 0 };
  },
};

const FAILING: StoreStub = {
  async query() {
    throw new Error("corpus dir unreadable");
  },
  async getStats() {
    throw new Error("corpus dir unreadable");
  },
};

describe("SLICE-259-21: /api/benchmarks empty vs failed", () => {
  it("empty corpus → 200 {sample_count:0,data:[],note:'no_data'}", async () => {
    const app = await appWithStore(EMPTY);
    const res = await app.request("/api/benchmarks");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.sample_count).toBe(0);
    expect(body.data).toEqual([]);
    expect(body.note).toBe("no_data");
    expect(body.error).toBeUndefined();
  });

  it("empty category → 200 with the same empty-collection contract", async () => {
    const app = await appWithStore(EMPTY);
    const res = await app.request("/api/benchmarks/payments");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.sample_count).toBe(0);
    expect(body.data).toEqual([]);
    expect(body.note).toBe("no_data");
  });

  it("empty pillar → 200 with the same empty-collection contract", async () => {
    const app = await appWithStore(EMPTY);
    const res = await app.request("/api/benchmarks/pillars/discovery");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.sample_count).toBe(0);
    expect(body.data).toEqual([]);
    expect(body.note).toBe("no_data");
  });

  it("store failure → 503 source_unavailable (distinguished from empty)", async () => {
    const app = await appWithStore(FAILING);
    const res = await app.request("/api/benchmarks");
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("source_unavailable");
    expect(body.retryable).toBe(true);
  });
});
