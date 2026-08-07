import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, setupMockEnv } from "./e2e/helpers";
import { workRequestStore } from "../src/server/services/work-request-store";
import { resetRateLimits } from "../src/server/routes/api/work-requests";

setupMockEnv();
const app = makeTestApp();

function validBody(overrides?: Record<string, unknown>) {
  return {
    request: {
      title: "Build an MCP server for our API",
      summary: "We need an MCP server that wraps our REST API for AI agent consumption.",
      requirements: ["TypeScript", "Hedera SDK"],
    },
    preferred_contact: { channel: "telegram" },
    ...overrides,
  };
}

describe("SLICE-46-9: Work Request API", () => {
  beforeEach(() => {
    workRequestStore.clear();
    resetRateLimits();
  });

  describe("POST /api/work-requests", () => {
    it("returns 202 with request_id and status_url", async () => {
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody()),
      });
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.request_id).toBeDefined();
      expect(json.status_url).toContain("/api/work-requests/");
    });

    it("returns 400 for missing request field", async () => {
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ foo: "bar" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for missing title", async () => {
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: { summary: "test" },
        }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for missing summary", async () => {
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: { title: "test" },
        }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when title exceeds 200 chars", async () => {
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          validBody({
            request: { title: "a".repeat(201), summary: "test" },
          }),
        ),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when summary exceeds 5000 chars", async () => {
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          validBody({
            request: { title: "test", summary: "a".repeat(5001) },
          }),
        ),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when requirements exceeds 20 items", async () => {
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          validBody({
            request: {
              title: "test",
              summary: "test",
              requirements: Array(21).fill("req"),
            },
          }),
        ),
      });
      expect(res.status).toBe(400);
    });

    it("rejects secrets — API_KEY", async () => {
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          validBody({
            request: { title: "test", summary: "my API_KEY is 12345" },
          }),
        ),
      });
      expect(res.status).toBe(400);
    });

    it("rejects secrets — PRIVATE_KEY", async () => {
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          validBody({
            request: { title: "test", summary: "PRIVATE_KEY=0xabc" },
          }),
        ),
      });
      expect(res.status).toBe(400);
    });

    it("rejects secrets — PASSWORD", async () => {
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          validBody({
            request: { title: "test", summary: "PASSWORD=hunter2" },
          }),
        ),
      });
      expect(res.status).toBe(400);
    });

    it("rejects secrets — SECRET", async () => {
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          validBody({
            request: { title: "test", summary: "SECRET=value" },
          }),
        ),
      });
      expect(res.status).toBe(400);
    });

    it("rejects secrets — TOKEN", async () => {
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          validBody({
            request: { title: "test", summary: "TOKEN=abc123" },
          }),
        ),
      });
      expect(res.status).toBe(400);
    });

    it("rejects HTML script tags", async () => {
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          validBody({
            request: { title: "test", summary: "<script>alert(1)</script>" },
          }),
        ),
      });
      expect(res.status).toBe(400);
    });

    it("rejects iframe tags", async () => {
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          validBody({
            request: { title: "test", summary: "<iframe src='evil.com'></iframe>" },
          }),
        ),
      });
      expect(res.status).toBe(400);
    });

    it("rejects javascript: protocol", async () => {
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          validBody({
            request: { title: "test", summary: "javascript:alert(1)" },
          }),
        ),
      });
      expect(res.status).toBe(400);
    });

    it("rejects on* event handlers", async () => {
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          validBody({
            request: { title: "test", summary: "<img onload=alert(1)>" },
          }),
        ),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid JSON", async () => {
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });

    it("rate limits: 5/hour per IP", async () => {
      const headers = {
        "Content-Type": "application/json",
        "X-Forwarded-For": "10.0.0.99",
      };
      // Submit 5 requests (should succeed)
      for (let i = 0; i < 5; i++) {
        const res = await app.request("/api/work-requests", {
          method: "POST",
          headers,
          body: JSON.stringify(validBody({ request: { title: `test-${i}`, summary: "test" } })),
        });
        expect(res.status).toBe(202);
      }
      // 6th should be rate limited
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers,
        body: JSON.stringify(validBody()),
      });
      expect(res.status).toBe(429);
    });

    it("sets X-RateLimit headers", async () => {
      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody()),
      });
      expect(res.headers.get("X-RateLimit-Limit")).toBe("5");
      expect(res.headers.get("X-RateLimit-Remaining")).toBeDefined();
    });
  });

  describe("GET /api/work-requests/:id", () => {
    it("returns 200 with request details", async () => {
      const createRes = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody()),
      });
      const { request_id } = await createRes.json();

      const res = await app.request(`/api/work-requests/${request_id}`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.id).toBe(request_id);
      expect(json.status).toBe("received");
      expect(json.request.title).toBe("Build an MCP server for our API");
      expect(json.created_at).toBeDefined();
      expect(json.updated_at).toBeDefined();
    });

    it("returns 404 for non-existent request", async () => {
      const res = await app.request("/api/work-requests/wr-nonexistent");
      expect(res.status).toBe(404);
    });

    it("returns correct status flow value", async () => {
      const createRes = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody()),
      });
      const { request_id } = await createRes.json();

      // Update status via store (simulating human review)
      workRequestStore.updateStatus(request_id, "human_review");

      const res = await app.request(`/api/work-requests/${request_id}`);
      const json = await res.json();
      expect(json.status).toBe("human_review");
    });
  });

  describe("In-memory storage", () => {
    it("persists across requests within same process", async () => {
      const createRes = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody()),
      });
      const { request_id } = await createRes.json();

      const get1 = await app.request(`/api/work-requests/${request_id}`);
      const get2 = await app.request(`/api/work-requests/${request_id}`);
      const j1 = await get1.json();
      const j2 = await get2.json();
      expect(j1.id).toBe(j2.id);
    });
  });
});
