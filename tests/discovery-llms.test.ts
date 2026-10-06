/**
 * SLICE-178-1: Discovery generator + llms.txt/llms-full.txt
 *
 * Contracts:
 * - buildLlmsTxt/buildLlmsFullTxt are pure (sources injected, zero IO)
 * - llmstxt.org structure: H1 + blockquote + ## sections + absolute URLs
 * - Drift: new public route in sources.appRoutes appears in output
 * - SKU section degrades when EPIC-179 catalog absent
 * - GET /llms.txt: 200, text/plain, Cache-Control max-age<=300
 */

import { describe, it, expect } from "vitest";
import {
  buildLlmsTxt,
  buildLlmsFullTxt,
  generateAll,
  MANIFEST_REGISTRY,
  type DiscoverySources,
} from "../src/server/lib/agent-discovery";
import { createDiscoveryRoutes } from "../src/server/routes/discovery";

function mockSources(overrides: Partial<DiscoverySources> = {}): DiscoverySources {
  return {
    baseUrl: "https://agentbadge.xyz",
    authSection: "## DID Signature Authentication\n\n...challenge...\n",
    llmsCore:
      "# AgentBadge\n\n> Agent identity, discovery, and micropayments on Arc.\n\n## Quick Start\n\n- [Get a passport](https://agentbadge.xyz/passport/request)\n",
    articles: [
      {
        slug: "test-article",
        title: "Test Article",
        description: "A test article description.",
        date: "2026-10-01",
        readingTime: "5 min",
      } as DiscoverySources["articles"][number],
    ],
    faqEntries: [{ question: "Q1?", answer: "A1" }],
    tiers: [],
    appRoutes: ["GET /api/v1/services", "GET /.well-known/agent-card.json"],
    skus: [],
    ...overrides,
  };
}

describe("buildLlmsTxt (pure)", () => {
  it("produces llmstxt.org structure: H1 + blockquote + ## sections", () => {
    const txt = buildLlmsTxt(mockSources());
    const firstNonEmpty = txt.split("\n").find((l) => l.trim().length > 0)!;
    expect(firstNonEmpty.startsWith("# ")).toBe(true);
    expect(txt).toMatch(/^> /m); // blockquote
    expect(txt).toMatch(/^## /m); // at least one section
    expect(txt).toContain("https://agentbadge.xyz"); // absolute URLs
  });

  it("is deterministic — identical output on repeated calls", () => {
    const a = buildLlmsTxt(mockSources());
    const b = buildLlmsTxt(mockSources());
    expect(a).toBe(b);
  });

  it("drift: new public route in sources appears in output", () => {
    const without = buildLlmsTxt(mockSources());
    const with_ = buildLlmsTxt(
      mockSources({ appRoutes: ["GET /api/v1/services", "GET /.well-known/agent-card.json", "GET /api/new-public-endpoint"] }),
    );
    expect(with_).toContain("/api/new-public-endpoint");
    expect(with_).not.toBe(without);
  });

  it("SKU section degrades when service catalog absent; present when injected", () => {
    const noSku = buildLlmsTxt(mockSources({ skus: [] }));
    expect(noSku).not.toContain("## Paid Services");
    const withSku = buildLlmsTxt(
      mockSources({
        skus: [
          { id: "scan:full", name: "Full Scan", endpoint: "/api/scan", priceUsd: "0.05", description: "Full readiness scan" },
        ],
      }),
    );
    expect(withSku).toContain("## Paid Services");
    expect(withSku).toContain("scan:full");
  });
});

describe("buildLlmsFullTxt (pure)", () => {
  it("includes blog articles and FAQ from sources", () => {
    const full = buildLlmsFullTxt(mockSources());
    expect(full).toContain("Test Article");
    expect(full).toContain("/blog/test-article");
    expect(full).toContain("Q1?");
    expect(full).toContain("https://agentbadge.xyz");
  });
});

describe("MANIFEST_REGISTRY + generateAll", () => {
  it("registers /llms.txt and /llms-full.txt with text/plain", () => {
    const paths = MANIFEST_REGISTRY.map((m) => m.path);
    expect(paths).toContain("/llms.txt");
    expect(paths).toContain("/llms-full.txt");
    for (const m of MANIFEST_REGISTRY) {
      expect(m.contentType).toContain("text/plain");
    }
  });

  it("generateAll returns a manifest per registry entry", () => {
    const out = generateAll(mockSources());
    expect(out.get("/llms.txt")!.body).toBe(buildLlmsTxt(mockSources()));
    expect(out.get("/llms-full.txt")!.body).toBe(buildLlmsFullTxt(mockSources()));
  });
});

describe("routes/discovery.ts", () => {
  it("GET /llms.txt → 200 text/plain, Cache-Control max-age<=300", async () => {
    const routes = createDiscoveryRoutes(() => mockSources());
    const res = await routes.request("/llms.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const cc = res.headers.get("cache-control") ?? "";
    const maxAge = Number(/max-age=(\d+)/.exec(cc)?.[1] ?? Infinity);
    expect(maxAge).toBeLessThanOrEqual(300);
    const body = await res.text();
    expect(body.split("\n").find((l) => l.trim())!).toMatch(/^# /);
  });

  it("GET /llms-full.txt → 200 text/plain", async () => {
    const routes = createDiscoveryRoutes(() => mockSources());
    const res = await routes.request("/llms-full.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
  });

  it("DISCOVERY_LIVE=1 rebuilds manifests per request", async () => {
    process.env.DISCOVERY_LIVE = "1";
    let counter = 0;
    const routes = createDiscoveryRoutes(() => {
      counter++;
      return mockSources({ appRoutes: [`GET /api/dyn-${counter}`] });
    });
    const r1 = await routes.request("/llms.txt");
    const r2 = await routes.request("/llms.txt");
    expect(await r1.text()).toContain("/api/dyn-1");
    expect(await r2.text()).toContain("/api/dyn-2");
    delete process.env.DISCOVERY_LIVE;
  });
});
