/**
 * SLICE-83-2: Key-endpoint gate middleware tests.
 *
 * Verifies that key-accepting endpoints return 410 Gone by default
 * (ALLOW_KEY_ENDPOINTS not set), and work normally when flag is "true".
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { keyEndpointGate } from "../../src/server/middleware/key-endpoint-gate";

function makeApp(): Hono {
  const app = new Hono();
  app.use("/market/*", keyEndpointGate());
  app.use("/a2a/*", keyEndpointGate());

  // Mock endpoints that would normally accept private keys
  app.post("/market/sign", (c) => c.json({ ok: true }));
  app.post("/market/tasks/signed", (c) => c.json({ ok: true }));
  app.post("/market/tasks/:taskId/claim-with-key", (c) => c.json({ ok: true }));
  app.post("/market/tasks/:taskId/deliver-with-key", (c) => c.json({ ok: true }));
  app.post("/market/tasks/:taskId/complete-with-key", (c) => c.json({ ok: true }));
  app.post("/a2a/send-with-key", (c) => c.json({ ok: true }));

  // Non-key endpoints should NOT be gated
  app.post("/market/tasks", (c) => c.json({ ok: true }));
  app.post("/a2a/send-signed", (c) => c.json({ ok: true }));

  return app;
}

describe("SLICE-83-2: key-endpoint gate middleware", () => {
  const originalEnv = process.env.ALLOW_KEY_ENDPOINTS;

  beforeEach(() => {
    delete process.env.ALLOW_KEY_ENDPOINTS;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ALLOW_KEY_ENDPOINTS = originalEnv;
    } else {
      delete process.env.ALLOW_KEY_ENDPOINTS;
    }
  });

  describe("gate OFF (default — ALLOW_KEY_ENDPOINTS not set)", () => {
    it("returns 410 Gone for POST /market/sign", async () => {
      const app = makeApp();
      const res = await app.request("/market/sign", { method: "POST" });
      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.error).toContain("gone");
    });

    it("returns 410 Gone for POST /market/tasks/signed", async () => {
      const app = makeApp();
      const res = await app.request("/market/tasks/signed", { method: "POST" });
      expect(res.status).toBe(410);
    });

    it("returns 410 Gone for POST /market/tasks/:taskId/claim-with-key", async () => {
      const app = makeApp();
      const res = await app.request("/market/tasks/task-1/claim-with-key", { method: "POST" });
      expect(res.status).toBe(410);
    });

    it("returns 410 Gone for POST /market/tasks/:taskId/deliver-with-key", async () => {
      const app = makeApp();
      const res = await app.request("/market/tasks/task-1/deliver-with-key", { method: "POST" });
      expect(res.status).toBe(410);
    });

    it("returns 410 Gone for POST /market/tasks/:taskId/complete-with-key", async () => {
      const app = makeApp();
      const res = await app.request("/market/tasks/task-1/complete-with-key", { method: "POST" });
      expect(res.status).toBe(410);
    });

    it("returns 410 Gone for POST /a2a/send-with-key", async () => {
      const app = makeApp();
      const res = await app.request("/a2a/send-with-key", { method: "POST" });
      expect(res.status).toBe(410);
    });

    it("does NOT gate non-key endpoints (POST /market/tasks)", async () => {
      const app = makeApp();
      const res = await app.request("/market/tasks", { method: "POST" });
      expect(res.status).toBe(200);
    });

    it("does NOT gate /a2a/send-signed", async () => {
      const app = makeApp();
      const res = await app.request("/a2a/send-signed", { method: "POST" });
      expect(res.status).toBe(200);
    });
  });

  describe("gate ON (ALLOW_KEY_ENDPOINTS=true)", () => {
    beforeEach(() => {
      process.env.ALLOW_KEY_ENDPOINTS = "true";
    });

    it("allows POST /market/sign through", async () => {
      const app = makeApp();
      const res = await app.request("/market/sign", { method: "POST" });
      expect(res.status).toBe(200);
    });

    it("allows POST /market/tasks/signed through", async () => {
      const app = makeApp();
      const res = await app.request("/market/tasks/signed", { method: "POST" });
      expect(res.status).toBe(200);
    });

    it("allows POST /a2a/send-with-key through", async () => {
      const app = makeApp();
      const res = await app.request("/a2a/send-with-key", { method: "POST" });
      expect(res.status).toBe(200);
    });
  });
});
