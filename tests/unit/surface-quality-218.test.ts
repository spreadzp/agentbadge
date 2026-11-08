import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ReadinessPricingSection } from "../../src/views/landing/sections/readiness-pricing";
import { ReadinessThesisSection } from "../../src/views/landing/sections/readiness-thesis";
import { buildAgentCard, buildSitemap } from "../../src/server/routes/well-known";
import { PageMeta, PUBLIC_PAGES } from "../../src/server/lib/page-meta";
import { BLOG_ARTICLES } from "../../src/server/lib/blog-data";
import { BUILD_DATE } from "../../src/server/lib/build-info";
import type { DiscoverySources } from "../../src/server/lib/agent-discovery";

/**
 * SLICE-218-3 guard tests (F5, F6, F12):
 * - no dead `href="#"` CTAs on public pages
 * - agent-card.json never serializes empty contract addresses
 * - all meta descriptions fit the 160-char SERP limit
 */

const SRC: DiscoverySources = {
  baseUrl: "https://agentbadge.xyz",
  authSection: "",
  llmsCore: "",
  articles: [],
  faqEntries: [],
  tiers: [],
  appRoutes: [],
};

describe("SLICE-218-3: no dead CTAs (F5)", () => {
  it("pricing section has no href=#", () => {
    expect(ReadinessPricingSection().toString()).not.toContain('href="#"');
  });

  it("thesis section has no href=# and hero CTA targets the scanner", () => {
    const html = ReadinessThesisSection().toString();
    expect(html).not.toContain('href="#"');
    expect(html).toContain('href="/services/scanner"');
  });
});

describe("SLICE-218-3: agent-card contracts omit empty values (F6)", () => {
  function card(contracts: Record<string, string>): {
    blockchain: {
      multi_chain: Record<string, { contracts?: Record<string, string> }>;
    };
  } {
    const src: DiscoverySources = {
      ...SRC,
      wellKnownEnv: {
        facilitatorUrl: "https://x402.example",
        hederaNetwork: "testnet",
        evmChainId: "5042",
        erc8004: { chainId: 5042, registry: "0x0", agentId: "1" },
        contracts,
      } as DiscoverySources["wellKnownEnv"],
    };
    const parsed = JSON.parse(buildAgentCard(src)) as Record<
      string,
      Record<string, never>
    >;
    return parsed["x-agentbadge"] as never;
  }

  it("configured addresses serialize", () => {
    const c = card({ trustRegistry: "0xabc", trustBadge: "", agentPassportBase: "", taskEscrow: "", taskMarketplaceAsc: "", taskState: "" });
    const base = c.blockchain.multi_chain.base_sepolia;
    expect(base.contracts).toEqual({ trust_registry: "0xabc" });
  });

  it("no contract key serializes an empty string anywhere", () => {
    const c = card({ trustRegistry: "", trustBadge: "", agentPassportBase: "", taskEscrow: "", taskMarketplaceAsc: "", taskState: "" });
    for (const chain of Object.values(c.blockchain.multi_chain)) {
      if (chain.contracts) {
        expect(Object.values(chain.contracts)).not.toContain("");
      }
    }
    // and the whole chain entry drops the contracts key
    expect(c.blockchain.multi_chain.creditcoin_testnet.contracts).toBeUndefined();
  });
});

describe("SLICE-218-3: meta descriptions ≤160 chars (F12)", () => {
  it("every PageMeta description fits SERP", () => {
    const offenders = Object.entries(PageMeta)
      .map(([path, meta]) => [path, meta.description?.length ?? 0] as const)
      .filter(([, len]) => len > 160);
    expect(offenders).toEqual([]);
  });
});

describe("SLICE-218-4: sitemap lastmod + off-topic pruning (F9, F10)", () => {
  const OFF_TOPIC = [
    "/medical-guide",
    "/hackathon/datahub",
    "/hackathon/webmcp",
    "/hackathon/attestcoin",
    "/hackathon/keeperhub",
    "/hackathon/fxdelta",
    "/hackathon/agent-allowance",
  ];

  it("blog article lastmod uses real dates, not BUILD_DATE", () => {
    const sitemap = buildSitemap();
    const blogBlocks = sitemap.match(
      /<loc>[^<]+\/blog\/[^<]+<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g,
    );
    expect(blogBlocks?.length).toBe(BLOG_ARTICLES.length);
    const lastmods = new Set(
      (blogBlocks ?? []).map((b) => b.match(/lastmod>([^<]+)/)![1]),
    );
    // F9: distinct real dates, not a single build stamp
    expect(lastmods.size).toBeGreaterThan(1);
    expect(lastmods.has(BUILD_DATE)).toBe(false);
  });

  it("off-topic paths absent from PUBLIC_PAGES, sitemap, footer and nav", () => {
    const sitemap = buildSitemap();
    for (const p of OFF_TOPIC) {
      expect(PUBLIC_PAGES.some((e) => e.path === p)).toBe(false);
      expect(sitemap).not.toContain(`>${`https://agentbadge.xyz${p}`}<`);
      expect(sitemap).not.toContain(`loc>https://agentbadge.xyz${p}<`);
    }
    const footer = readFileSync("src/views/footer.ts", "utf8");
    const nav = readFileSync("src/views/layout.ts", "utf8");
    for (const p of OFF_TOPIC) {
      expect(footer).not.toContain(`href="${p}"`);
      expect(nav).not.toContain(`href="${p}"`);
    }
    // ctc renders the attestcoin page — same off-topic surface
    expect(nav).not.toContain('href="/hackathon/ctc"');
  });
});
