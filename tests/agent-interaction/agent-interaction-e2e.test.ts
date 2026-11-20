import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  createMemoryRequestInboxStores,
  pickRequestInboxStores,
} from "../../src/server/lib/request-inbox";
import { wireAgentInteraction } from "../../src/server/wiring/agent-interaction";

/**
 * SLICE-228-6 DoD — end-to-end through the real wiring: anon agent
 * submit → operator classify/respond → agent poll ANSWERED, session
 * grouping, public-surface visibility and the DATABASE_ENABLED=off
 * (memory fallback) path. TG creds are absent in tests → notify is
 * a silent no-op and nothing fails.
 */

process.env.FLY_APP_NAME = process.env.FLY_APP_NAME || "test-inbox";
process.env.ADMIN_API_KEY = "test-admin-key";
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;

const ENV = {
  fingerprintSalt: "test-salt",
  requestTtlMs: 3_600_000,
  payloadRetentionMs: 30 * 24 * 3600_000,
};

const ADMIN = { "x-admin-key": "test-admin-key" };
const OP = { ...ADMIN, "x-operator-id": "ops_e2e" };

function mkApp(stores = createMemoryRequestInboxStores()) {
  const app = new Hono();
  wireAgentInteraction(app, stores, ENV);
  return { app, stores };
}

const post = (app: Hono, body: unknown, headers: Record<string, string>) =>
  app.request("/api/v1/agent/interaction", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const adminPost = (
  app: Hono,
  path: string,
  body: unknown,
  headers = OP,
) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("e2e: full interaction cycle", () => {
  it("anon submit → queue → classify → respond → agent polls ANSWERED", async () => {
    const { app } = mkApp();
    // 1. agent submits (no creds at all)
    const r = await post(
      app,
      { type: "question", text: "does x402 settle on-chain?" },
      { "idempotency-key": "e2e-cycle-01", "fly-client-ip": "10.7.0.1" },
    );
    expect(r.status).toBe(202);
    const { requestId, sessionId, statusUrl } = await r.json();
    expect(statusUrl).toBe(`/api/v1/agent/requests/${requestId}`);

    // 2. operator sees it in the queue
    const q = await app.request("/api/admin/interactions", {
      headers: ADMIN,
    });
    expect((await q.json()).items[0].id).toBe(requestId);

    // 3. classify → IN_REVIEW
    const cls = await adminPost(
      app,
      `/api/admin/interactions/${requestId}/classify`,
      { intent: "INTEGRATION_HELP", topics: ["x402"] },
    );
    expect(cls.status).toBe(200);
    expect((await cls.json()).status).toBe("IN_REVIEW");
    // agent sees the status change on the cheap poll
    const st = await app.request(`${statusUrl}/status`);
    expect(await st.json()).toEqual({ status: "IN_REVIEW" });

    // 4. respond → ANSWERED
    const rsp = await adminPost(
      app,
      `/api/admin/interactions/${requestId}/respond`,
      { body: "yes — x402 settles on-chain via the gateway" },
    );
    expect((await rsp.json()).status).toBe("ANSWERED");

    // 5. agent polls — gets the answer, nothing internal
    const poll = await app.request(statusUrl);
    const pj = await poll.json();
    expect(pj.status).toBe("ANSWERED");
    expect(pj.response).toBe("yes — x402 settles on-chain via the gateway");
    expect(pj.sessionId).toBe(sessionId);
    const raw = JSON.stringify(pj);
    for (const forbidden of [
      "intent",
      "topics",
      "operatorRef",
      "classifiedBy",
      "fingerprint",
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("two requests under one sessionId → requestCount=2, thread shows both", async () => {
    const { app, stores } = mkApp();
    const ctx = { sessionId: "sess-e2e", channel: "mcp" };
    const a = await post(
      app,
      { type: "question", text: "first", context: ctx },
      { "idempotency-key": "e2e-sess-01", "fly-client-ip": "10.7.1.1" },
    );
    const b = await post(
      app,
      { type: "question", text: "second", context: ctx },
      { "idempotency-key": "e2e-sess-02", "fly-client-ip": "10.7.1.1" },
    );
    const aj = await a.json();
    const bj = await b.json();
    expect(aj.sessionId).toBe("sess-e2e");
    expect(bj.sessionId).toBe("sess-e2e");
    const session = await stores.interactions.getSession("sess-e2e");
    expect(session?.requestCount).toBe(2);
    const detail = await app.request(
      `/api/admin/interactions/${bj.requestId}`,
      { headers: ADMIN },
    );
    const dj = await detail.json();
    expect(dj.thread).toHaveLength(2);
    // channel made it through context.sanitize
    expect(dj.request.channel).toBe("mcp");
  });

  it("DATABASE_ENABLED=off → pickRequestInboxStores(nulls) is memory, flow works", async () => {
    // The wiring-time pick: all repos absent → memory fallback.
    const stores = pickRequestInboxStores({
      agentRequests: null,
      agentSurveys: null,
      agentInteractions: null,
    } as unknown as Parameters<typeof pickRequestInboxStores>[0]);
    const { app } = mkApp(stores);
    const r = await post(
      app,
      { text: "still works without a database" },
      { "idempotency-key": "e2e-mem-01", "fly-client-ip": "10.7.2.1" },
    );
    expect(r.status).toBe(202);
    const { requestId } = await r.json();
    const rsp = await adminPost(
      app,
      `/api/admin/interactions/${requestId}/respond`,
      { body: "memory-mode answer" },
    );
    expect(rsp.status).toBe(200);
    const poll = await app.request(`/api/v1/agent/requests/${requestId}`);
    expect((await poll.json()).response).toBe("memory-mode answer");
  });

  it("TG-off: no TELEGRAM_* env → full flow, zero failures", async () => {
    // Same exercise as the first test but asserting the absence of
    // creds is invisible — the hook no-ops and intake still 202s.
    expect(process.env.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(process.env.TELEGRAM_CHAT_ID).toBeUndefined();
    const { app } = mkApp();
    const r = await post(
      app,
      { text: "notify is fire-and-forget" },
      { "idempotency-key": "e2e-tg-01", "fly-client-ip": "10.7.3.1" },
    );
    expect(r.status).toBe(202);
    const { requestId } = await r.json();
    // Give fire-and-forget hooks a tick — nothing should throw.
    await new Promise((res) => setTimeout(res, 20));
    const poll = await app.request(`/api/v1/agent/requests/${requestId}`);
    expect(poll.status).toBe(200);
  });
});
