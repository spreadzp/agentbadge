import { describe, it, expect } from "vitest";
import { ReadinessLandingPage } from "../../src/views/landing/readiness-landing-page";
import { FaqPage } from "../../src/views/faq-page";
import { AboutPage } from "../../src/views/about-page";
import { PricingPage } from "../../src/views/pricing-page";
import { UseCasesPage } from "../../src/views/use-cases-page";
import { RulesCatalogPage } from "../../src/views/rules-catalog-page";
import { RuleDetailPage, getRuleDescription } from "../../src/views/rule-detail-page";
import { ServicesPage } from "../../src/views/services-page";
import { ServicePageView } from "../../src/views/service-page";
import { BlogArticlePage } from "../../src/views/blog-article";
import { BlogListPage } from "../../src/views/blog-list";
import { BLOG_ARTICLES, getRelatedArticles, getTagCounts, filterByTag, paginateArticles } from "../../src/server/lib/blog-data";
import { buildLinkGraph } from "../../src/server/lib/link-graph";
import type { AgencyService } from "../../src/server/lib/agency-config";
import type { RegistryIndex } from "../../src/server/registry/types";

function assertLinkExists(html: string, href: string): void {
  expect(html).toContain(`href="${href}"`);
}

describe("SLICE-113-8: Internal linking E2E", () => {
  describe("Blog article related articles", () => {
    const article = BLOG_ARTICLES[0];
    const related = getRelatedArticles(article, BLOG_ARTICLES);
    const html = BlogArticlePage(article, related).toString();

    it("Related Articles section exists with >=1 link", () => {
      expect(html).toContain("Related Articles");
      expect(related.length).toBeGreaterThan(0);
    });
  });

  describe("Blog article clickable tags", () => {
    const article = BLOG_ARTICLES[0];
    const html = BlogArticlePage(article).toString();

    it("tags are <a> tags with href=/blog?tag=xxx", () => {
      expect(html).toContain('href="/blog?tag=');
    });
  });

  describe("Blog article contextual links", () => {
    const article = BLOG_ARTICLES.find((a) => a.relatedLinks && a.relatedLinks.length > 0)!;
    const html = BlogArticlePage(article).toString();

    it("Learn More section exists when relatedLinks present", () => {
      expect(html).toContain("Learn More");
    });
  });

  describe("Blog tag filtering", () => {
    const tagCounts = getTagCounts(BLOG_ARTICLES);
    const firstTag = tagCounts[0].tag;
    const filtered = filterByTag(BLOG_ARTICLES, firstTag);
    const { items, meta } = paginateArticles(filtered, 1);
    const html = BlogListPage(items, meta, { tagCounts, activeTag: firstTag }).toString();

    it("only articles with tag are shown", () => {
      expect(items.every((a) => a.tags.includes(firstTag))).toBe(true);
    });

    it("TagFilterBar shows, active tag highlighted", () => {
      expect(html).toContain(firstTag);
      expect(html).toContain("bg-emerald-500");
    });

    it("Clear filter link present, points to /blog", () => {
      expect(html).toContain("Clear filter");
      expect(html).toContain('href="/blog"');
    });
  });

  describe("Homepage cross-links", () => {
    const html = ReadinessLandingPage().toString();

    it("body contains links to /blog, /faq, /use-cases", () => {
      assertLinkExists(html, "/blog");
      assertLinkExists(html, "/faq");
      assertLinkExists(html, "/use-cases");
    });
  });

  describe("FAQ cross-links", () => {
    const html = FaqPage().toString();

    it("RelatedLinks section with /about, /pricing, /use-cases, /blog", () => {
      assertLinkExists(html, "/about");
      assertLinkExists(html, "/pricing");
      assertLinkExists(html, "/use-cases");
      assertLinkExists(html, "/blog");
    });
  });

  describe("About cross-links", () => {
    const html = AboutPage().toString();

    it("RelatedLinks section with /blog, /faq, /pricing, /services", () => {
      assertLinkExists(html, "/blog");
      assertLinkExists(html, "/faq");
      assertLinkExists(html, "/pricing");
      assertLinkExists(html, "/services");
    });
  });

  describe("Pricing cross-links", () => {
    const html = PricingPage().toString();

    it("RelatedLinks section with /faq, /about, /services, /agent-guide", () => {
      assertLinkExists(html, "/faq");
      assertLinkExists(html, "/about");
      assertLinkExists(html, "/services");
      assertLinkExists(html, "/agent-guide");
    });
  });

  describe("Use-cases cross-links", () => {
    const html = UseCasesPage().toString();

    it("RelatedLinks section with /services, /faq, /blog, /agent-guide", () => {
      assertLinkExists(html, "/services");
      assertLinkExists(html, "/faq");
      assertLinkExists(html, "/blog");
      assertLinkExists(html, "/agent-guide");
    });
  });

  describe("Rules cross-links", () => {
    const html = RulesCatalogPage().toString();

    it("RelatedLinks section with /faq, /agent-guide, /blog", () => {
      assertLinkExists(html, "/faq");
      assertLinkExists(html, "/agent-guide");
      assertLinkExists(html, "/blog");
    });
  });

  describe("Rule detail cross-links", () => {
    const rule = getRuleDescription("AB-001");
    const html = rule ? RuleDetailPage(rule).toString() : "";

    it("RelatedLinks section with /rules, /agent-guide, /blog", () => {
      if (rule) {
        assertLinkExists(html, "/rules");
        assertLinkExists(html, "/agent-guide");
        assertLinkExists(html, "/blog");
      }
    });
  });

  describe("Changelog cross-links", () => {
    it("RelatedLinks section with /blog, /agent-guide", () => {
      // Changelog route renders inline, test via buildLinkGraph
      const graph = buildLinkGraph();
      const changelogEdges = graph.edges.filter((e) => e.from === "/changelog");
      const targets = changelogEdges.map((e) => e.to);
      expect(targets).toContain("/blog");
      expect(targets).toContain("/agent-guide");
    });
  });

  describe("Services hub cross-links", () => {
    const mockRegistry = { services: [] } as unknown as RegistryIndex;
    const html = ServicesPage(mockRegistry).toString();

    it("RelatedLinks section with /about, /faq, /pricing, /work-with-us", () => {
      assertLinkExists(html, "/about");
      assertLinkExists(html, "/faq");
      assertLinkExists(html, "/pricing");
      assertLinkExists(html, "/work-with-us");
    });
  });

  describe("Service page cross-links", () => {
    const scanner = {
      id: "scanner",
      name: "Scanner",
      tagline: "Scan your API",
      description: "Agent readiness scanner",
      features: [],
      icon: "🔍",
      url: "/services/scanner",
    } as unknown as AgencyService;
    const html = ServicePageView(scanner, []).toString();

    it("RelatedLinks with links to other services + /faq + /pricing", () => {
      assertLinkExists(html, "/services/passports");
      assertLinkExists(html, "/services/marketplace");
      assertLinkExists(html, "/faq");
      assertLinkExists(html, "/pricing");
    });
  });

  describe("Link graph endpoint", () => {
    const graph = buildLinkGraph();

    it("valid JSON with nodes and edges", () => {
      expect(graph.nodes).toBeDefined();
      expect(graph.edges).toBeDefined();
      expect(Array.isArray(graph.nodes)).toBe(true);
      expect(Array.isArray(graph.edges)).toBe(true);
      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.edges.length).toBeGreaterThan(0);
    });

    it("contains nodes for /, /blog, /faq, /about, /pricing", () => {
      const urls = graph.nodes.map((n) => n.url);
      expect(urls).toContain("/");
      expect(urls).toContain("/blog");
      expect(urls).toContain("/faq");
      expect(urls).toContain("/about");
      expect(urls).toContain("/pricing");
    });

    it("contains related relationship edges", () => {
      const relatedEdges = graph.edges.filter((e) => e.relationship === "related");
      expect(relatedEdges.length).toBeGreaterThan(0);
    });
  });
});
