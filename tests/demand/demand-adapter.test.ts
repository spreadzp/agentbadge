import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";

import {
  demandRoutes,
  resetDemandRateLimits,
} from "../../src/server/routes/api/demand";
import {
  pickDemandStore,
  resetDemandMemoryStoreForTests,
} from "../../src/server/lib/demand/db-stores";

/**
 * SLICE-231-3: legacy adapter — POST /api/demand/request is a thin
 * shim over ingestDemand; the frozen contract (202, demand_id, count,
 * priority) is preserved while writes land in the persisted pipeline.
 *
 * Mounted on a bare Hono app — the shared test-app tree is outside
 * this slice's scope.
 */

const app = new Hono();
app.route("/", demandRoutes);

const post = (body: unknown, ip?: string) =>
  app.request("/api/demand/request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(ip ? { "x-forwarded-for": ip } : {}),
    },
    body: JSON.stringify(body),
  });

const store = () => pickDemandStore({});

describe("SLICE-231-3: POST /api/demand/request → pipeline adapter", () => {
  beforeEach(() => {
    resetDemandMemoryStoreForTests();
    resetDemandRateLimits();
  });

  it("returns the frozen 202 contract shape", async () => {
    const res = await post({ capability_query: "solidity audit" });
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.demand_id).toMatch(/^ds_/);
    expect(json.capability_query).toBe("solidity audit");
    expect(json.count).toBe(1);
    expect(json.priority).toBe("backlog");
    expect(json.status).toBe("accepted");
  });

  it("writes a DEMAND_API signal through the pipeline", async () => {
    await post({
      capability_query: "solidity audit",
      context: "We need audits",
    });
    const signals = await store().listSignals({ source: "DEMAND_API" });
    expect(signals.length).toBe(1);
    const s = signals[0];
    expect(s.declaredLevel).toBe("INTENT");
    expect(s.level).toBe("INTENT");
    expect(s.normalizedText).toBe("solidity audit");
    expect(s.context).toBe("We need audits");
    expect(s.actorResolution).toBe("ANON");
    expect(s.actorRef).toMatch(/^anon:ip:/);
    expect(s.clusterId).toBeTruthy();
  });

  it("same actor+text in-window bursts onto the canonical — same demand_id", async () => {
    const r1 = await post({ capability_query: "solidity audit" });
    const r2 = await post({ capability_query: "  Solidity   Audit  " });
    const j1 = await r1.json();
    const j2 = await r2.json();
    expect(j2.demand_id).toBe(j1.demand_id);
    expect(j2.count).toBe(2);
    const canonicals = await store().listSignals({ canonicalOnly: true });
    expect(canonicals.length).toBe(1);
    expect(canonicals[0].relatedCount).toBe(2);
  });

  it("different queries land in separate clusters", async () => {
    const r1 = await post({ capability_query: "solidity audit" });
    const r2 = await post({ capability_query: "react development" });
    const j1 = await r1.json();
    const j2 = await r2.json();
    expect(j1.demand_id).not.toBe(j2.demand_id);
    expect(j1.count).toBe(1);
    expect(j2.count).toBe(1);
  });

  // Arc 231 R1 M3: priority derives from DISTINCT actors — one actor
  // repeating the same need must never push it to candidate/priority.
  it("priority=candidate at 5 distinct actors", async () => {
    process.env.TRUST_PROXY_HEADERS = "true";
    try {
      for (let i = 0; i < 4; i++) {
        await post({ capability_query: "solidity audit" }, `10.1.0.${i + 1}`);
      }
      const res = await post(
        { capability_query: "solidity audit" },
        "10.1.0.5",
      );
      const json = await res.json();
      expect(json.count).toBe(5);
      expect(json.priority).toBe("candidate");
    } finally {
      delete process.env.TRUST_PROXY_HEADERS;
    }
  });

  it("priority=priority at 20 distinct actors", async () => {
    process.env.TRUST_PROXY_HEADERS = "true";
    try {
      for (let i = 0; i < 19; i++) {
        await post({ capability_query: "rust development" }, `10.2.0.${i + 1}`);
      }
      const res = await post(
        { capability_query: "rust development" },
        "10.2.0.20",
      );
      const json = await res.json();
      expect(json.count).toBe(20);
      expect(json.priority).toBe("priority");
    } finally {
      delete process.env.TRUST_PROXY_HEADERS;
    }
  });

  it("20 repeats from ONE actor stay backlog — uniqueActors never inflates", async () => {
    process.env.TRUST_PROXY_HEADERS = "true";
    try {
      for (let i = 0; i < 19; i++) {
        await post({ capability_query: "wasm runtime" }, "10.9.9.9");
        if (i === 9) resetDemandRateLimits();
      }
      const res = await post(
        { capability_query: "wasm runtime" },
        "10.9.9.9",
      );
      const json = await res.json();
      expect(json.count).toBe(20);
      expect(json.priority).toBe("backlog");
      const cluster = (await store().listClusters())[0];
      expect(cluster.uniqueActors).toBe(1);
    } finally {
      delete process.env.TRUST_PROXY_HEADERS;
    }
  });

  it("emits signal + cluster events through the same write", async () => {
    const res = await post({ capability_query: "solidity audit" });
    const { demand_id } = await res.json();
    const events = await store().listEvents("signal", demand_id);
    expect(events.some((e) => e.kind === "demand.signal.created")).toBe(
      true,
    );
    expect(events.some((e) => e.visibility === "INTERNAL")).toBe(true);
  });

  it("optional Idempotency-Key replays to the same record", async () => {
    const key = "adapter-idem-key-1";
    const postKeyed = () =>
      app.request("/api/demand/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ capability_query: "solidity audit" }),
      });
    const r1 = await postKeyed();
    const r2 = await postKeyed();
    const j1 = await r1.json();
    const j2 = await r2.json();
    expect(r1.status).toBe(202);
    expect(r2.status).toBe(202);
    expect(j2.demand_id).toBe(j1.demand_id);
    expect(j2.count).toBe(j1.count);
    expect((await store().listSignals()).length).toBe(1);
  });

  it("400 on malformed Idempotency-Key", async () => {
    const res = await app.request("/api/demand/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "x",
      },
      body: JSON.stringify({ capability_query: "solidity audit" }),
    });
    expect(res.status).toBe(400);
  });

  it("400 on missing/empty/oversized capability_query", async () => {
    expect((await post({ context: "no query" })).status).toBe(400);
    expect((await post({ capability_query: "  " })).status).toBe(400);
    expect(
      (await post({ capability_query: "a".repeat(201) })).status,
    ).toBe(400);
    expect(
      (await post({ capability_query: "ok", context: "x".repeat(1001) }))
        .status,
    ).toBe(400);
  });

  it("400 on invalid JSON", async () => {
    const res = await app.request("/api/demand/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("429 after 10 requests/hour — limiter unchanged", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await post({ capability_query: `query ${i}` })).status).toBe(
        202,
      );
    }
    const res = await post({ capability_query: "over limit" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeDefined();
  });
});
