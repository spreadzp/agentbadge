import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, setupMockEnv } from "../e2e/helpers";
import { demandStore } from "../../src/server/services/demand-registry";
import { resetDemandRateLimits } from "../../src/server/routes/api/demand";

setupMockEnv();
const app = makeTestApp();

describe("SLICE-46-14: Integration — Demand Aggregation", () => {
  beforeEach(() => {
    demandStore.clear();
    resetDemandRateLimits();
  });

  it("single request creates backlog priority", async () => {
    const res = await app.request("/api/demand/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability_query: "solidity audit" }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.priority).toBe("backlog");
    expect(body.count).toBe(1);
  });

  it("multiple requests for same query aggregate and increment count", async () => {
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
    const body = await res.json();
    expect(body.count).toBe(5);
    expect(body.priority).toBe("candidate");
  });

  it("priority transitions to priority at 20 requests", async () => {
    for (let i = 0; i < 10; i++) {
      await app.request("/api/demand/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability_query: "rust development" }),
      });
    }
    resetDemandRateLimits();
    for (let i = 0; i < 9; i++) {
      await app.request("/api/demand/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability_query: "rust development" }),
      });
    }
    const res = await app.request("/api/demand/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability_query: "rust development" }),
    });
    const body = await res.json();
    expect(body.count).toBe(20);
    expect(body.priority).toBe("priority");
  });

  it("different queries create separate records", async () => {
    await app.request("/api/demand/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability_query: "solidity audit" }),
    });
    await app.request("/api/demand/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability_query: "react development" }),
    });

    const records = demandStore.list();
    expect(records.length).toBe(2);
  });

  it("normalized queries aggregate regardless of case/whitespace", async () => {
    await app.request("/api/demand/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability_query: "Solidity  Audit" }),
    });
    await app.request("/api/demand/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability_query: "solidity audit" }),
    });
    await app.request("/api/demand/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability_query: "  SOLIDITY   AUDIT  " }),
    });

    const records = demandStore.list();
    expect(records.length).toBe(1);
    expect(records[0].count).toBe(3);
  });

  it("context is accumulated across requests", async () => {
    await app.request("/api/demand/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability_query: "blockchain dev", context: "DeFi project" }),
    });
    await app.request("/api/demand/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability_query: "blockchain dev", context: "NFT platform" }),
    });

    const records = demandStore.list();
    expect(records[0].contexts).toContain("DeFi project");
    expect(records[0].contexts).toContain("NFT platform");
  });

  it("agent guide documentation is accessible", async () => {
    const mdRes = await app.request("/agent-guide/demand");
    expect(mdRes.status).toBe(200);
    const md = await mdRes.text();
    expect(md).toContain("demand");

    const schemaRes = await app.request("/agent-guide/demand/schema.json");
    expect(schemaRes.status).toBe(200);
    const schema = await schemaRes.json();
    expect(schema.type).toBeDefined();
  });
});
