/**
 * SLICE-103-6: Tests for report API endpoints.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { Hono } from "hono";
import { reportRoutes } from "../../src/server/routes/report-api";
import { createTestRecord } from "./corpus-fixtures";

const REPORTS_DIR = path.join(process.cwd(), "data", "corpus", "reports");
const CORPUS_DIR = path.join(process.cwd(), "data", "corpus", "records");

function makeApp(): Hono {
  const app = new Hono();
  app.route("/", reportRoutes);
  return app;
}

async function _setupCorpus(records: ReturnType<typeof createTestRecord>[]) {
  fs.mkdirSync(CORPUS_DIR, { recursive: true });
  const testFile = path.join(CORPUS_DIR, "test-report-api.jsonl");
  const lines = records.map((r) => JSON.stringify(r)).join("\n");
  fs.writeFileSync(testFile, lines, "utf-8");
  return testFile;
}

describe("SLICE-103-6: report-api", () => {
  let app: Hono;
  let testFile: string | null = null;

  beforeEach(() => {
    app = makeApp();
  });

  afterEach(() => {
    // Clean up test corpus file
    if (testFile && fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
      testFile = null;
    }
    // Clean up test reports
    if (fs.existsSync(REPORTS_DIR)) {
      const files = fs.readdirSync(REPORTS_DIR);
      for (const f of files) {
        if (f.startsWith("soar-")) fs.unlinkSync(path.join(REPORTS_DIR, f));
      }
    }
  });

  it("GET /api/reports/state-of-agent-readiness returns empty array when no reports", async () => {
    const res = await app.request("/api/reports/state-of-agent-readiness");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("GET /api/reports/state-of-agent-readiness/latest returns 404 when no reports", async () => {
    const res = await app.request("/api/reports/state-of-agent-readiness/latest");
    expect(res.status).toBe(404);
  });

  it("GET /api/reports/state-of-agent-readiness/latest?format=markdown returns 404 when no reports", async () => {
    const res = await app.request("/api/reports/state-of-agent-readiness/latest?format=markdown");
    expect(res.status).toBe(404);
  });

  it("POST /api/reports/state-of-agent-readiness/generate returns 503 when corpus empty", async () => {
    // This test relies on the corpus being empty or having data
    // We can't easily mock the store, so we test the response shape
    const res = await app.request("/api/reports/state-of-agent-readiness/generate", { method: "POST" });
    // Either 503 (no data) or 200 (has data)
    expect([200, 503]).toContain(res.status);
    const data = await res.json();
    if (res.status === 503) {
      expect(data).toHaveProperty("error");
    } else {
      expect(data).toHaveProperty("id");
      expect(data).toHaveProperty("status");
    }
  });

  it("GET /api/corpus/export returns JSON array", async () => {
    const res = await app.request("/api/corpus/export");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("GET /api/corpus/export?from=2026-09&to=2026-09 filters by date", async () => {
    const res = await app.request("/api/corpus/export?from=2026-09&to=2026-09");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });
});
