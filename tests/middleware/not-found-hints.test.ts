/**
 * SLICE-234-30: intent-aware 404 suggestions.
 *
 * Contracts:
 * - Whitelisted probe paths → 404 JSON with `suggestions` ⊆ live
 *   endpoints (guard-test below proves every suggestion resolves).
 * - Excluded probe classes → bare 404, no `suggestions` key.
 * - HTML branch → unchanged, no `suggestions`.
 * - Non-whitelisted 404 → bare 404 (no hint leakage to random paths).
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { structuredNotFoundHandler } from "../../src/server/middleware/structured-error-handler";
import {
  NOT_FOUND_HINTS,
  notFoundSuggestions,
} from "../../src/server/lib/not-found-hints";
import { createApp } from "../../src/server/index";

function app() {
  const a = new Hono();
  a.notFound(structuredNotFoundHandler());
  return a;
}

const json404 = (path: string) =>
  app().request(path, { headers: { Accept: "application/json" } });

describe("SLICE-234-30: not-found suggestions", () => {
  describe("whitelist — /api/trust/* probes", () => {
    it.each([
      "/api/trust/unknown.example.com",
      "/api/trust/domain",
      "/api/trust/:domain", // literal path-template copied from openapi
      "/api/trust/example.com/extra",
    ])("%s → 404 + trust suggestions", async (path) => {
      const res = await json404(path);
      expect(res.status).toBe(404);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("not_found");
      expect(body.suggestions).toEqual([
        "/api/meta/trust-tiers",
        "/api/v1/services",
        "/agent-guide",
      ]);
    });
  });

  describe("whitelist — MCP-config probes", () => {
    it.each([
      "/.cursor/mcp.json",
      "/.vscode/mcp.json",
      "/.codeium/windsurf/mcp_config.json",
      "/.windsurf/mcp_config.json",
      "/mcp.json",
      "/.well-known/mcp-server",
    ])("%s → 404 + MCP manifest suggestions", async (path) => {
      const res = await json404(path);
      expect(res.status).toBe(404);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.suggestions).toEqual([
        "/.well-known/mcp.json",
        "/mcp/public",
        "/.well-known/agentbadge-machine.json",
        "/agent-guide",
      ]);
    });
  });

  describe("excluded probes → bare 404", () => {
    it.each([
      "/.env",
      "/.env.local",
      "/wp-login.php",
      "/wp-admin",
      "/smoke/health",
      "/nonexistent-page",
      "/.well-known/farcaster.json",
      "/.well-known/host-meta",
      "/jobs",
      "/careers",
      "/join/careers",
    ])("%s → 404 without suggestions", async (path) => {
      const res = await json404(path);
      expect(res.status).toBe(404);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("not_found");
      expect(body).not.toHaveProperty("suggestions");
    });
  });

  describe("non-whitelisted 404 → bare 404 (no hint leakage)", () => {
    it.each(["/random/path", "/api/unknown", "/foo/bar/baz"])(
      "%s → no suggestions",
      async (path) => {
        const res = await json404(path);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body).not.toHaveProperty("suggestions");
      },
    );
  });

  describe("HTML branch unchanged", () => {
    it("Accept: text/html → HTML 404 without suggestions", async () => {
      const res = await app().request("/api/trust/example.com", {
        headers: { Accept: "text/html" },
      });
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("text/html");
      const text = await res.text();
      expect(text).toContain("404");
      expect(text).not.toContain("suggestions");
    });
  });

  describe("guard: suggestions ⊆ registered routes", () => {
    it("every suggestion path is a registered GET route in the real app", () => {
      const realApp = createApp();
      const registered = new Set(
        realApp.routes
          .filter((r) => r.method === "GET" || r.method === "ALL")
          .map((r) => r.path),
      );
      const allSuggestions = NOT_FOUND_HINTS.flatMap((h) => h.suggestions);
      expect(allSuggestions.length).toBeGreaterThan(0);
      for (const suggestion of allSuggestions) {
        expect(
          registered.has(suggestion),
          `suggestion ${suggestion} is not a registered route — ` +
            "a 404 hint must never point at another 404",
        ).toBe(true);
      }
    });

    it("notFoundSuggestions() returns undefined for excluded paths", () => {
      expect(notFoundSuggestions("/.env")).toBeUndefined();
      expect(notFoundSuggestions("/wp-admin")).toBeUndefined();
      expect(notFoundSuggestions("/.well-known/host-meta")).toBeUndefined();
      expect(notFoundSuggestions("/join/careers")).toBeUndefined();
    });
  });
});
