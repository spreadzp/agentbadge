import { describe, it, expect } from "vitest";
import { makeTestApp, setupMockEnv } from "../e2e/helpers";

setupMockEnv();
const app = makeTestApp();

// SLICE-259-35: /api/badge SVGs link to https://agentbadge.xyz/r/{domain}.
// The route must resolve to a real report surface — never 404.
describe("SLICE-259-35: /r/:domain badge report link", () => {
  it("own domain → 301 to the cached self-scan showcase", async () => {
    const res = await app.request("/r/agentbadge.xyz");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/agent-readiness");
  });

  it("www. own domain → 301 to the same showcase", async () => {
    const res = await app.request("/r/www.agentbadge.xyz");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/agent-readiness");
  });

  it("foreign domain → 302 to the free JSON scan", async () => {
    const res = await app.request("/r/example.com");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `/api/scan?url=${encodeURIComponent("https://example.com")}`,
    );
  });

  it("uppercase domain is normalised", async () => {
    const res = await app.request("/r/EXAMPLE.COM");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `/api/scan?url=${encodeURIComponent("https://example.com")}`,
    );
  });

  it("rejects pathological domains with a structured 400", async () => {
    for (const bad of ["evi..l.com", "-bad.com", "bad-.com", "under_score.com"]) {
      const res = await app.request(`/r/${bad}`);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("invalid_domain");
      expect(body.hint).toBeTruthy();
    }
  });
});
