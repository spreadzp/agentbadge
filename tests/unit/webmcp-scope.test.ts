// SLICE-256-5: page-scoped WebMCP injection middleware + discovery sync.
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  webmcpPageScope,
  webmcpPageScopeForPath,
} from "../../src/server/middleware/webmcp-scope";
import { toolsFor, registry, PAGE_TOOLSETS } from "@agentbadge/webmcp";
import { collectSources } from "../../src/server/lib/agent-discovery/sources";
import { webmcpSection } from "../../src/server/lib/agent-discovery/llms-core";
import { buildAgentCard } from "../../src/server/lib/agent-discovery/agent-card";

const names = (page: string) => toolsFor({ page }).map((t) => t.name);

const toolNamesInHtml = (html: string): string[] =>
  [...html.matchAll(/name: "([a-z-]+)"/g)].map((m) => m[1]);

function scopedApp(path: string): Hono {
  const app = new Hono();
  app.use("*", webmcpPageScope());
  app.get(path, (c) => c.html("<html><body>page</body></html>"));
  return app;
}

describe("webmcpPageScopeForPath (D-256-Q5 mapping)", () => {
  it.each([
    ["/", "landing"],
    ["/en-us", "landing"],
    ["/passport", "landing"],
    ["/services/scanner", "scanner"],
    ["/agent-readiness", "scanner"],
    ["/services/marketplace", "market"],
    ["/market/services", "market"],
    ["/market/services/svc_1", "market"],
    ["/work-requests/wr_1", "market"],
    ["/verify", "trust"],
    ["/agent-guide", "docs"],
    ["/guides/bstock", "docs"],
    ["/rules", "docs"],
    ["/rules/ab-001", "docs"],
  ])("maps %s → %s", (path, expected) => {
    expect(webmcpPageScopeForPath(path)).toBe(expected);
  });

  it.each(["/api/tasks/open", "/pricing.json", "/blog/x", "/mcp/public"])(
    "leaves %s unscoped",
    (path) => expect(webmcpPageScopeForPath(path)).toBeNull(),
  );
});

describe("webmcpPageScope middleware", () => {
  it("injects the exact page toolset before </body>", async () => {
    for (const [path, page] of [
      ["/", "landing"],
      ["/services/scanner", "scanner"],
      ["/market/services", "market"],
      ["/verify", "trust"],
      ["/agent-guide", "docs"],
    ] as const) {
      const app = scopedApp(path);
      const res = await app.request(path);
      const html = await res.text();
      const expected = names(page);
      const injected = toolNamesInHtml(html);
      for (const name of expected) {
        expect(injected, `${path} missing ${name}`).toContain(name);
      }
      expect(injected.length).toBe(expected.length);
      expect(html.indexOf("</body>")).toBeGreaterThan(html.indexOf("registerTool"));
      expect(res.headers.get("Link")).toContain("/.well-known/webmcp.json");
    }
  });

  it("landing gets the full v2 inventory; scoped pages get subsets", async () => {
    const landing = new Set(names("landing"));
    const scanner = new Set(names("scanner"));
    expect(landing.size).toBeGreaterThan(scanner.size);
    for (const t of scanner) expect(landing).toContain(t);
    // submit/poll on every interaction page (slice AC)
    for (const page of ["scanner", "market", "trust"]) {
      expect(names(page)).toEqual(expect.arrayContaining(["submit-request", "poll-request"]));
    }
    // market page exposes marketplace + inbox, not readiness/trust-only tools
    const market = names("market");
    expect(market).toEqual(expect.arrayContaining(["browse-tasks", "submit-request"]));
    expect(market).not.toContain("agent-readiness-scan");
    expect(market).not.toContain("verify-verdict");
  });

  it("no page registers tools outside {read, intake-write} writeClass", () => {
    const allowed = new Set(["read", "intake-write"]);
    for (const page of Object.keys(PAGE_TOOLSETS)) {
      for (const t of toolsFor({ page })) {
        expect(allowed.has(t.writeClass)).toBe(true);
      }
    }
  });

  it("skips non-HTML and unscoped responses untouched", async () => {
    const app = new Hono();
    app.use("*", webmcpPageScope());
    app.get("/", (c) => c.json({ ok: true }));
    app.get("/other", (c) => c.html("<html><body>x</body></html>"));
    const j = await (await app.request("/")).text();
    expect(j).not.toContain("registerTool");
    const o = await (await app.request("/other")).text();
    expect(o).not.toContain("registerTool");
  });
});

describe("e2e: real pages carry their scoped toolset", () => {
  it("GET / injects the landing toolset; GET /verify injects only trust scope", async () => {
    const { createApp } = await import("../../src/server/index");
    const app = createApp();
    const home = await app.request("/");
    const homeHtml = await home.text();
    expect(home.status).toBe(200);
    for (const n of names("landing")) {
      expect(homeHtml, `/ missing ${n}`).toContain(`name: "${n}"`);
    }
    const res = await app.request("/verify");
    const html = await res.text();
    expect(toolNamesInHtml(html).sort()).toEqual(names("trust").sort());
    expect(html).not.toContain('name: "browse-tasks"');
  }, 30000);
});

describe("discovery surfaces derive from the registry", () => {
  it("webmcp.json fields match registry (name/group/version/writeClass)", async () => {
    const { buildDiscoveryJson } = await import("@agentbadge/webmcp");
    const doc = buildDiscoveryJson(toolsFor({ exposure: "webmcp" }));
    const byName = new Map(registry.map((r) => [r.name, r]));
    for (const t of doc.tools) {
      const entry = byName.get(t.name);
      expect(entry, `discovery drift: ${t.name}`).toBeTruthy();
      expect(t.group).toBe(entry!.group);
      expect(t.version).toBe(entry!.version);
      expect(t.writeClass).toBe(entry!.writeClass);
    }
    expect(doc.tools.map((t) => t.name)).not.toContain("passport-issue");
  });

  it("collectSources exposes the webmcp toolset (honest absence allowed)", () => {
    const src = collectSources();
    expect(src.webmcp?.tools.length).toBe(names("landing").length);
  });

  it("llms.txt webmcp section lists tools and inbox disclosure", () => {
    const src = collectSources();
    const section = webmcpSection(src);
    expect(section).toContain("document.modelContext");
    expect(section).toContain("submit-request");
    expect(section).toContain("unlisted");
    expect(section).toContain("hours to days");
    expect(section).toContain("publish_to_qa");
  });

  it("agent-card advertises webmcp honestly (registry-driven tool list)", () => {
    const card = JSON.parse(buildAgentCard(collectSources()));
    expect(card["x-agentbadge"].capabilities).toContain("webmcp");
    expect(card["x-agentbadge"].webmcp_tools).toEqual(
      expect.arrayContaining(names("landing")),
    );
    expect(card["x-agentbadge"].endpoints.webmcp_json).toContain("webmcp.json");
    const skillIds = card.skills.map((s: { id: string }) => s.id);
    expect(skillIds).toContain("webmcp-tools");
    // no a2a-messaging-as-tools / supply-chain claims in webmcp surface
    const json = JSON.stringify(card["x-agentbadge"].webmcp_tools);
    expect(json).not.toContain("supply-chain");
    expect(json).not.toContain("passport-issue");
  });
});
