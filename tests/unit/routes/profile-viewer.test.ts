import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { profileViewerRoutes } from "../../../src/server/routes/profile-viewer";
import { cacheScanData, clearScanCache } from "../../../src/server/profile/profile-store";
import { resetConfigCache } from "../../../src/config/env";
import { makeFixtureScanReport, makeFixtureAssertions } from "../profile/fixtures/scan-report-fixture";

/**
 * SLICE-101-9: Profile viewer route tests.
 */

const app = new Hono();
app.route("/", profileViewerRoutes);

describe("SLICE-101-9: GET /profile/:domain", () => {
  beforeEach(() => {
    delete process.env.DATABASE_ENABLED;
    delete process.env.DATABASE_URL;
    resetConfigCache();
    clearScanCache();
    cacheScanData("api.example.com", {
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
      reportId: "VIEWER-TEST",
    });
  });

  it("returns 200 HTML for scanned domain", async () => {
    const res = await app.request("/profile/api.example.com");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Knowledge Profile");
    expect(html).toContain("api.example.com");
  });

  it("contains readiness score and grade", async () => {
    const res = await app.request("/profile/api.example.com");
    const html = await res.text();
    expect(html).toContain("Readiness");
    expect(html).toContain("Grade");
  });

  it("contains links to JSON/YAML/markdown endpoints", async () => {
    const res = await app.request("/profile/api.example.com");
    const html = await res.text();
    expect(html).toContain("/api/profile/api.example.com");
    expect(html).toContain("format=yaml");
    expect(html).toContain("format=markdown");
  });

  it("contains freshness section", async () => {
    const res = await app.request("/profile/api.example.com");
    const html = await res.text();
    expect(html).toContain("Freshness");
    expect(html).toContain("Oldest evidence");
  });

  it("contains evidence summary", async () => {
    const res = await app.request("/profile/api.example.com");
    const html = await res.text();
    expect(html).toContain("Evidence Summary");
    expect(html).toContain("Total assertions");
  });

  it("returns 404 for never-scanned domain", async () => {
    const res = await app.request("/profile/never-scanned.example.com");
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("Not Found");
  });

  it("sets Cache-Control header", async () => {
    const res = await app.request("/profile/api.example.com");
    expect(res.headers.get("Cache-Control")).toContain("max-age=300");
  });
});
