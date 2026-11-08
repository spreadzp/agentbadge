import { describe, it, expect } from "vitest";
import { ReadinessPricingSection } from "../../src/views/landing/sections/readiness-pricing";
import { ReadinessThesisSection } from "../../src/views/landing/sections/readiness-thesis";
import { buildAgentCard } from "../../src/server/routes/well-known";
import { PageMeta } from "../../src/server/lib/page-meta";
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
