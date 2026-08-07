import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, setupMockEnv } from "./e2e/helpers";
import { demandStore } from "../src/server/services/demand-registry";
import { resetDemandRateLimits } from "../src/server/routes/api/demand";

setupMockEnv();
const app = makeTestApp();

describe("SLICE-46-12: Demand API + storage + aggregation + agent docs", () => {
  beforeEach(() => {
    demandStore.clear();
    resetDemandRateLimits();
  });

  describe("POST /api/demand/request", () => {
    it("returns 202 with demand_id", async () => {
      const res = await app.request("/api/demand/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability_query: "solidity audit" }),
      });
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.demand_id).toBeDefined();
      expect(json.demand_id).toMatch(/^demand-/);
    });

    it("returns capability_query in response", async () => {
      const res = await app.request("/api/demand/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability_query: "solidity audit" }),
      });
      const json = await res.json();
      expect(json.capability_query).toBe("solidity audit");
    });

    it("returns count=1 for first request", async () => {
      const res = await app.request("/api/demand/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability_query: "solidity audit" }),
      });
      const json = await res.json();
      expect(json.count).toBe(1);
    });

    it("returns priority=backlog for first request", async () => {
      const res = await app.request("/api/demand/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability_query: "solidity audit" }),
      });
      const json = await res.json();
      expect(json.priority).toBe("backlog");
    });

    it("returns status=accepted", async () => {
      const res = await app.request("/api/demand/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability_query: "solidity audit" }),
      });
      const json = await res.json();
      expect(json.status).toBe("accepted");
    });

    it("accepts optional context", async () => {
      const res = await app.request("/api/demand/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capability_query: "solidity audit",
          context: "We need audits for Hedera smart contracts",
        }),
      });
      expect(res.status).toBe(202);
    });

    it("returns 400 for missing capability_query", async () => {
      const res = await app.request("/api/demand/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: "no query" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for empty capability_query", async () => {
      const res = await app.request("/api/demand/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability_query: "  " }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid JSON", async () => {
      const res = await app.request("/api/demand/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });

    it("rejects capability_query over 200 chars", async () => {
      const res = await app.request("/api/demand/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability_query: "a".repeat(201) }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("Aggregation", () => {
    it("same query increments count", async () => {
      await app.request("/api/demand/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability_query: "solidity audit" }),
      });
      const res2 = await app.request("/api/demand/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability_query: "solidity audit" }),
      });
      const json = await res2.json();
      expect(json.count).toBe(2);
    });

    it("normalizes query (lowercase, trim)", async () => {
      await app.request("/api/demand/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability_query: "Solidity Audit" }),
      });
      const res2 = await app.request("/api/demand/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability_query: "  solidity  audit  " }),
      });
      const json = await res2.json();
      expect(json.count).toBe(2);
    });

    it("different queries create separate records", async () => {
      const r1 = await app.request("/api/demand/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability_query: "solidity audit" }),
      });
      const r2 = await app.request("/api/demand/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability_query: "rust audit" }),
      });
      const j1 = await r1.json();
      const j2 = await r2.json();
      expect(j1.demand_id).not.toBe(j2.demand_id);
      expect(j1.count).toBe(1);
      expect(j2.count).toBe(1);
    });

    it("priority=candidate at 5 requests", async () => {
      for (let i = 0; i < 4; i++) {
        await app.request("/api/demand/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ capability_query: "solidity audit" }),
        });
      }
      const res = await app.request("/api/demand/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability_query: "solidity audit" }),
      });
      const json = await res.json();
      expect(json.count).toBe(5);
      expect(json.priority).toBe("candidate");
    });

    it("priority=priority at 20 requests", async () => {
      for (let i = 0; i < 10; i++) {
        await app.request("/api/demand/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ capability_query: "solidity audit" }),
        });
      }
      resetDemandRateLimits(); // reset to allow next batch
      for (let i = 0; i < 9; i++) {
        await app.request("/api/demand/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ capability_query: "solidity audit" }),
        });
      }
      const res = await app.request("/api/demand/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability_query: "solidity audit" }),
      });
      const json = await res.json();
      expect(json.count).toBe(20);
      expect(json.priority).toBe("priority");
    });
  });

  describe("Rate limiting", () => {
    it("allows up to 10 requests per hour", async () => {
      for (let i = 0; i < 10; i++) {
        const res = await app.request("/api/demand/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ capability_query: `query ${i}` }),
        });
        expect(res.status).toBe(202);
      }
    });

    it("returns 429 after 10 requests", async () => {
      for (let i = 0; i < 10; i++) {
        await app.request("/api/demand/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ capability_query: `query ${i}` }),
        });
      }
      const res = await app.request("/api/demand/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability_query: "over limit" }),
      });
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBeDefined();
    });

    it("includes X-RateLimit headers", async () => {
      const res = await app.request("/api/demand/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability_query: "test" }),
      });
      expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
      expect(res.headers.get("X-RateLimit-Remaining")).toBeDefined();
    });
  });

  describe("GET /agent-guide/demand", () => {
    it("returns Markdown docs", async () => {
      const res = await app.request("/agent-guide/demand");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("Demand Registry API");
      expect(text).toContain("POST /api/demand/request");
    });

    it("returns text/markdown content type", async () => {
      const res = await app.request("/agent-guide/demand");
      const ct = res.headers.get("Content-Type") || "";
      expect(ct).toContain("text/markdown");
    });

    it("mentions priority levels", async () => {
      const res = await app.request("/agent-guide/demand");
      const text = await res.text();
      expect(text).toContain("backlog");
      expect(text).toContain("candidate");
      expect(text).toContain("priority");
    });

    it("mentions no auto-create constraint", async () => {
      const res = await app.request("/agent-guide/demand");
      const text = await res.text();
      expect(text).toContain("does NOT auto-create");
    });
  });

  describe("GET /agent-guide/demand/schema.json", () => {
    it("returns JSON schema", async () => {
      const res = await app.request("/agent-guide/demand/schema.json");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.title).toBe("DemandRequest");
      expect(json.type).toBe("object");
    });

    it("schema requires capability_query", async () => {
      const res = await app.request("/agent-guide/demand/schema.json");
      const json = await res.json();
      expect(json.required).toContain("capability_query");
    });

    it("schema defines capability_query with maxLength 200", async () => {
      const res = await app.request("/agent-guide/demand/schema.json");
      const json = await res.json();
      expect(json.properties.capability_query.maxLength).toBe(200);
    });

    it("schema defines optional context with maxLength 1000", async () => {
      const res = await app.request("/agent-guide/demand/schema.json");
      const json = await res.json();
      expect(json.properties.context.maxLength).toBe(1000);
    });

    it("returns application/json content type", async () => {
      const res = await app.request("/agent-guide/demand/schema.json");
      const ct = res.headers.get("Content-Type") || "";
      expect(ct).toContain("application/json");
    });
  });

  describe("Demand does NOT auto-create capabilities", () => {
    it("demand store has no method to create capabilities", () => {
      const store = demandStore as unknown as Record<string, unknown>;
      expect(typeof store.request).toBe("function");
      expect(typeof store.get).toBe("function");
      expect(typeof store.list).toBe("function");
      expect(typeof store.clear).toBe("function");
      expect(store.createCapability).toBeUndefined();
      expect(store.addToRegistry).toBeUndefined();
    });
  });
});
