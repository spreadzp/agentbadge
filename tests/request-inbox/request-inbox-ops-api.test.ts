import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { createAgentRequestOpsRoutes } from "../../src/server/routes/agent-requests/agent-requests-ops-api";
import { createAgentRequestRoutes } from "../../src/server/routes/agent-requests/agent-requests-api";
import { createMemoryRequestInboxStores } from "../../src/server/lib/request-inbox/db-stores";
import {
  createMemoryOperatorStore,
  seedOperator,
} from "../helpers/operators";
import {
  buildDigestMessage,
  sendInboxDigest,
} from "../../src/server/lib/request-inbox/tg-digest";

/**
 * EPIC-252 (SLICE-252-3): ops-pull channel (D-252-Q3) —
 * GET /api/ops/requests pull → POST respond/state → agent polls public
 * GET. TG digest is one-way batched notify, never a write path.
 */

process.env.FLY_APP_NAME = process.env.FLY_APP_NAME || "test-inbox";
const ADMIN = "test-admin-key";
process.env.ADMIN_API_KEY = ADMIN;

const ENV = {
  fingerprintSalt: "test-salt",
  requestTtlMs: 60_000,
  payloadRetentionMs: 30 * 24 * 3600_000,
};

async function mkApp() {
  const stores = createMemoryRequestInboxStores();
  const opStore = createMemoryOperatorStore();
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.route(
    "/",
    createAgentRequestRoutes({ stores, env: ENV, submitMax: 100 }),
  );
  app.route(
    "/",
    createAgentRequestOpsRoutes({ stores, operatorStore: opStore }),
  );
  // 264-8: ops surface rides a real opk_ credential.
  const { key } = await seedOperator(opStore);
  return { app, stores, opsHeaders: { "X-Admin-Key": key } };
}
const post = (app: Hono<{ Variables: Record<string, unknown> }>, body: unknown) =>
  app.request("/api/requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("ops auth (SLICE-252-3)", () => {
  it("anon and wrong key → 401; agent header doesn't help", async () => {
    const { app } = await mkApp();
    const badHeaders: Record<string, string>[] = [
      {},
      { "X-Admin-Key": "nope" },
      { "x-test-agent": "a1" },
    ];
    for (const headers of badHeaders) {
      const res = await app.request("/api/ops/requests", { headers });
      expect(res.status).toBe(401);
    }
  });
});

describe("GET /api/ops/requests (SLICE-252-3)", () => {
  it("pull: state filter + payload+fingerprint (fpHash, no raw ip)", async () => {
    const { app, opsHeaders } = await mkApp();
    // kind must be a documented REQUEST_KINDS value — bogus kinds 400 at the
    // schema edge (re-audit fix) and never reach the store.
    await post(app, { kind: "question", payload: { prompt: "p1" } });
    const res = await app.request("/api/ops/requests?state=submitted", {
      headers: opsHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    const r = body.items[0];
    expect(r.payload).toEqual({ prompt: "p1" });
    expect(r.fpHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(r)).not.toContain("client-ip");
    expect(JSON.stringify(r.fingerprint)).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    // state filter excludes other states
    const res2 = await app.request("/api/ops/requests?state=completed", {
      headers: opsHeaders,
    });
    expect((await res2.json()).items).toHaveLength(0);
  });

  it("since + limit filters", async () => {
    const { app, opsHeaders } = await mkApp();
    const p1 = await post(app, { payload: "a" });
    const { request_id: id1 } = await p1.json();
    await new Promise((r) => setTimeout(r, 5));
    const cutoff = Date.now();
    await new Promise((r) => setTimeout(r, 5));
    await post(app, { payload: "b" });
    const res = await app.request(
      `/api/ops/requests?since=${cutoff}`,
      { headers: opsHeaders },
    );
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).not.toBe(id1);
    const lim = await app.request("/api/ops/requests?limit=1", {
      headers: opsHeaders,
    });
    expect((await lim.json()).items).toHaveLength(1);
  });
});

describe("POST respond/state + e2e (SLICE-252-3)", () => {
  it("e2e: POST → pull → respond → agent GET → 200 + response", async () => {
    const { app, opsHeaders } = await mkApp();
    const p = await post(app, { payload: { prompt: "deploy howto?" } });
    const { request_id } = await p.json();
    // pull
    const pull = await app.request("/api/ops/requests?state=submitted", {
      headers: opsHeaders,
    });
    expect((await pull.json()).items[0].id).toBe(request_id);
    // respond
    const resp = await app.request(`/api/ops/requests/${request_id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json", ...opsHeaders },
      body: JSON.stringify({ response: { steps: ["a", "b"] } }),
    });
    expect(resp.status).toBe(200);
    // agent polls → completed + response
    const poll = await app.request(`/api/requests/${request_id}`);
    expect(poll.status).toBe(200);
    const body = await poll.json();
    expect(body.state).toBe("completed");
    expect(body.response).toEqual({ steps: ["a", "b"] });
  });

  it("bare-string response → wrapped {answer} (pg/json top-level-string decode guard)", async () => {
    const { app, opsHeaders } = await mkApp();
    const p = await post(app, { payload: { prompt: "q" } });
    const { request_id } = await p.json();
    const resp = await app.request(`/api/ops/requests/${request_id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json", ...opsHeaders },
      body: JSON.stringify({ response: "plain text answer" }),
    });
    expect(resp.status).toBe(200);
    const body = await (
      await app.request(`/api/requests/${request_id}`)
    ).json();
    expect(body.response).toEqual({ answer: "plain text answer" });
  });

  it("respond without mark_completed → working; completed → QA pair materializes", async () => {
    const { app, stores, opsHeaders } = await mkApp();
    // QA materialization requires publish-consent (D-256-Q13).
    const p = await post(app, {
      payload: { prompt: "q-materialize" },
      publish_to_qa: true,
    });
    const { request_id } = await p.json();
    const w = await app.request(`/api/ops/requests/${request_id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json", ...opsHeaders },
      body: JSON.stringify({ response: { draft: true }, mark_completed: false }),
    });
    expect(w.status).toBe(200);
    expect((await w.json()).state).toBe("working");
    // now complete it via respond
    await app.request(`/api/ops/requests/${request_id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json", ...opsHeaders },
      body: JSON.stringify({ response: { final: 1 } }),
    });
    const qa = await stores.requests.searchQa("q-materialize", 1);
    expect(qa[0]?.response).toEqual({ final: 1 });
  });

  it("state transitions: submitted→working, working→failed; terminal → 409", async () => {
    const { app, opsHeaders } = await mkApp();
    const p = await post(app, { payload: "x" });
    const { request_id } = await p.json();
    const state = async (s: string) =>
      app.request(`/api/ops/requests/${request_id}/state`, {
        method: "POST",
        headers: { "content-type": "application/json", ...opsHeaders },
        body: JSON.stringify({ state: s }),
      });
    expect((await state("working")).status).toBe(200);
    expect((await state("failed")).status).toBe(200);
    // failed is terminal — further transitions → 409
    expect((await state("working")).status).toBe(409);
    // invalid target
    const p2 = await post(app, { payload: "y" });
    const { request_id: id2 } = await p2.json();
    const bad = await app.request(`/api/ops/requests/${id2}/state`, {
      method: "POST",
      headers: { "content-type": "application/json", ...opsHeaders },
      body: JSON.stringify({ state: "bogus" }),
    });
    expect(bad.status).toBe(400);
  });

  it("respond on missing id → 404; on completed → 409", async () => {
    const { app, opsHeaders } = await mkApp();
    const miss = await app.request("/api/ops/requests/rq_nope/respond", {
      method: "POST",
      headers: { "content-type": "application/json", ...opsHeaders },
      body: JSON.stringify({ response: {} }),
    });
    expect(miss.status).toBe(404);
    const p = await post(app, { payload: "z" });
    const { request_id } = await p.json();
    await app.request(`/api/ops/requests/${request_id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json", ...opsHeaders },
      body: JSON.stringify({ response: { ok: 1 } }),
    });
    const again = await app.request(`/api/ops/requests/${request_id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json", ...opsHeaders },
      body: JSON.stringify({ response: { ok: 2 } }),
    });
    expect(again.status).toBe(409);
  });
});

describe("TG digest (SLICE-252-3)", () => {
  it("batched message: N new + top-K lines; one send per digest", async () => {
    const stores = createMemoryRequestInboxStores();
    for (const [i, q] of ["how to mint?", "what is x402?", "limits?"].entries()) {
      await stores.requests.submit({
        id: `rq_${i}`,
        state: "submitted",
        kind: null,
        payload: { prompt: q },
        fingerprint: { ip: null, ua: null, referer: null, src: null, headers: {} },
        fpHash: `fp${i}`,
        expiresAtMs: Date.now() + 60_000,
      });
    }
    const sent: string[] = [];
    const out = await sendInboxDigest({
      stores,
      cfg: { token: "t", chatId: "c" },
      topK: 2,
      send: async (text: string) => {
        sent.push(text);
        return 1;
      },
    });
    expect(out.sent).toBe(true);
    expect(out.count).toBe(3);
    expect(sent).toHaveLength(1); // batched — one message
    expect(sent[0]).toContain("3");
    expect(sent[0]).toContain("mint");
    expect(sent[0]).not.toContain("limits?"); // topK=2 cut
  });

  it("no creds → graceful no-op, nothing sent", async () => {
    const stores = createMemoryRequestInboxStores();
    const sent: string[] = [];
    const out = await sendInboxDigest({
      stores,
      cfg: undefined,
      send: async (t: string) => {
        sent.push(t);
        return 1;
      },
    });
    expect(out.sent).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("buildDigestMessage escapes HTML and truncates questions", () => {
    const msg = buildDigestMessage(
      [
        {
          id: "r1",
          kind: "k",
          question: "<b>" + "x".repeat(200),
          verified: true,
        },
      ],
      { total: 1 },
    );
    expect(msg).not.toContain("<b>x");
    expect(msg.length).toBeLessThan(600);
  });
});
