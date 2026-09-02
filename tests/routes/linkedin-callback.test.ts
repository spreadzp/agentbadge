/**
 * SLICE-83-3: LinkedIn OAuth callback hardening tests.
 *
 * Verifies:
 * 1. Token never appears in response body
 * 2. Set-Cookie header present with HttpOnly + Secure + SameSite=Lax
 * 3. Token never appears in console output (no console.log of token)
 * 4. Error cases handled without leaking token
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { linkedinRoutes } from "../../src/server/routes/linkedin";

// Capture console output to verify no token logging
let consoleOutput: string[] = [];
const originalLog = console.log;
const originalError = console.error;

function captureConsole() {
  consoleOutput = [];
  console.log = (...args: unknown[]) => {
    consoleOutput.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    consoleOutput.push(args.map(String).join(" "));
  };
}

function restoreConsole() {
  console.log = originalLog;
  console.error = originalError;
}

// Mock the LinkedIn token endpoint
const MOCK_TOKEN = "AQfake-token-never-leak-1234567890";
const MOCK_EXPIRES_IN = 5184000;

function mockLinkedInTokenEndpoint() {
  const originalFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("linkedin.com/oauth/v2/accessToken")) {
        const body = new URLSearchParams(init?.body as string);
        if (body.get("code") === "valid_code") {
          return new Response(
            JSON.stringify({ access_token: MOCK_TOKEN, expires_in: MOCK_EXPIRES_IN }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ error: "invalid_grant", error_description: "Bad code" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      return originalFetch(url as string, init);
    }),
  );
  return () => vi.unstubAllGlobals();
}

function makeApp(): Hono {
  const app = new Hono();
  app.route("/", linkedinRoutes);
  return app;
}

describe("SLICE-83-3: LinkedIn OAuth callback hardening", () => {
  let restoreFetch: () => void;

  beforeEach(() => {
    process.env.LINKEDIN_CLIENT_ID = "test-client-id";
    process.env.LINKEDIN_CLIENT_SECRET = "test-client-secret";
    process.env.LINKEDIN_REDIRECT_URI = "http://localhost:3000/linkedin/callback";
    restoreFetch = mockLinkedInTokenEndpoint();
    captureConsole();
  });

  afterEach(() => {
    restoreConsole();
    restoreFetch();
    delete process.env.LINKEDIN_CLIENT_ID;
    delete process.env.LINKEDIN_CLIENT_SECRET;
    delete process.env.LINKEDIN_REDIRECT_URI;
  });

  it("does NOT include access_token in response body", async () => {
    const app = makeApp();
    const res = await app.request("/linkedin/callback?code=valid_code");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty("access_token");
    expect(body.ok).toBe(true);
  });

  it("sets Set-Cookie header with HttpOnly + Secure + SameSite=Lax", async () => {
    const app = makeApp();
    const res = await app.request("/linkedin/callback?code=valid_code");
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("cookie contains the token but response body does not", async () => {
    const app = makeApp();
    const res = await app.request("/linkedin/callback?code=valid_code");
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("li_token=");
    // Token should be in cookie but NOT in body
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(MOCK_TOKEN);
  });

  it("cookie has Max-Age matching expires_in", async () => {
    const app = makeApp();
    const res = await app.request("/linkedin/callback?code=valid_code");
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain(`Max-Age=${MOCK_EXPIRES_IN}`);
  });

  it("does NOT log the access token to console", async () => {
    const app = makeApp();
    await app.request("/linkedin/callback?code=valid_code");
    const allOutput = consoleOutput.join("\n");
    expect(allOutput).not.toContain(MOCK_TOKEN);
  });

  it("logs success without token", async () => {
    const app = makeApp();
    await app.request("/linkedin/callback?code=valid_code");
    // Should have some success log, but without the token
    const allOutput = consoleOutput.join("\n");
    expect(allOutput).not.toContain(MOCK_TOKEN);
  });

  it("returns 400 when missing code parameter", async () => {
    const app = makeApp();
    const res = await app.request("/linkedin/callback");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("returns 400 when LinkedIn returns error query param", async () => {
    const app = makeApp();
    const res = await app.request("/linkedin/callback?error=access_denied");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("access_denied");
  });

  it("returns 502 when token exchange fails (bad code)", async () => {
    const app = makeApp();
    const res = await app.request("/linkedin/callback?code=bad_code");
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("returns 500 when LINKEDIN_CLIENT_ID not set", async () => {
    delete process.env.LINKEDIN_CLIENT_ID;
    const app = makeApp();
    const res = await app.request("/linkedin/callback?code=valid_code");
    expect(res.status).toBe(500);
  });
});
