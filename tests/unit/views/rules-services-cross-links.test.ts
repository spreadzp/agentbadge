import { describe, it, expect } from "vitest";
import { RulesCatalogPage } from "../../../src/views/rules-catalog-page";
import { RuleDetailPage, getRuleDescription } from "../../../src/views/rule-detail-page";
import { ServicesPage } from "../../../src/views/services-page";
import { ServicePageView } from "../../../src/views/service-page";
import type { AgencyService } from "../../../src/server/lib/agency-config";
import type { RegistryIndex } from "../../../src/server/registry/types";

describe("SLICE-113-6: Rules + Changelog + Services cross-links", () => {
  it("rules catalog has RelatedLinks with /faq, /agent-guide, /blog", () => {
    const html = RulesCatalogPage().toString();
    expect(html).toContain("Explore More");
    expect(html).toContain('href="/faq"');
    expect(html).toContain('href="/agent-guide"');
    expect(html).toContain('href="/blog"');
  });

  it("rule detail page has RelatedLinks with /rules, /agent-guide, /blog", () => {
    const rule = getRuleDescription("AB-001");
    if (rule) {
      const html = RuleDetailPage(rule).toString();
      expect(html).toContain("Explore More");
      expect(html).toContain('href="/rules"');
      expect(html).toContain('href="/agent-guide"');
      expect(html).toContain('href="/blog"');
    }
  });

  it("services hub has RelatedLinks with /about, /faq, /pricing, /work-with-us", () => {
    const mockRegistry = { services: [] } as unknown as RegistryIndex;
    const html = ServicesPage(mockRegistry).toString();
    expect(html).toContain("Explore More");
    expect(html).toContain('href="/about"');
    expect(html).toContain('href="/faq"');
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('href="/work-with-us"');
  });

  it("scanner service page has RelatedLinks to other services + /faq + /pricing", () => {
    const scanner: AgencyService = {
      id: "scanner",
      name: "Scanner",
      tagline: "Scan your API",
      description: "Agent readiness scanner",
      features: [],
      icon: "🔍",
      url: "/services/scanner",
    } as unknown as AgencyService;
    const html = ServicePageView(scanner, []).toString();
    expect(html).toContain("Explore More");
    expect(html).toContain('href="/services/passports"');
    expect(html).toContain('href="/services/marketplace"');
    expect(html).toContain('href="/faq"');
    expect(html).toContain('href="/pricing"');
  });
});
