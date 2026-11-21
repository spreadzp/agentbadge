/**
 * SLICE-234-39: POST /api/indexer/run — gate + no internals leak +
 * honest retryable. Было: unauth 500 со String(err) (RPC URL, request
 * body) и retryable:true на детерминированной pruned-ошибке.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { registerVenueIndexerRoutes } from "../../src/server/routes/venue/venue-api-indexer";
import type { VenueIndexerDeps } from "../../src/server/lib/venue/indexer";

const TOKEN = "test-indexer-token";
const AUTH = { Authorization: `Bearer ${TOKEN}` };

/** getHead бросает первым — имитируем сбой RPC до любых других deps. */
const failingDeps = (msg: string): VenueIndexerDeps => ({
  getHead: () => Promise.reject(new Error(msg)),
});

function makeApp(deps: VenueIndexerDeps) {
  const app = new Hono();
  registerVenueIndexerRoutes(app, { indexer: deps });
  return app;
}

describe("POST /api/indexer/run (SLICE-234-39)", () => {
  const originalToken = process.env.METRICS_BEARER_TOKEN;

  beforeEach(() => {
    process.env.METRICS_BEARER_TOKEN = TOKEN;
  });

  afterEach(() => {
    if (originalToken !== undefined) process.env.METRICS_BEARER_TOKEN = originalToken;
    else delete process.env.METRICS_BEARER_TOKEN;
  });

  it("unauth POST → 401 (не запускает индексер)", async () => {
    const res = await makeApp(failingDeps("boom")).request("/api/indexer/run", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("wrong token → 401", async () => {
    const res = await makeApp(failingDeps("boom")).request("/api/indexer/run", {
      method: "POST",
      headers: { Authorization: "Bearer wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("auth + RPC internals в ошибке → 500 без утечки, retryable:false (pruned — детерминированная)", async () => {
    const internals =
      "RpcRequestError: URL: https://rpc.blockdaemon.mainnet.arc.io — " +
      'request body: {"method":"eth_getLogs"} — pruned history unavailable';
    const res = await makeApp(failingDeps(internals)).request("/api/indexer/run", {
      method: "POST", headers: AUTH,
    });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("blockdaemon");
    expect(text).not.toContain("eth_getLogs");
    expect(text).not.toContain("RpcRequestError");
    const body = JSON.parse(text);
    expect(body.retryable).toBe(false);
  });

  it("auth + transient-ошибка → retryable:true", async () => {
    const res = await makeApp(failingDeps("request timeout ETIMEDOUT")).request("/api/indexer/run", {
      method: "POST", headers: AUTH,
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.retryable).toBe(true);
  });
});
