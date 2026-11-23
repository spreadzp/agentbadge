import { describe, it, expect } from "vitest";
import { setupMockEnv } from "../e2e/helpers";
import { makeWebMCPTestApp } from "../e2e/webmcp-test-app";

setupMockEnv();
const app = makeWebMCPTestApp();

// SLICE-259-36: scanner-family endpoints must speak the canonical
// {error, code, retryable?, hint?} contract — agents read `code`/`hint`
// to self-correct, a bare {error} string leaves them guessing.
describe("SLICE-259-36: scanner API error contract", () => {
  for (const path of ["/api/scan", "/api/score", "/api/badge"]) {
    it(`${path} without ?url → 400 with code+hint`, async () => {
      const res = await app.request(path);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("MISSING_FIELDS");
      expect(body.hint).toContain("?url=");
    });
  }

  it("/api/scan with unparseable url → INVALID_ENDPOINT_URL + hint", async () => {
    const res = await app.request("/api/scan?url=%20%20");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_ENDPOINT_URL");
    expect(body.hint).toBeTruthy();
  });

  it("SSRF-guarded targets → 403 private_target_forbidden", async () => {
    const res = await app.request("/api/scan?url=http://127.0.0.1/");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("private_target_forbidden");
    expect(body.hint).toContain("SSRF");
  });

  it("/api/passport/verify without params → MISSING_FIELDS + hint", async () => {
    const res = await app.request("/api/passport/verify");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("MISSING_FIELDS");
    expect(body.hint).toContain("tokenId");
  });
});
