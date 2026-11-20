import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { createAgentInteractionRoutes } from "../../src/server/routes/agent-interaction/agent-interaction-api";
import { createAgentInteractionAdminRoutes } from "../../src/server/routes/agent-interaction/agent-interaction-admin-api";
import { createMemoryRequestInboxStores } from "../../src/server/lib/request-inbox";

/**
 * SLICE-228-4 DoD e2e — admin interaction surface over the memory
 * backend. Covers the full arc: public submit → queue → classify →
 * respond → public projection (classification stays private), plus
 * operatorRef attribution (header, never body), terminal replay →
 * honest 409 and the internal event log.
 */

process.env.FLY_APP_NAME = process.env.FLY_APP_NAME || "test-inbox";
process.env.ADMIN_API_KEY = "test-admin-key";

const ENV = {
  fingerprintSalt: "test-salt",
  requestTtlMs: 3_600_000,
  payloadRetentionMs: 30 * 24 * 3600_000,
};

const ADMIN = { "x-admin-key": "test-admin-key" };
const OP = (id: string) => ({ ...ADMIN, "x-operator-id": id });

function mkApp() {
  const stores = createMemoryRequestInboxStores();
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use((c, next) => {
    const agent = c.req.header("x-test-agent");
    if (agent) {
      c.set("agentId", agent);
      c.set("agentTier", "observer");
    }
    return next();
  });
  app.route("/", createAgentInteractionRoutes({ stores, env: ENV }));
  app.route("/", createAgentInteractionAdminRoutes({ stores }));
  return { app, stores };
}

let n = 0;
const submit = async (
  app: Hono<{ Variables: Record<string, unknown> }>,
  text = "how do I pay?",
) => {
  n += 1;
  const r = await app.request("/api/v1/agent/interaction", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `adm-${Date.now()}-${n}`,
      "fly-client-ip": `10.9.${n}.1`,
    },
    body: JSON.stringify({ type: "question", text }),
  });
  expect(r.status).toBe(202);
  return (await r.json()).requestId as string;
};

const admin = (
  app: Hono<{ Variables: Record<string, unknown> }>,
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) =>
  app.request(path, {
    method: opts.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(opts.headers ?? ADMIN),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });

describe("queue", () => {
  it("submit → visible in PENDING_REVIEW queue (FIFO, excerpt)", async () => {
    const { app } = mkApp();
    const a = await submit(app, "first question");
    const b = await submit(app, "second question");
    const r = await admin(app, "/api/admin/interactions");
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.items.map((x: { id: string }) => x.id)).toEqual([a, b]);
    expect(j.items[0]).toMatchObject({
      status: "PENDING_REVIEW",
      actorResolution: "ANON",
      intent: null,
    });
    expect(j.items[0].excerpt).toBe("first question");
  });

  it("auth required — no admin key → 401", async () => {
    const { app } = mkApp();
    const r = await app.request("/api/admin/interactions");
    expect(r.status).toBe(401);
  });

  it("status filter + invalid params → 400", async () => {
    const { app } = mkApp();
    await submit(app);
    const all = await admin(app, "/api/admin/interactions?status=all");
    expect((await all.json()).items.length).toBe(1);
    expect(
      (await admin(app, "/api/admin/interactions?status=NOPE")).status,
    ).toBe(400);
    expect(
      (await admin(app, "/api/admin/interactions?actorResolution=NOPE"))
        .status,
    ).toBe(400);
  });
});

describe("classify", () => {
  it("classify → IN_REVIEW + INTERNAL event + classifiedBy=operator", async () => {
    const { app } = mkApp();
    const id = await submit(app);
    const r = await admin(app, `/api/admin/interactions/${id}/classify`, {
      method: "POST",
      headers: OP("op_alice"),
      body: { intent: "BUG_REPORT", topics: ["x402"], knowledgeGap: true },
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.status).toBe("IN_REVIEW");
    expect(j.transitioned).toBe(true);
    const { record } = await mkApp().stores.requests.get(id);
    void record;
    // attribution + event land in the audit log
    const ev = await admin(app, `/api/admin/interactions/${id}/events`);
    const ej = await ev.json();
    const classified = ej.events.find(
      (e: { kind: string }) => e.kind === "interaction.request.classified",
    );
    expect(classified.visibility).toBe("INTERNAL");
    expect(classified.payload.operatorRef).toBe("op_alice");
  });

  it("re-classify allowed — transitioned:false, last write wins", async () => {
    const { app } = mkApp();
    const id = await submit(app);
    await admin(app, `/api/admin/interactions/${id}/classify`, {
      method: "POST",
      headers: OP("op_a"),
      body: { intent: "BUG_REPORT" },
    });
    const r2 = await admin(app, `/api/admin/interactions/${id}/classify`, {
      method: "POST",
      headers: OP("op_b"),
      body: { intent: "FEATURE_REQUEST", outcome: "triaged" },
    });
    const j2 = await r2.json();
    expect(j2.transitioned).toBe(false);
    const detail = await admin(app, `/api/admin/interactions/${id}`);
    const dj = await detail.json();
    expect(dj.classification.intent).toBe("FEATURE_REQUEST");
    expect(dj.classification.classifiedBy).toBe("op_b");
  });

  it("vocabulary violation → 400; unknown id → 404", async () => {
    const { app } = mkApp();
    const id = await submit(app);
    expect(
      (
        await admin(app, `/api/admin/interactions/${id}/classify`, {
          method: "POST",
          body: { intent: "NOT_A_VOCAB" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin(app, "/api/admin/interactions/nope/classify", {
          method: "POST",
          body: { intent: "BUG_REPORT" },
        })
      ).status,
    ).toBe(404);
  });
});

describe("respond / reject — lifecycle + replay", () => {
  it("respond → ANSWERED; public GET shows response, NOT classification", async () => {
    const { app } = mkApp();
    const id = await submit(app);
    await admin(app, `/api/admin/interactions/${id}/classify`, {
      method: "POST",
      headers: OP("op_alice"),
      body: { intent: "BUG_REPORT", knowledgeGap: true },
    });
    const r = await admin(app, `/api/admin/interactions/${id}/respond`, {
      method: "POST",
      headers: OP("op_alice"),
      body: { body: "the answer is 42" },
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.status).toBe("ANSWERED");
    expect(j.responseId).toMatch(/^irsp_/);

    const pub = await app.request(`/api/v1/agent/requests/${id}`);
    const pj = await pub.json();
    expect(pj.status).toBe("ANSWERED");
    expect(pj.response).toBe("the answer is 42");
    const raw = JSON.stringify(pj);
    for (const forbidden of [
      "intent",
      "knowledgeGap",
      "classifiedBy",
      "op_alice",
      "fingerprint",
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("second respond → 409 INTERACTION_TERMINAL, no extra writes", async () => {
    const { app, stores } = mkApp();
    const id = await submit(app);
    await admin(app, `/api/admin/interactions/${id}/respond`, {
      method: "POST",
      body: { body: "first" },
    });
    const dup = await admin(app, `/api/admin/interactions/${id}/respond`, {
      method: "POST",
      headers: OP("op_other"),
      body: { body: "second" },
    });
    expect(dup.status).toBe(409);
    const j = await dup.json();
    expect(j.code).toBe("interaction_terminal");
    expect(await stores.interactions.listResponses(id)).toHaveLength(1);
    const events = await stores.interactions.listEvents(id, {
      visibility: "PUBLIC",
    });
    expect(
      events.filter((e) => e.kind === "interaction.response.sent"),
    ).toHaveLength(1);
  });

  it("operator attribution comes from X-Operator-Id, not body", async () => {
    const { app, stores } = mkApp();
    const id1 = await submit(app);
    const id2 = await submit(app);
    // A forged "operator" field in the body is ignored outright.
    await admin(app, `/api/admin/interactions/${id1}/respond`, {
      method: "POST",
      headers: OP("op_real_a"),
      body: { body: "a", operator: "forged" },
    });
    await admin(app, `/api/admin/interactions/${id2}/respond`, {
      method: "POST",
      headers: OP("op_real_b"),
      body: { body: "b" },
    });
    const [r1] = await stores.interactions.listResponses(id1);
    const [r2] = await stores.interactions.listResponses(id2);
    expect(r1.operatorRef).toBe("op_real_a");
    expect(r2.operatorRef).toBe("op_real_b");
    // No operator header → shared-key default label.
    const id3 = await submit(app);
    await admin(app, `/api/admin/interactions/${id3}/respond`, {
      method: "POST",
      body: { body: "c" },
    });
    const [r3] = await stores.interactions.listResponses(id3);
    expect(r3.operatorRef).toBe("admin");
  });

  it("reject → REJECTED + INTERNAL event; respond after reject → 409", async () => {
    const { app } = mkApp();
    const id = await submit(app);
    const r = await admin(app, `/api/admin/interactions/${id}/reject`, {
      method: "POST",
      headers: OP("op_alice"),
      body: { reason: "spam" },
    });
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe("REJECTED");
    const pub = await app.request(`/api/v1/agent/requests/${id}`);
    expect((await pub.json()).status).toBe("REJECTED");
    const late = await admin(app, `/api/admin/interactions/${id}/respond`, {
      method: "POST",
      body: { body: "late" },
    });
    expect(late.status).toBe(409);
  });

  it("respond on unknown id → 404", async () => {
    const { app } = mkApp();
    expect(
      (
        await admin(app, "/api/admin/interactions/nope/respond", {
          method: "POST",
          body: { body: "x" },
        })
      ).status,
    ).toBe(404);
  });
});

describe("detail + events", () => {
  it("detail returns payload, session thread, internal events", async () => {
    const { app } = mkApp();
    const id = await submit(app, "session question");
    const detail = await admin(app, `/api/admin/interactions/${id}`);
    const j = await detail.json();
    expect(j.request.payload.text).toBe("session question");
    expect(j.request.sessionId).toMatch(/^isess_/);
    expect(j.thread.map((t: { id: string }) => t.id)).toEqual([id]);
    expect(j.events.length).toBeGreaterThanOrEqual(2); // received ×2 vis
    expect(j.request.fingerprint).toBeDefined(); // admin sees fingerprint
  });

  it("events endpoint exposes INTERNAL entries to admin", async () => {
    const { app } = mkApp();
    const id = await submit(app);
    const r = await admin(app, `/api/admin/interactions/${id}/events`);
    const j = await r.json();
    expect(j.events.map((e: { visibility: string }) => e.visibility)).toContain(
      "INTERNAL",
    );
    expect(
      (await app.request(`/api/admin/interactions/nope/events`, {
        headers: ADMIN,
      })).status,
    ).toBe(404);
  });
});
