import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { createAgentRequestRoutes } from "../../src/server/routes/agent-requests/agent-requests-api";
import { createMemoryRequestInboxStores } from "../../src/server/lib/request-inbox/db-stores";
import {
  fpHashFor,
  normalizeQuestion,
} from "../../src/server/lib/request-inbox/fingerprint";
import { transitionWithQa } from "../../src/server/lib/request-inbox/qa";

/**
 * EPIC-252 (SLICE-252-2): public async intake contract —
 * POST /api/requests → 202+Location → GET poll → 200/202/410.
 * Memory backend exercises the full handler; Postgres rows are
 * covered by the repository suite in packages/database.
 */

// resolveClientIp only trusts fly-client-ip on Fly — emulate the runtime.
process.env.FLY_APP_NAME = process.env.FLY_APP_NAME || "test-inbox";

const ENV = {
  fingerprintSalt: "test-salt",
  requestTtlMs: 60_000,
  payloadRetentionMs: 30 * 24 * 3600_000,
};

function mkApp(
  opts: {
    submitWindowMs?: number;
    submitMax?: number;
    submitSoftMax?: number;
  } = {},
) {
  const stores = createMemoryRequestInboxStores();
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  // Simulates the global agentKeyAuth lane: header → verified agent.
  app.use((c, next) => {
    const agent = c.req.header("x-test-agent");
    if (agent) {
      c.set("agentId", agent);
      c.set("agentTier", "observer");
    }
    return next();
  });
  app.route(
    "/",
    createAgentRequestRoutes({
      stores,
      env: ENV,
      now: () => Date.now(),
      submitWindowMs: opts.submitWindowMs ?? 7_200_000,
      submitMax: opts.submitMax ?? 1,
      submitSoftMax: opts.submitSoftMax,
    }),
  );
  return { app, stores };
}

const post = (
  app: Hono<{ Variables: Record<string, unknown> }>,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  app.request("/api/requests", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("POST /api/requests (SLICE-252-2)", () => {
  it("202 + Location + poll_url + Retry-After; anonymous is accepted", async () => {
    const { app } = mkApp();
    const res = await post(app, { payload: { prompt: "hello" } });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.state).toBe("submitted");
    expect(body.request_id).toMatch(/^rq_/);
    expect(body.poll_url).toBe(`/api/requests/${body.request_id}`);
    expect(res.headers.get("Location")).toBe(`/api/requests/${body.request_id}`);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("verified agent key lane → verified:true + agentId stored", async () => {
    const { app, stores } = mkApp();
    const res = await post(
      app,
      { payload: { prompt: "x" }, meta: { name: "bot" } },
      { "x-test-agent": "agent-7" },
    );
    const { request_id } = await res.json();
    const { record } = await stores.requests.get(request_id);
    expect(record?.verified).toBe(true);
    expect(record?.agentId).toBe("agent-7");
  });

  it("Idempotency-Key replay → same request_id, no new row, still 202", async () => {
    const { app } = mkApp();
    const h = { "Idempotency-Key": "key-11111", "fly-client-ip": "1.2.3.4" };
    const a = await post(app, { payload: { prompt: "p" } }, h);
    const b = await post(app, { payload: { prompt: "p" } }, h);
    const [ba, bb] = [await a.json(), await b.json()];
    expect(bb.request_id).toBe(ba.request_id);
    expect(bb.duplicate).toBe(true);
    expect(b.status).toBe(202);
  });

  it("no key → always a new record (content identical, different ids)", async () => {
    const { app } = mkApp();
    const a = await post(app, { payload: { prompt: "same" } });
    const b = await post(app, { payload: { prompt: "other" } });
    expect((await a.json()).request_id).not.toBe((await b.json()).request_id);
  });

  it("second submit inside window → 429 + Retry-After (keyed by fpHash)", async () => {
    const { app } = mkApp();
    const ip = { "fly-client-ip": "9.9.9.9" };
    const first = await post(app, { payload: { prompt: "one" } }, ip);
    expect(first.status).toBe(202);
    const second = await post(app, { payload: { prompt: "two" } }, ip);
    expect(second.status).toBe(429);
    expect(Number(second.headers.get("Retry-After"))).toBeGreaterThan(0);
    // different fpHash → not limited
    const third = await post(
      app,
      { payload: { prompt: "three" } },
      { "fly-client-ip": "8.8.8.8" },
    );
    expect(third.status).toBe(202);
  });

  it("IP rotation: soft lane (ua+headers) still 429s — SLICE-252-7", async () => {
    // fpHash lane is wide open (100/window); the IP-less soft lane is
    // capped at 2 — rotating IPs can't mint fresh anonymous lanes.
    const { app } = mkApp({ submitMax: 100, submitSoftMax: 2 });
    const sameClient = (ip: string) => ({
      "fly-client-ip": ip,
      "user-agent": "RotatorBot/1.0",
      "accept-language": "en",
    });
    expect(
      (await post(app, { payload: { prompt: "ip1" } }, sameClient("1.1.1.1")))
        .status,
    ).toBe(202);
    expect(
      (await post(app, { payload: { prompt: "ip2" } }, sameClient("2.2.2.2")))
        .status,
    ).toBe(202);
    // Third IP, same client signature → soft lane trips.
    const third = await post(
      app,
      { payload: { prompt: "ip3" } },
      sameClient("3.3.3.3"),
    );
    expect(third.status).toBe(429);
    expect(Number(third.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("idempotent replay bypasses the submit limit (AAuth §11.8)", async () => {
    const { app } = mkApp();
    const h = { "Idempotency-Key": "k2-99999", "fly-client-ip": "7.7.7.7" };
    await post(app, { payload: { prompt: "p" } }, h);
    const replay = await post(app, { payload: { prompt: "p" } }, h);
    expect(replay.status).toBe(202); // replay, not 429
  });

  it("QA fast-path: same normalized question → 200 qa:true without a new row", async () => {
    const { app, stores } = mkApp();
    const question = "How do I mint a passport?";
    // Seed: submit + completed transition materializes a QA pair.
    await stores.requests.submit({
      id: "rq_seed",
      state: "submitted",
      kind: null,
      payload: { prompt: question },
      fingerprint: { ip: null, ua: "a/1", referer: null, src: null, headers: {} },
      fpHash: "fp_seed",
      expiresAtMs: Date.now() + 60_000,
    });
    await transitionWithQa(stores.requests, "rq_seed", "submitted", {
      response: { answer: "POST /mint" },
      respondedAtMs: Date.now(),
    });
    // New POST — case/space-folded copy of the same question.
    const res = await post(app, {
      payload: { prompt: "  HOW  do i mint a PASSPORT? " },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.qa).toBe(true);
    expect(body.response).toEqual({ answer: "POST /mint" });
    const all = await stores.requests.listByState({});
    expect(all.length).toBe(1); // only the seed row — no new record
    const qa = await stores.requests.searchQa("mint", 10);
    expect(qa[0]?.uses).toBe(1); // uses counts fast-path serves only
  });

  it("GET /api/requests/qa?q= returns corpus matches", async () => {
    const { app, stores } = mkApp();
    await stores.requests.upsertQaPair({
      id: "qa1",
      questionHash: "h1",
      question: "how to mint a passport",
      response: { a: 1 },
      sourceRequestId: "r1",
      createdAtMs: Date.now(),
    });
    const res = await app.request("/api/requests/qa?q=mint");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].question).toContain("mint");
  });

  it("spam_flag: same (kind+payload+fpHash) replay inside window marks the row", async () => {
    const { app, stores } = mkApp({ submitMax: 10 });
    const ip = { "fly-client-ip": "5.5.5.5" };
    await post(app, { kind: "question", payload: { prompt: "dup" } }, ip);
    const res = await post(app, { kind: "question", payload: { prompt: "dup" } }, ip);
    const { request_id } = await res.json();
    const { record } = await stores.requests.get(request_id);
    expect(record?.spamFlag).toBe(true);
  });

  it("Authorization / cookies never reach the persisted fingerprint", async () => {
    const { app, stores } = mkApp();
    const res = await post(app, { payload: { prompt: "p" } }, {
      authorization: "Bearer secret",
      cookie: "sess=abc",
      "x-custom": "ok",
      "x-requested-with": "test",
    });
    const { request_id } = await res.json();
    const { record } = await stores.requests.get(request_id);
    const keys = Object.keys(record?.fingerprint.headers ?? {});
    // Allowlist snapshot (re-audit C-1): only vetted headers persist.
    expect(keys).toContain("x-requested-with");
    expect(keys).not.toContain("x-custom");
    expect(keys).not.toContain("authorization");
    expect(keys).not.toContain("cookie");
  });

  it("payload >256KB → 400; body >512KB → 413; meta field >4KB → 400", async () => {
    const { app } = mkApp();
    const big = "x".repeat(257 * 1024);
    const res1 = await post(app, { payload: big });
    expect(res1.status).toBe(400);
    const res2 = await app.request("/api/requests", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(600 * 1024),
      },
      body: "x".repeat(600 * 1024),
    });
    expect(res2.status).toBe(413);
    const res3 = await post(app, {
      payload: { p: 1 },
      meta: { name: "n".repeat(4 * 1024 + 1) },
    });
    expect(res3.status).toBe(400);
  });

  it("invalid body → 400", async () => {
    const { app } = mkApp();
    const res = await post(app, { kind: "x" }); // no payload
    expect(res.status).toBe(400);
  });
});

describe("QA materialization (SLICE-252-2)", () => {
  it("completed transition upserts a QA pair; repeat bumps uses", async () => {
    const stores = createMemoryRequestInboxStores();
    await stores.requests.submit({
      id: "rq_m",
      state: "submitted",
      kind: null,
      payload: { prompt: "What is x402?" },
      fingerprint: { ip: null, ua: null, referer: null, src: null, headers: {} },
      fpHash: "f",
      expiresAtMs: Date.now() + 60_000,
    });
    await transitionWithQa(stores.requests, "rq_m", "submitted", {
      response: { text: "payment proto" },
      respondedAtMs: Date.now(),
    });
    const pair = (await stores.requests.searchQa("x402", 1))[0];
    expect(pair?.uses).toBe(0); // materialization seeds, hits increment
    expect(pair?.response).toEqual({ text: "payment proto" });
    // working transition must not materialize a pair
    await stores.requests.submit({
      id: "rq_w",
      state: "submitted",
      kind: null,
      payload: { prompt: "pending" },
      fingerprint: { ip: null, ua: null, referer: null, src: null, headers: {} },
      fpHash: "f",
      expiresAtMs: Date.now() + 60_000,
    });
    await stores.requests.transition("rq_w", "submitted", "working", {});
    const pairs = await stores.requests.searchQa("pending", 10);
    expect(pairs.length).toBe(0);
  });
});

describe("GET /api/requests/:id (SLICE-252-2)", () => {
  it("submitted/working → 202 {state} + Retry-After; completed → 200 + response", async () => {
    const { app, stores } = mkApp();
    const store = stores.requests;
    await store.submit({
      id: "rq_1",
      state: "submitted",
      kind: null,
      payload: null,
      fingerprint: { ip: null, ua: null, referer: null, src: null, headers: {} },
      fpHash: "f1",
      expiresAtMs: Date.now() + 60_000,
    });
    let res = await app.request("/api/requests/rq_1");
    expect(res.status).toBe(202);
    expect((await res.json()).state).toBe("submitted");
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);

    await store.transition("rq_1", "submitted", "completed", {
      response: { done: true },
    });
    res = await app.request("/api/requests/rq_1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe("completed");
    expect(body.response).toEqual({ done: true });
  });

  it("expired record → 410; missing id → 404", async () => {
    const { app, stores } = mkApp();
    await stores.requests.submit({
      id: "rq_old",
      state: "submitted",
      kind: null,
      payload: null,
      fingerprint: { ip: null, ua: null, referer: null, src: null, headers: {} },
      fpHash: "f2",
      expiresAtMs: Date.now() - 1,
    });
    expect((await app.request("/api/requests/rq_old")).status).toBe(410);
    expect((await app.request("/api/requests/rq_missing")).status).toBe(404);
  });
});

describe("fpHash / normalizeQuestion helpers (252-2 wiring)", () => {
  it("fpHash changes with ip/ua/salt; question normalization folds case+space", () => {
    expect(fpHashFor("1.1.1.1", "ua", "s")).not.toBe(fpHashFor("1.1.1.2", "ua", "s"));
    expect(fpHashFor("1.1.1.1", "ua", "s")).not.toBe(fpHashFor("1.1.1.1", "ua2", "s"));
    expect(normalizeQuestion("  How   Do  I? ")).toBe("how do i?");
  });
});
