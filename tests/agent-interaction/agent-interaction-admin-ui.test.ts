import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { createAgentInteractionRoutes } from "../../src/server/routes/agent-interaction/agent-interaction-api";
import { createAgentInteractionAdminUi } from "../../src/server/routes/agent-interaction/agent-interaction-admin-ui";
import { createMemoryRequestInboxStores } from "../../src/server/lib/request-inbox";

/**
 * SLICE-228-5 DoD — SSR console smoke + XSS regression over the
 * memory backend. Auth = HTTP Basic (O-228-3): password is the
 * ADMIN_API_KEY, any username.
 */

process.env.FLY_APP_NAME = process.env.FLY_APP_NAME || "test-inbox";
process.env.ADMIN_API_KEY = "test-admin-key";

const ENV = {
  fingerprintSalt: "test-salt",
  requestTtlMs: 3_600_000,
  payloadRetentionMs: 30 * 24 * 3600_000,
};

const basic = `Basic ${Buffer.from("ops:test-admin-key").toString("base64")}`;

function mkApp() {
  const stores = createMemoryRequestInboxStores();
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.route("/", createAgentInteractionRoutes({ stores, env: ENV }));
  app.route("/", createAgentInteractionAdminUi({ stores }));
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
    const { app } = mkApp();
    const r = await app.request("/admin/interactions");
    expect(r.status).toBe(401);
    expect(r.headers.get("WWW-Authenticate")).toMatch(/Basic/);
  });
  it("Basic password = admin key → page renders; wrong → 401", async () => {
    const { app } = mkApp();
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
    // X-Admin-Key still works on the same surface
    const keyAuth = await app.request("/admin/interactions", {
      headers: { "x-admin-key": "test-admin-key" },
    });
    expect(keyAuth.status).toBe(200);
  });
});

describe("inbox + detail flow (e2e smoke)", () => {
  it("submit → inbox row → detail → classify → respond (PRG)", async () => {
    const { app } = mkApp();
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
      body: "intent=BUG_REPORT&topics=x402&operator=ops_e2e&knowledgeGap=1",
    });
    expect(cls.status).toBe(303);
    expect(cls.headers.get("location")).toContain(`/admin/interactions/${id}`);

    const rsp = await app.request(`/admin/interactions/${id}/respond`, {
      method: "POST",
      headers: { authorization: basic, "content-type": form() },
      body: "body=use+x402+settle&operator=ops_e2e",
    });
    expect(rsp.status).toBe(303);

    const after = await app.request(`/admin/interactions/${id}`, {
      headers: { authorization: basic },
    });
    const ah = await after.text();
    expect(ah).toContain("ANSWERED");
    expect(ah).toContain("use x402 settle");
    expect(ah).toContain("ops_e2e");

    // B-3 prod-verify: cross-site form POST (mismatched Origin) → 403,
    // even with valid Basic creds (browsers auto-attach cached Basic).
    const evil = await app.request(`/admin/interactions/${id}/reject`, {
      method: "POST",
      headers: {
        authorization: basic,
        "content-type": form(),
        origin: "https://evil.example",
      },
      body: "reason=csrf&operator=ops_e2e",
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
      body: "reason=ok&operator=ops_e2e",
    });
    expect(same.status).toBe(303);

    const pub = await app.request(`/api/v1/agent/requests/${id}`);
    expect((await pub.json()).status).toBe("ANSWERED");
  });

  it("empty queue → empty state; unknown id → 404", async () => {
    const { app } = mkApp();
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

  it("respond without operator → PRG back with error", async () => {
    const { app } = mkApp();
    const id = await submit(app);
    const r = await app.request(`/admin/interactions/${id}/respond`, {
      method: "POST",
      headers: { authorization: basic, "content-type": form() },
      body: "body=hello",
    });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain("err=operator");
  });
});

describe("XSS regression (D-228-5)", () => {
  it("payload with <script> renders as escaped text", async () => {
    const { app } = mkApp();
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
