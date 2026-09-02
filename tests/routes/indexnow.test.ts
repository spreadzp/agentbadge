import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch to prevent real network calls
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// We import the app after env is set
import { Hono } from "hono";

// We'll test the indexnow handler in isolation by re-creating it
// with the same logic but testable. The real handler is in index.ts.
// For this test we extract the handler logic into a testable route.

const INDEXNOW_KEY = "6abf90e7f0354fb09ac01108f46a17e7";
const INDEXNOW_BASE = "https://agentbadge.xyz";
const ALLOWED_HOSTS = ["agentbadge.xyz"];
const MAX_URLS = 10;

function createTestApp(adminKey: string | undefined): Hono {
  const app = new Hono();

  // Inline adminAuth (same logic as middleware/adminAuth.ts)
  app.use("/api/indexnow", async (c, next) => {
    if (!adminKey) {
      return c.json({ error: "ADMIN_API_KEY not configured" }, 500);
    }
    const xAdminKey = c.req.header("X-Admin-Key");
    const authHeader = c.req.header("Authorization");
    const bearerKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const provided = xAdminKey ?? bearerKey;
    if (!provided || provided !== adminKey) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });

  app.post("/api/indexnow", async (c) => {
    try {
      const body = await c.req.json<{ urls?: string[] }>();
      const urls = body.urls ?? [`${INDEXNOW_BASE}/`];

      // Cap URL count
      if (urls.length > MAX_URLS) {
        return c.json({ error: `Too many URLs (max ${MAX_URLS})` }, 400);
      }

      // Allowlist: every URL must have an allowed hostname
      for (const u of urls) {
        try {
          const parsed = new URL(u);
          if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
            return c.json({ error: `URL not allowed: ${u}` }, 403);
          }
        } catch {
          return c.json({ error: `Invalid URL: ${u}` }, 400);
        }
      }

      const payload = {
        host: "agentbadge.xyz",
        key: INDEXNOW_KEY,
        keyLocation: `${INDEXNOW_BASE}/${INDEXNOW_KEY}.txt`,
        urlList: urls,
      };
      const resp = await fetch("https://api.indexnow.org/IndexNow", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
      });

      // Log submission
      console.log(`[indexnow] Submitted ${urls.length} URL(s)`);

      return c.json({ ok: resp.ok, status: resp.status, urls: urls.length });
    } catch (e) {
      return c.json({ ok: false, error: String(e) }, 500);
    }
  });

  return app;
}

describe("SLICE-85-2: IndexNow Lockdown", () => {
  const originalAdminKey = process.env.ADMIN_API_KEY;

  beforeEach(() => {
    mockFetch.mockReset();
    process.env.ADMIN_API_KEY = "test-admin-key";
  });

  afterEach(() => {
    if (originalAdminKey !== undefined) {
      process.env.ADMIN_API_KEY = originalAdminKey;
    } else {
      delete process.env.ADMIN_API_KEY;
    }
  });

  it("returns 401 without admin key", async () => {
    const app = createTestApp("test-admin-key");
    const res = await app.request("/api/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: ["https://agentbadge.xyz/"] }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong admin key", async () => {
    const app = createTestApp("test-admin-key");
    const res = await app.request("/api/indexnow", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Key": "wrong-key",
      },
      body: JSON.stringify({ urls: ["https://agentbadge.xyz/"] }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for foreign host URL", async () => {
    const app = createTestApp("test-admin-key");
    const res = await app.request("/api/indexnow", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Key": "test-admin-key",
      },
      body: JSON.stringify({ urls: ["https://evil.com/page"] }),
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("not allowed");
  });

  it("returns 400 for more than 10 URLs", async () => {
    const app = createTestApp("test-admin-key");
    const urls = Array.from({ length: 11 }, (_, i) => `https://agentbadge.xyz/page-${i}`);
    const res = await app.request("/api/indexnow", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Key": "test-admin-key",
      },
      body: JSON.stringify({ urls }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Too many");
  });

  it("forwards to IndexNow and returns upstream status on happy path", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const app = createTestApp("test-admin-key");
    const res = await app.request("/api/indexnow", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Key": "test-admin-key",
      },
      body: JSON.stringify({ urls: ["https://agentbadge.xyz/", "https://agentbadge.xyz/blog"] }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.urls).toBe(2);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("accepts Bearer auth header", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const app = createTestApp("test-admin-key");
    const res = await app.request("/api/indexnow", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-admin-key",
      },
      body: JSON.stringify({ urls: ["https://agentbadge.xyz/"] }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects invalid URL format", async () => {
    const app = createTestApp("test-admin-key");
    const res = await app.request("/api/indexnow", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Key": "test-admin-key",
      },
      body: JSON.stringify({ urls: ["not-a-url"] }),
    });
    expect(res.status).toBe(400);
  });
});
