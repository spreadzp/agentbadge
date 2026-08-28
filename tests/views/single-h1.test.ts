import { describe, it, expect, vi } from "vitest";

// Mock env config so json-ld.ts chainCurrency works
vi.mock("../../src/config/env.js", () => ({
  getConfig: vi.fn(() => ({
    chainMode: "hedera",
    hederaNetwork: "testnet",
    ui: {
      currencySymbol: "HBAR",
      currencyDecimals: 8,
      explorerName: "HashScan",
      explorerUrl: "https://hashscan.io/testnet",
      chainDisplayName: "Hedera Testnet",
      chainBadgeColor: "purple",
    },
  })),
  resetConfigCache: vi.fn(),
}));

// Mock chain-templates so json-ld.ts chainVars works
vi.mock("../../src/server/lib/chain-templates.js", () => ({
  applyChainTemplates: vi.fn((s: string) => s),
  getChainTemplateVars: vi.fn(() => ({
    CHAIN_NAME: "Hedera Testnet",
    CURRENCY: "HBAR",
    EXPLORER: "HashScan",
    EXPLORER_URL: "https://hashscan.io/testnet",
    MIRROR_NODE: "Mirror Node",
    NFT_STANDARD: "HTS",
    CONSENSUS: "HCS",
  })),
}));

import { Layout } from "../../src/views/layout";
import { LandingLayout } from "../../src/views/landing/layout";
import { FaqPage } from "../../src/views/faq-page";
import { AboutPage } from "../../src/views/about-page";
import { PricingPage } from "../../src/views/pricing-page";
import { TermsPage } from "../../src/views/terms-page";
import { PrivacyPage } from "../../src/views/privacy-page";
import { UseCasesPage } from "../../src/views/use-cases-page";
import { contactPage } from "../../src/views/contact-page";
import { ServicesPage } from "../../src/views/services-page";
import { WorkWithUsPage } from "../../src/views/work-with-us-page";
import { TeamPage } from "../../src/views/team-page";
import { Dashboard } from "../../src/views/dashboard";
import { BlogListPage } from "../../src/views/blog-list";
import { RulesCatalogPage } from "../../src/views/rules-catalog-page";
import { PageMeta } from "../../src/server/lib/page-meta";
import type { RegistryIndex } from "../../src/server/registry/types";

const mockRegistry: RegistryIndex = {
  schema_version: "1.0",
  categories: [],
  skills: [],
  capabilities: [],
  services: [],
  people: [],
  warnings: [],
};

function countH1(html: string): number {
  return (html.match(/<h1[\s>]/gi) ?? []).length;
}

function wrapInLayout(content: string, title?: string): string {
  return Layout(content, title ?? "Test Page").toString();
}

describe("SLICE-80-3: Single H1 per page", () => {
  const pages: { name: string; html: string }[] = [
    { name: "/faq", html: wrapInLayout(FaqPage().toString(), PageMeta["/faq"].title) },
    { name: "/about", html: wrapInLayout(AboutPage().toString(), PageMeta["/about"].title) },
    { name: "/pricing", html: wrapInLayout(PricingPage().toString(), PageMeta["/pricing"].title) },
    { name: "/terms", html: wrapInLayout(TermsPage().toString(), PageMeta["/terms"].title) },
    { name: "/privacy", html: wrapInLayout(PrivacyPage().toString(), PageMeta["/privacy"].title) },
    { name: "/use-cases", html: wrapInLayout(UseCasesPage().toString(), PageMeta["/use-cases"].title) },
    { name: "/contact", html: wrapInLayout(contactPage().toString(), PageMeta["/contact"].title) },
    { name: "/services", html: wrapInLayout(ServicesPage(mockRegistry).toString(), "Services") },
    { name: "/work-with-us", html: wrapInLayout(WorkWithUsPage(mockRegistry).toString(), "Work With Us") },
    { name: "/team", html: wrapInLayout(TeamPage(mockRegistry).toString(), "Team") },
    { name: "/dashboard", html: wrapInLayout(Dashboard().toString(), PageMeta["/dashboard"].title) },
    { name: "/blog", html: wrapInLayout(BlogListPage([], { currentPage: 1, totalPages: 0, totalArticles: 0, hasNext: false, hasPrev: false }).toString(), PageMeta["/blog"].title) },
    { name: "/rules", html: wrapInLayout(RulesCatalogPage().toString(), "Rules Catalog") },
  ];

  for (const page of pages) {
    it(`${page.name} renders exactly one <h1>`, () => {
      const count = countH1(page.html);
      expect(count, `${page.name} has ${count} <h1> tags (expected 1)`).toBe(1);
    });
  }

  it("Layout noscript fallback does NOT use <h1>", () => {
    const html = Layout("<p>test</p>", "Test").toString();
    const noscriptMatch = html.match(/<noscript>[\s\S]*?<\/noscript>/i);
    expect(noscriptMatch).not.toBeNull();
    const noscriptH1Count = countH1(noscriptMatch![0]);
    expect(noscriptH1Count, "noscript block should not contain <h1>").toBe(0);
  });

  it("LandingLayout noscript fallback does NOT use <h1>", () => {
    const html = LandingLayout("<p>test</p>", "Test").toString();
    const noscriptMatch = html.match(/<noscript>[\s\S]*?<\/noscript>/i);
    expect(noscriptMatch).not.toBeNull();
    const noscriptH1Count = countH1(noscriptMatch![0]);
    expect(noscriptH1Count, "noscript block should not contain <h1>").toBe(0);
  });
});
