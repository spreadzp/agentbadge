import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { workRequestRoutes, resetRateLimits } from "../../src/server/routes/api/work-requests";
import { workRequestStore } from "../../src/server/services/work-request-store";

function makeApp(): Hono {
  const app = new Hono();
  app.route("/", workRequestRoutes);
  return app;
}

beforeEach(() => {
  workRequestStore.clear();
  resetRateLimits();
});

describe("SLICE-46-9: Work Request API", () => {
  describe("POST /api/work-requests", () => {
    it("returns 202 with request_id and status_url on valid input", async () => {
      const app = makeApp();
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: {
            title: "Build an MCP server for our docs",
            summary: "We need an MCP server that exposes our documentation to AI agents.",
            requirements: ["TypeScript", "Hono framework"],
          },
          preferred_contact: { channel: "telegram" },
        }),
      });

      expect(res.status).toBe(202);
      const body = await res.json();
      expect(body.request_id).toBeDefined();
      expect(body.status_url).toBe(`/api/work-requests/${body.request_id}`);
    });

    it("returns 400 on missing request field", async () => {
      const app = makeApp();
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferred_contact: { channel: "telegram" } }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 on missing title", async () => {
      const app = makeApp();
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: { summary: "Some summary" },
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 on title exceeding 200 chars", async () => {
      const app = makeApp();
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: { title: "x".repeat(201), summary: "valid summary" },
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 on summary exceeding 5000 chars", async () => {
      const app = makeApp();
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: { title: "Valid title", summary: "x".repeat(5001) },
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 on requirements exceeding 20 items", async () => {
      const app = makeApp();
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: {
            title: "Valid title",
            summary: "Valid summary",
            requirements: Array(21).fill("req"),
          },
        }),
      });

      expect(res.status).toBe(400);
    });

    it("rejects secrets in request body (API_KEY pattern)", async () => {
      const app = makeApp();
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: {
            title: "Valid title",
            summary: "My API_KEY=abc123 is here",
          },
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("SECRET_REJECTED");
    });

    it("rejects secrets in request body (PRIVATE_KEY pattern)", async () => {
      const app = makeApp();
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: {
            title: "Valid title",
            summary: "PRIVATE_KEY=0xdeadbeef is here",
          },
        }),
      });

      expect(res.status).toBe(400);
    });

    it("rejects HTML/JS injection in summary", async () => {
      const app = makeApp();
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: {
            title: "Valid title",
            summary: "<script>alert('xss')</script>",
          },
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 429 after 5 requests per hour from same IP", async () => {
      const app = makeApp();
      const validBody = JSON.stringify({
        request: { title: "Test", summary: "Test summary" },
      });

      for (let i = 0; i < 5; i++) {
        const res = await app.request("/api/work-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
          body: validBody,
        });
        expect(res.status).toBe(202);
      }

      const res6 = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
        body: validBody,
      });
      expect(res6.status).toBe(429);
    });
  });

  describe("GET /api/work-requests/:id", () => {
    it("returns 404 for non-existent request", async () => {
      const app = makeApp();
      const res = await app.request("/api/work-requests/nonexistent-id");
      expect(res.status).toBe(404);
    });

    it("returns request details for existing request", async () => {
      const app = makeApp();
      const createRes = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: { title: "Test request", summary: "Test summary" },
        }),
      });
      const created = await createRes.json();

      const getRes = await app.request(`/api/work-requests/${created.request_id}`);
      expect(getRes.status).toBe(200);
      const body = await getRes.json();
      expect(body.id).toBe(created.request_id);
      expect(body.status).toBe("received");
      expect(body.request.title).toBe("Test request");
      expect(body.created_at).toBeDefined();
    });
  });
});
