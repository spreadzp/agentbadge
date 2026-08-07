import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, setupMockEnv } from "./e2e/helpers";
import { workRequestStore } from "../src/server/services/work-request-store";
import { resetRateLimits } from "../src/server/routes/api/work-requests";

setupMockEnv();
const app = makeTestApp();

async function createRequest(): Promise<string> {
  const res = await app.request("/api/work-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      request: {
        title: "Build an MCP server",
        summary: "We need an MCP server for our REST API.",
        requirements: ["TypeScript", "Hedera SDK"],
      },
      preferred_contact: { channel: "telegram" },
    }),
  });
  const json = await res.json();
  return json.request_id;
}

describe("SLICE-46-11: Human UI — /work-requests/{id}", () => {
  beforeEach(() => {
    workRequestStore.clear();
    resetRateLimits();
  });

  describe("GET /work-requests/:id", () => {
    it("returns 200 and renders request details", async () => {
      const id = await createRequest();
      const res = await app.request(`/work-requests/${id}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Build an MCP server");
      expect(html).toContain("We need an MCP server for our REST API.");
      expect(html).toContain("TypeScript");
      expect(html).toContain("Hedera SDK");
    });

    it("shows status badge", async () => {
      const id = await createRequest();
      const res = await app.request(`/work-requests/${id}`);
      const html = await res.text();
      expect(html).toContain("received");
    });

    it("shows created_at timestamp", async () => {
      const id = await createRequest();
      const res = await app.request(`/work-requests/${id}`);
      const html = await res.text();
      expect(html).toContain("Created");
      expect(html).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it("shows action buttons", async () => {
      const id = await createRequest();
      const res = await app.request(`/work-requests/${id}`);
      const html = await res.text();
      expect(html).toContain("Accept");
      expect(html).toContain("Ask");
      expect(html).toContain("Decline");
    });

    it("shows link to JSON API", async () => {
      const id = await createRequest();
      const res = await app.request(`/work-requests/${id}`);
      const html = await res.text();
      expect(html).toContain(`/api/work-requests/${id}`);
    });

    it("returns 404 for non-existent request", async () => {
      const res = await app.request("/work-requests/wr-nonexistent");
      expect(res.status).toBe(404);
      const html = await res.text();
      expect(html).toContain("not found");
    });

    it("page is private — has noindex meta tag", async () => {
      const id = await createRequest();
      const res = await app.request(`/work-requests/${id}`);
      const html = await res.text();
      expect(html).toContain('name="robots"');
      expect(html).toContain("noindex");
    });

    it("shows preferred contact channel", async () => {
      const id = await createRequest();
      const res = await app.request(`/work-requests/${id}`);
      const html = await res.text();
      expect(html).toContain("telegram");
    });
  });

  describe("POST /work-requests/:id/accept", () => {
    it("changes status to accepted", async () => {
      const id = await createRequest();
      const res = await app.request(`/work-requests/${id}/accept`, {
        method: "POST",
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("accepted");
    });

    it("returns 404 for non-existent request", async () => {
      const res = await app.request("/work-requests/wr-nonexistent/accept", {
        method: "POST",
      });
      expect(res.status).toBe(404);
    });

    it("agent can poll API and see accepted status", async () => {
      const id = await createRequest();
      await app.request(`/work-requests/${id}/accept`, { method: "POST" });

      const apiRes = await app.request(`/api/work-requests/${id}`);
      const json = await apiRes.json();
      expect(json.status).toBe("accepted");
    });
  });

  describe("POST /work-requests/:id/ask", () => {
    it("changes status to needs_information", async () => {
      const id = await createRequest();
      const res = await app.request(`/work-requests/${id}/ask`, {
        method: "POST",
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("needs_information");
    });

    it("returns 404 for non-existent request", async () => {
      const res = await app.request("/work-requests/wr-nonexistent/ask", {
        method: "POST",
      });
      expect(res.status).toBe(404);
    });

    it("agent can poll API and see needs_information status", async () => {
      const id = await createRequest();
      await app.request(`/work-requests/${id}/ask`, { method: "POST" });

      const apiRes = await app.request(`/api/work-requests/${id}`);
      const json = await apiRes.json();
      expect(json.status).toBe("needs_information");
    });
  });

  describe("POST /work-requests/:id/decline", () => {
    it("changes status to declined", async () => {
      const id = await createRequest();
      const res = await app.request(`/work-requests/${id}/decline`, {
        method: "POST",
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("declined");
    });

    it("returns 404 for non-existent request", async () => {
      const res = await app.request("/work-requests/wr-nonexistent/decline", {
        method: "POST",
      });
      expect(res.status).toBe(404);
    });

    it("agent can poll API and see declined status", async () => {
      const id = await createRequest();
      await app.request(`/work-requests/${id}/decline`, { method: "POST" });

      const apiRes = await app.request(`/api/work-requests/${id}`);
      const json = await apiRes.json();
      expect(json.status).toBe("declined");
    });
  });

  describe("Page is responsive", () => {
    it("has responsive grid classes", async () => {
      const id = await createRequest();
      const res = await app.request(`/work-requests/${id}`);
      const html = await res.text();
      expect(html).toContain("sm:grid-cols-2");
    });

    it("has responsive flex layout for actions", async () => {
      const id = await createRequest();
      const res = await app.request(`/work-requests/${id}`);
      const html = await res.text();
      expect(html).toContain("sm:flex-row");
    });
  });
});
