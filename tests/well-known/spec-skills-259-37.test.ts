import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { createHash } from "node:crypto";
import { setupMockEnv } from "../e2e/helpers";
import { wireOpenApi, PUBLIC_SPEC_EXCLUDE } from "../../src/server/wiring/ops";
import { wellKnownRoutes } from "../../src/server/routes/well-known";
import { createDiscoveryRoutes } from "../../src/server/routes/discovery/discovery";
import { setMirrorApp } from "../../src/server/middleware/markdown-negotiation-helpers";
import type { DiscoverySources } from "../../src/server/lib/agent-discovery";

setupMockEnv();

const TEST_SOURCES: DiscoverySources = {
  baseUrl: "https://staging.agentbadge.xyz",
  authSection: "",
  articles: [],
  faqEntries: [],
  tiers: [],
  appRoutes: [],
  wellKnownEnv: {
    facilitatorUrl: "https://facilitator.payai.network",
    hederaNetwork: "testnet",
    evmChainId: "5042",
    erc8004: {
      chainId: 5042,
      registry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
      agentId: "0",
    },
  },
};

// SLICE-259-37: DeepSeek round2 found /api/specs enumerated ~58 internal
// admin/debug paths (attack-map leak) and served no ETag on the ~270KB
// document. The spec must carry only the public callable contract, and
// agent revalidation must be a cheap 304.
describe("SLICE-259-37: OpenAPI spec hardening", () => {
  const doc = () =>
    describeRoute({ responses: { 200: { description: "ok" } } });
  function specApp() {
    const app = new Hono();
    app.get("/api/scan", doc(), (c) => c.json({ ok: true }));
    app.get("/admin/users", doc(), (c) => c.json({ secret: true }));
    app.get("/api/admin/flags", doc(), (c) => c.json({ secret: true }));
    app.get("/a2a/ext/debug/tasks", doc(), (c) => c.json({ debug: true }));
    app.get("/metrics", doc(), (c) => c.text("metrics"));
    wireOpenApi(app);
    return app;
  }

  it("/api/specs excludes admin/debug/internal paths", async () => {
    const res = await specApp().request("/api/specs");
    expect(res.status).toBe(200);
    const spec = await res.json();
    const paths = Object.keys(spec.paths ?? {});
    expect(paths).toContain("/api/scan");
    for (const p of paths) {
      expect(p).not.toMatch(/admin|debug|metrics|\/ui\//i);
    }
  });

  it("/api/specs serves weak ETag and answers 304 on revalidation", async () => {
    const app = specApp();
    const res = await app.request("/api/specs");
    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^W\/"[0-9a-f]{16}"$/);
    const again = await app.request("/api/specs", {
      headers: { "If-None-Match": etag! },
    });
    expect(again.status).toBe(304);
  });

  // SLICE-259-38 (DeepSeek R3 §6): the exclusion list is a CI invariant —
  // every future admin/debug route shape must match a pattern here, or the
  // public spec regresses into an attack-map leak.
  it("PUBLIC_SPEC_EXCLUDE covers representative internal route shapes", () => {
    const internalPaths = [
      "/admin", "/admin/users", "/admin/flags/new",
      "/api/admin", "/api/admin/stats",
      "/api/v1/admin/audit", "/api/v2/admin/flags",
      "/a2a/ext/debug/tasks", "/a2a/ext/debug",
      "/market/v/us/admin",
      "/api/venue/instances/inst-42/admin",
      "/metrics", "/api/telemetry", "/ui", "/ui/debug/console",
      "/docs", "/api/specs", "/openapi.json", "/openapi.yaml", "/swagger.json",
    ];
    const excluded = (p: string) =>
      PUBLIC_SPEC_EXCLUDE.some((e) =>
        typeof e === "string" ? e === p : e.test(p),
      );
    for (const p of internalPaths) {
      expect(excluded(p), `expected ${p} to be excluded`).toBe(true);
    }
    // Public paths must NOT be excluded.
    for (const p of ["/api/scan", "/api/requests", "/mcp", "/agents"]) {
      expect(excluded(p), `expected ${p} to stay public`).toBe(false);
    }
  });

  it("/openapi.yaml serves yaml + ETag + 304", async () => {
    const app = specApp();
    const res = await app.request("/openapi.yaml");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/yaml");
    const etag = res.headers.get("etag");
    expect(etag).toBeTruthy();
    const again = await app.request("/openapi.yaml", {
      headers: { "If-None-Match": etag! },
    });
    expect(again.status).toBe(304);
  });
});

// SLICE-259-37: the skills index advertised all-zero sha256 placeholders.
// Hashes must attest the canonical bytes an agent actually fetches.
describe("SLICE-259-37: agent-skills index real sha256", () => {
  const SKILL_BODY = "# skill body v1\n";
  const CARD_BODY = JSON.stringify({ card: true });
  const GUIDE_BODY = "# marketplace guide\n";

  it("hashes match the bytes served at the declared artifacts", async () => {
    const stub = new Hono();
    stub.get("/skill.md", (c) => c.text(SKILL_BODY));
    stub.get("/.well-known/agent-card.json", (c) => c.body(CARD_BODY));
    stub.get("/marketplace-guide", (c) => c.text(GUIDE_BODY));
    setMirrorApp(stub);

    const app = new Hono();
    app.route("/", createDiscoveryRoutes(() => TEST_SOURCES));
    app.route("/", wellKnownRoutes);

    const res = await app.request("/.well-known/agent-skills/index.json");
    expect(res.status).toBe(200);
    const body = await res.json();
    const skills = body.skills;
    expect(skills.length).toBeGreaterThanOrEqual(3);
    const sha = (s: string) => createHash("sha256").update(s).digest("hex");
    const expected = new Map([
      ["/skill.md", sha(SKILL_BODY)],
      ["/.well-known/agent-card.json", sha(CARD_BODY)],
      ["/marketplace-guide", sha(GUIDE_BODY)],
    ]);
    let attested = 0;
    for (const skill of skills as Array<{ sha256?: string; url: string }>) {
      expect(skill.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(skill.sha256).not.toBe("0".repeat(64));
      const path = skill.url.replace(/^https?:\/\/[^/]+/, "");
      expect(skill.sha256).toBe(expected.get(path));
      attested++;
    }
    expect(attested).toBe(3);
  });
});
