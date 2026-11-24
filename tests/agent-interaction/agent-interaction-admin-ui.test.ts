import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { createAgentInteractionRoutes } from "../../src/server/routes/agent-interaction/agent-interaction-api";
import { createAgentInteractionAdminUi } from "../../src/server/routes/agent-interaction/agent-interaction-admin-ui";
import { createMemoryRequestInboxStores } from "../../src/server/lib/request-inbox";
import {
  createMemoryOperatorStore,
  seedOperator,
} from "../helpers/operators";

/**
 * SLICE-228-5 DoD — SSR console smoke + XSS regression over the
 * memory backend. Auth = HTTP Basic (O-228-3, 264-8): password is an
 * opk_ operator credential, any username. The actor is the credential
 * principal — no operator form field.
 */

process.env.FLY_APP_NAME = process.env.FLY_APP_NAME || "test-inbox";
process.env.ADMIN_API_KEY = "test-admin-key";

const ENV = {
  fingerprintSalt: "test-salt",
  requestTtlMs: 3_600_000,
  payloadRetentionMs: 30 * 24 * 3600_000,
};

async function mkApp() {
  const stores = createMemoryRequestInboxStores();
  const opStore = createMemoryOperatorStore();
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.route("/", createAgentInteractionRoutes({ stores, env: ENV }));
  app.route(
    "/",
    createAgentInteractionAdminUi({ stores, operatorStore: opStore }),
  );
  const { key, operatorId } = await seedOperator(opStore, "UI Ops");
  const basic = `Basic ${Buffer.from(`ops:${key}`).toString("base64")}`;
  return { app, stores, basic, key, operatorId };
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
      "idempotency-key": `ui-${Date.now()}-${n}`,
      "fly-client-ip": `10.8.${n}.1`,
    },
    body: JSON.stringify({ type: "question", text }),
  });
  return (await r.json()).requestId as string;
};

const form = () => `application/x-www-form-urlencoded`;

describe("admin UI auth", () => {
  it("no credentials → 401 + WWW-Authenticate (browser prompt)", async () => {
    const { app } = await mkApp();
    const r = await app.request("/admin/interactions");
    expect(r.status).toBe(401);
    expect(r.headers.get("WWW-Authenticate")).toMatch(/Basic/);
  });
  it("Basic password = opk_ cred → page renders; wrong → 401", async () => {
    const { app, basic, key } = await mkApp();
    const ok = await app.request("/admin/interactions", {
      headers: { authorization: basic },
    });
    expect(ok.status).toBe(200);
    const bad = await app.request("/admin/interactions", {
      headers: {
        authorization: `Basic ${Buffer.from("ops:wrong").toString("base64")}`,
      },
    });
    expect(bad.status).toBe(401);
    // X-Admin-Key transport still works on the same surface
    const keyAuth = await app.request("/admin/interactions", {
      headers: { "x-admin-key": key },
    });
    expect(keyAuth.status).toBe(200);
  });
});

describe("inbox + detail flow (e2e smoke)", () => {
  it("submit → inbox row → detail → classify → respond (PRG)", async () => {
    const { app, basic, operatorId } = await mkApp();
    const id = await submit(app, "integration help please");

    const inbox = await app.request("/admin/interactions", {
      headers: { authorization: basic },
    });
    expect(inbox.status).toBe(200);
    const inboxHtml = await inbox.text();
    expect(inboxHtml).toContain(id);
    expect(inboxHtml).toContain("PENDING_REVIEW");
    expect(inboxHtml).toContain("untrusted");

    const detail = await app.request(`/admin/interactions/${id}`, {
      headers: { authorization: basic },
    });
    const dh = await detail.text();
    expect(dh).toContain("integration help please");
    expect(dh).toContain("Event log");

    const cls = await app.request(`/admin/interactions/${id}/classify`, {
      method: "POST",
      headers: { authorization: basic, "content-type": form() },
      body: "intent=BUG_REPORT&topics=x402&knowledgeGap=1",
    });
    expect(cls.status).toBe(303);
    expect(cls.headers.get("location")).toContain(`/admin/interactions/${id}`);

    const rsp = await app.request(`/admin/interactions/${id}/respond`, {
      method: "POST",
      headers: { authorization: basic, "content-type": form() },
      body: "body=use+x402+settle",
    });
    expect(rsp.status).toBe(303);

    const after = await app.request(`/admin/interactions/${id}`, {
      headers: { authorization: basic },
    });
    const ah = await after.text();
    expect(ah).toContain("ANSWERED");
    expect(ah).toContain("use x402 settle");
    expect(ah).toContain(operatorId);

    // B-3 prod-verify: cross-site form POST (mismatched Origin) → 403,
    // even with valid Basic creds (browsers auto-attach cached Basic).
    const evil = await app.request(`/admin/interactions/${id}/reject`, {
      method: "POST",
      headers: {
        authorization: basic,
        "content-type": form(),
        origin: "https://evil.example",
      },
      body: "reason=csrf",
    });
    expect(evil.status).toBe(403);
    // Same-origin Origin header → allowed (real browser form submit).
    const same = await app.request(`/admin/interactions/${id}/reject`, {
      method: "POST",
      headers: {
        authorization: basic,
        "content-type": form(),
        origin: "http://localhost",
      },
      body: "reason=ok",
    });
    expect(same.status).toBe(303);

    const pub = await app.request(`/api/v1/agent/requests/${id}`);
    expect((await pub.json()).status).toBe("ANSWERED");
  });

  it("empty queue → empty state; unknown id → 404", async () => {
    const { app, basic } = await mkApp();
    const r = await app.request("/admin/interactions", {
      headers: { authorization: basic },
    });
    expect(await r.text()).toContain("Queue is empty");
    expect(
      (
        await app.request("/admin/interactions/nope", {
          headers: { authorization: basic },
        })
      ).status,
    ).toBe(404);
  });

  it("respond attributes the credential principal (no form field)", async () => {
    const { app, stores, basic, operatorId } = await mkApp();
    const id = await submit(app);
    const r = await app.request(`/admin/interactions/${id}/respond`, {
      method: "POST",
      headers: { authorization: basic, "content-type": form() },
      body: "body=hello",
    });
    expect(r.status).toBe(303);
    const [resp] = await stores.interactions.listResponses(id);
    expect(resp.operatorRef).toBe(operatorId);
  });
});

describe("XSS regression (D-228-5)", () => {
  it("payload with <script> renders as escaped text", async () => {
    const { app, basic } = await mkApp();
    const id = await submit(
      app,
      '<script>alert("x")</script><img src=x onerror=alert(1)>',
    );
    const r = await app.request(`/admin/interactions/${id}`, {
      headers: { authorization: basic },
    });
    const html = await r.text();
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain("&lt;script&gt;");
    // No live <img> tag — the payload is inert text.
    expect(html).not.toContain("<img src=x");
  });
});
