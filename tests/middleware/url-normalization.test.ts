import { describe, it, expect, beforeAll, vi } from "vitest";

process.env.MOCK_HEDERA = "true";
process.env.PASSPORT_TOKEN_ID = "0.0.1234567";

// Prevent Bun.serve from binding a port during test import
const bunGlobal = (globalThis as Record<string, unknown>).Bun ?? {};
vi.stubGlobal("Bun", {
  ...bunGlobal,
  serve: vi.fn(() => ({ hostname: "localhost", port: 0 })),
});

const { createApp } = await import("../../src/server/index");

describe("SLICE-81-1: URL normalization middleware", () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    app = createApp();
  });

  describe("www → apex 301 redirect", () => {
    it("redirects www.agentbadge.xyz to apex preserving path+query", async () => {
      const res = await app.request("/pricing?tier=bronze", {
        headers: { host: "www.agentbadge.xyz" },
      });
      expect(res.status).toBe(301);
      const location = res.headers.get("location") ?? "";
      expect(location).toContain("agentbadge.xyz/pricing");
      expect(location).toContain("tier=bronze");
      expect(location).not.toContain("www.");
    });

    it("redirects www.agentbadge.xyz root to apex root", async () => {
      const res = await app.request("/", {
        headers: { host: "www.agentbadge.xyz" },
      });
      expect(res.status).toBe(301);
      const location = res.headers.get("location") ?? "";
      expect(location).toMatch(/\/\/agentbadge\.xyz\/?$/);
      expect(location).not.toContain("www.");
    });
  });

  describe("trailing-slash normalization", () => {
    it("redirects /pricing/ to /pricing (301)", async () => {
      const res = await app.request("/pricing/", {
        headers: { host: "agentbadge.xyz" },
      });
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toMatch(/\/pricing$/);
    });

    it("does not redirect root /", async () => {
      const res = await app.request("/", {
        headers: { host: "agentbadge.xyz" },
      });
      expect(res.status).not.toBe(301);
    });

    it("redirects /blog/some-slug/ to /blog/some-slug", async () => {
      const res = await app.request("/blog/some-slug/", {
        headers: { host: "agentbadge.xyz" },
      });
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toMatch(/\/blog\/some-slug$/);
    });

    it("preserves query string when stripping trailing slash", async () => {
      const res = await app.request("/pricing/?foo=bar", {
        headers: { host: "agentbadge.xyz" },
      });
      expect(res.status).toBe(301);
      const location = res.headers.get("location") ?? "";
      expect(location).toContain("foo=bar");
      expect(location).not.toContain("/pricing/?");
      expect(location).toMatch(/\/pricing\?foo=bar$/);
    });
  });

  describe("fly.dev exact-match redirect (no substring over-match)", () => {
    it("redirects exact fly.dev host", async () => {
      const res = await app.request("/", {
        headers: { host: "agent-passport-hedera.fly.dev" },
      });
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toContain("agentbadge.xyz");
    });

    it("does not redirect crafted host containing fly.dev substring", async () => {
      const res = await app.request("/", {
        headers: { host: "evil-agent-passport-hedera.fly.dev.attacker.com" },
      });
      expect(res.status).not.toBe(301);
    });
  });

  describe("apex host passes through", () => {
    it("agentbadge.xyz is not redirected", async () => {
      const res = await app.request("/pricing", {
        headers: { host: "agentbadge.xyz" },
      });
      expect(res.status).not.toBe(301);
    });
  });
});
