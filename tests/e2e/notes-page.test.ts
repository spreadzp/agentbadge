import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { contentPageRoutes } from "../../src/server/routes/content-pages";

const app = new Hono();
app.route("/", contentPageRoutes);

describe("SLICE-124-1: /notes — self-audit notes page", () => {
  it("GET /notes returns 200", async () => {
    const res = await app.request("/notes");
    expect(res.status).toBe(200);
  });

  it("GET /notes returns HTML content-type", async () => {
    const res = await app.request("/notes");
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
  });

  it("page contains at least 1 self-audit report", async () => {
    const res = await app.request("/notes");
    const html = await res.text();
    expect(html).toMatch(/self.audit|audit.report/i);
  });

  it("page has agent name in audit entries", async () => {
    const res = await app.request("/notes");
    const html = await res.text();
    expect(html).toMatch(/Claude|GPT|Gemini|agent/i);
  });

  it("page has failure points documented", async () => {
    const res = await app.request("/notes");
    const html = await res.text();
    expect(html).toMatch(/fail|broke|error|issue/i);
  });

  it("page has h1 heading", async () => {
    const res = await app.request("/notes");
    const html = await res.text();
    expect(html).toMatch(/<h1[^>]*>[\s\S]*<\/h1>/i);
  });

  it("page mentions AgentBadge", async () => {
    const res = await app.request("/notes");
    const html = await res.text();
    expect(html).toContain("AgentBadge");
  });

  it("GET /notes.json returns 200", async () => {
    const res = await app.request("/notes.json");
    expect(res.status).toBe(200);
  });

  it("GET /notes.json returns application/json", async () => {
    const res = await app.request("/notes.json");
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });

  it("/notes.json returns valid JSON with audit entries", async () => {
    const res = await app.request("/notes.json");
    const data = await res.json();
    expect(data).toHaveProperty("audits");
    expect(Array.isArray(data.audits)).toBe(true);
    expect(data.audits.length).toBeGreaterThanOrEqual(1);
  });

  it("/notes.json audit entries have required fields", async () => {
    const res = await app.request("/notes.json");
    const data = await res.json();
    const allAudits = data.audits.flatMap((run: { audits: never[] }) => run.audits);
    expect(allAudits.length).toBeGreaterThanOrEqual(1);
    for (const audit of allAudits) {
      expect(audit).toHaveProperty("agent");
      expect(audit).toHaveProperty("result");
      expect(audit).toHaveProperty("failure_points");
    }
  });
});
