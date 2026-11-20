import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { createAgentInteractionRoutes } from "../../src/server/routes/agent-interaction/agent-interaction-api";
import { createMemoryRequestInboxStores } from "../../src/server/lib/request-inbox";

/**
 * SLICE-228-3 DoD e2e — public interaction routes over the memory
 * backend: anon/key submits, idempotent replay, caps, tiered
 * rate-limit, tenant isolation and the cheap /status poll.
 * DID-verification itself is covered by did-auth's own suite; here
 * the shim pre-sets verifiedDid like an upstream verifier would.
 */

process.env.FLY_APP_NAME = process.env.FLY_APP_NAME || "test-inbox";

const ENV = {
  fingerprintSalt: "test-salt",
  requestTtlMs: 60_000,
  payloadRetentionMs: 30 * 24 * 3600_000,
};

function mkApp(env = ENV) {
  const stores = createMemoryRequestInboxStores();
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  // Simulates global agentKeyAuth + an upstream DID verifier.
  app.use((c, next) => {
    const agent = c.req.header("x-test-agent");
    if (agent) {
      c.set("agentId", agent);
      c.set("agentTier", "observer");
    }
    const did = c.req.header("x-test-verified-did");
    if (did) c.set("verifiedDid", did);
    return next();
  });
  app.route(
    "/",
    createAgentInteractionRoutes({ stores, env, now: () => Date.now() }),
  );
  return { app, stores };
}

const post = (
  app: Hono<{ Variables: Record<string, unknown> }>,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  app.request("/api/v1/agent/interaction", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const BODY = { type: "question", text: "how do payments settle?" };
const KEY = { "idempotency-key": "it-key-00000001" };
const IP = (ip: string) => ({ "fly-client-ip": ip });

describe("POST /api/v1/agent/interaction", () => {
  it("anon submit → 202 → poll → PENDING_REVIEW", async () => {
    const { app } = mkApp();
    const r = await post(app, BODY, { ...KEY, ...IP("10.1.1.1") });
    expect(r.status).toBe(202);
    const j = await r.json();
    expect(j.status).toBe("PENDING_REVIEW");
    expect(j.requestId).toMatch(/^ireq_/);
    expect(j.sessionId).toMatch(/^isess_/);
    expect(r.headers.get("location")).toBe(j.statusUrl);

    const poll = await app.request(j.statusUrl);
    expect(poll.status).toBe(200);
    const pj = await poll.json();
    expect(pj.status).toBe("PENDING_REVIEW");
    expect(pj.id).toBe(j.requestId);
    expect(pj.response).toBeUndefined();
  });

  it("api-key submit → actorResolution=API_KEY + actorRef=agentId", async () => {
    const { app, stores } = mkApp();
    const r = await post(app, BODY, {
      ...KEY,
      "x-test-agent": "agent_99",
    });
    expect(r.status).toBe(202);
    const { requestId } = await r.json();
    const { record } = await stores.requests.get(requestId);
    expect(record!.actorResolution).toBe("API_KEY");
    expect(record!.actorRef).toBe("agent_99");
    expect(record!.agentId).toBe("agent_99");
    expect(record!.channel).toBe("rest");
  });

  it("verified DID → actorResolution=DID (outranks agent key)", async () => {
    const { app, stores } = mkApp();
    const r = await post(app, BODY, {
      ...KEY,
      "x-test-agent": "agent_99",
      "x-test-verified-did": "did:hcs:0.0.1:7",
    });
    const { requestId } = await r.json();
    const { record } = await stores.requests.get(requestId);
    expect(record!.actorResolution).toBe("DID");
    expect(record!.actorRef).toBe("did:hcs:0.0.1:7");
  });

  it("dup idempotency-key → 200 {duplicate:true} same requestId", async () => {
    const { app } = mkApp();
    const a = await post(app, BODY, { ...KEY, ...IP("10.1.1.2") });
    const b = await post(app, BODY, { ...KEY, ...IP("10.1.1.2") });
    const aj = await a.json();
    const bj = await b.json();
    expect(a.status).toBe(202);
    expect(b.status).toBe(200);
    expect(bj.duplicate).toBe(true);
    expect(bj.requestId).toBe(aj.requestId);
  });

  it("missing/short idempotency-key → 400", async () => {
    const { app } = mkApp();
    expect((await post(app, BODY, IP("10.1.1.3"))).status).toBe(400);
    expect(
      (await post(app, BODY, { "idempotency-key": "short" })).status,
    ).toBe(400);
  });

  it("oversized text → 400; bad JSON → 400; no text → 400", async () => {
    const { app } = mkApp();
    const big = await post(
      app,
      { text: "x".repeat(17 * 1024) },
      { ...KEY, ...IP("10.1.1.4") },
    );
    expect(big.status).toBe(400);
    const badJson = await app.request("/api/v1/agent/interaction", {
      method: "POST",
      headers: { "content-type": "application/json", ...KEY, ...IP("10.1.1.5") },
      body: "{nope",
    });
    expect(badJson.status).toBe(400);
    expect(
      (await post(app, { type: "question" }, { ...KEY, ...IP("10.1.1.6") }))
        .status,
    ).toBe(400);
  });

  it("rate limit: ANON 3rpm per ip+route → 4th submit 429", async () => {
    const { app } = mkApp();
    const ip = IP("10.2.0.1");
    for (let i = 0; i < 3; i++) {
      const r = await post(app, BODY, {
        "idempotency-key": `rl-${i}-aaaaaa`,
        ...ip,
      });
      expect(r.status).toBe(202);
    }
    const over = await post(app, BODY, {
      "idempotency-key": "rl-3-aaaaaa",
      ...ip,
    });
    expect(over.status).toBe(429);
    const j = await over.json();
    expect(j.code).toBe("RATE_LIMITED");
  });

  it("API_KEY tier gets the higher 30rpm budget", async () => {
    const { app } = mkApp();
    // 3 anon submits from the same ip saturate ANON but the keyed
    // lane is independent — a keyed caller is never ANON-bucketed.
    for (let i = 0; i < 4; i++) {
      const r = await post(app, BODY, {
        "idempotency-key": `kt-${i}-aaaa`,
        "x-test-agent": "agent_key",
      });
      expect(r.status).toBe(202);
    }
  });

  it("incomplete DID headers → 401 (never silent anon)", async () => {
    const { app } = mkApp();
    const r = await post(app, BODY, {
      ...KEY,
      "X-AgentBadge-Did": "did:hcs:0.0.1:7",
    });
    expect(r.status).toBe(401);
  });

  it("client sessionId is honored; malformed → minted isess_*", async () => {
    const { app } = mkApp();
    const ok = await post(
      app,
      { ...BODY, context: { sessionId: "my-session.01" } },
      { "idempotency-key": "sess-1-aaaaaa", ...IP("10.3.0.1") },
    );
    expect((await ok.json()).sessionId).toBe("my-session.01");
    const bad = await post(
      app,
      { ...BODY, context: { sessionId: "bad id!!" } },
      { "idempotency-key": "sess-2-aaaaaa", ...IP("10.3.0.2") },
    );
    expect((await bad.json()).sessionId).toMatch(/^isess_/);
  });
});

describe("GET polls", () => {
  const seed = async (
    app: Hono<{ Variables: Record<string, unknown> }>,
    agent?: string,
  ) => {
    const r = await post(app, BODY, {
      "idempotency-key": `poll-${Math.random()}`,
      ...(agent ? { "x-test-agent": agent } : {}),
    });
    return (await r.json()).requestId as string;
  };

  it("/status returns only {status}", async () => {
    const { app } = mkApp();
    const id = await seed(app);
    const r = await app.request(`/api/v1/agent/requests/${id}/status`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "PENDING_REVIEW" });
  });

  it("other-tenant identified actor → 404; anon capability → 200", async () => {
    const { app } = mkApp();
    const id = await seed(app, "agent_owner");
    const denied = await app.request(`/api/v1/agent/requests/${id}`, {
      headers: { "x-test-agent": "agent_other" },
    });
    expect(denied.status).toBe(404);
    const anon = await app.request(`/api/v1/agent/requests/${id}`);
    expect(anon.status).toBe(200);
    const owner = await app.request(`/api/v1/agent/requests/${id}`, {
      headers: { "x-test-agent": "agent_owner" },
    });
    expect(owner.status).toBe(200);
  });

  it("unknown id → 404; expired → 410", async () => {
    const { app } = mkApp();
    expect(
      (await app.request("/api/v1/agent/requests/nope")).status,
    ).toBe(404);
    // Negative TTL → the row expires the instant it is written.
    const dead = mkApp({ ...ENV, requestTtlMs: -1 });
    const id = await seed(dead.app);
    const r = await dead.app.request(`/api/v1/agent/requests/${id}`);
    expect(r.status).toBe(410);
    const s = await dead.app.request(`/api/v1/agent/requests/${id}/status`);
    expect(s.status).toBe(410);
  });
});
