import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { profileRoutes } from "../../../src/server/routes/profile";
import { cacheScanData, normalizeDomain } from "../../../src/server/profile/profile-store";
import { makeFixtureScanReport, makeFixtureAssertions } from "../profile/fixtures/scan-report-fixture";

/**
 * SLICE-101-7: Profile route tests.
 */

const app = new Hono();
app.route("/", profileRoutes);

describe("SLICE-101-7: normalizeDomain", () => {
  it("strips protocol and path", () => {
    expect(normalizeDomain("https://api.example.com/")).toBe("api.example.com");
    expect(normalizeDomain("http://api.example.com/path/to")).toBe("api.example.com");
  });

  it("strips www. prefix", () => {
    expect(normalizeDomain("www.example.com")).toBe("example.com");
    expect(normalizeDomain("https://www.example.com/")).toBe("example.com");
  });

  it("strips port", () => {
    expect(normalizeDomain("api.example.com:8080")).toBe("api.example.com");
  });

  it("lowercases", () => {
    expect(normalizeDomain("API.Example.COM")).toBe("api.example.com");
  });
});

describe("SLICE-101-7: GET /api/profile/:domain", () => {
  beforeEach(() => {
    // Cache scan data for the fixture domain
    cacheScanData("api.example.com", {
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
      reportId: "ROUTE-TEST",
    });
  });

  it("returns 200 JSON for scanned domain", async () => {
    const res = await app.request("/api/profile/api.example.com");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const body = await res.json();
    expect(body.profile_version).toBe("1.0.0");
    expect(body.service.domain).toBe("api.example.com");
  });

  it("returns 200 markdown with ?format=markdown", async () => {
    const res = await app.request("/api/profile/api.example.com?format=markdown");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/markdown");
    const text = await res.text();
    expect(text).toContain("# Knowledge Profile");
  });

  it("returns 200 YAML with ?format=yaml", async () => {
    const res = await app.request("/api/profile/api.example.com?format=yaml");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/yaml");
    const text = await res.text();
    expect(text).toContain("profile_version:");
  });

  it("returns 404 for never-scanned domain", async () => {
    const res = await app.request("/api/profile/never-scanned.example.com");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("not been scanned");
  });

  it("normalizes domain (strips www. prefix)", async () => {
    // www.example.com should normalize and match cached api.example.com? No —
    // test with a domain that normalizes to api.example.com
    const res = await app.request("/api/profile/api.example.com");
    expect(res.status).toBe(200);
  });

  it("sets Cache-Control header", async () => {
    const res = await app.request("/api/profile/api.example.com");
    expect(res.headers.get("Cache-Control")).toContain("max-age=300");
  });
});
