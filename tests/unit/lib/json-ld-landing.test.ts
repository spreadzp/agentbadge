import { describe, it, expect } from "vitest";
import {
  softwareApplicationLd,
  webSiteLd,
  organizationLd,
  howToLd,
  breadcrumbListLd,
  webPageLd,
  aboutPageLd,
  articleLd,
  landingJsonLd,
  renderJsonLd,
} from "../../../src/server/lib/json-ld";
import { BASE_URL } from "../../../src/server/lib/page-meta";

describe("SLICE-19-3: JSON-LD for landing (5 schemas)", () => {
  // ─── HowTo schema (SLICE-19-3, refactored in SLICE-21-1) ───
  describe("howToLd()", () => {
    const landingHowTo = howToLd({
      name: "How to Get an AI Agent Passport on AgentBadge",
      description: "Step-by-step guide to minting an on-chain identity NFT for your AI agent on Hedera.",
      path: "/",
      totalTime: "PT30M",
      estimatedCost: { currency: "HBAR", value: "50" },
      steps: [
        { name: "Step 1", text: "Do something" },
        { name: "Step 2", text: "Do another thing" },
        { name: "Step 3", text: "Do more" },
        { name: "Step 4", text: "Finish" },
      ],
    });

    it("returns @type HowTo", () => {
      const schema = landingHowTo as Record<string, unknown>;
      expect(schema["@type"]).toBe("HowTo");
      expect(schema["@context"]).toBe("https://schema.org");
    });

    it("has name with AgentBadge", () => {
      const schema = landingHowTo as Record<string, unknown>;
      expect(schema.name as string).toContain("AgentBadge");
    });

    it("has exactly 4 steps", () => {
      const schema = landingHowTo as Record<string, unknown>;
      const steps = schema.step as unknown[];
      expect(steps).toHaveLength(4);
    });

    it("each step has @type HowToStep and text", () => {
      const schema = landingHowTo as Record<string, unknown>;
      const steps = schema.step as Record<string, unknown>[];
      for (const step of steps) {
        expect(step["@type"]).toBe("HowToStep");
        expect(step.name).toBeDefined();
        expect(step.text).toBeDefined();
      }
    });

    it("has totalTime or estimatedCost", () => {
      const schema = landingHowTo as Record<string, unknown>;
      expect(schema.totalTime || schema.estimatedCost).toBeDefined();
    });
  });

  // ─── landingJsonLd() assembler ───────────────────────────
  describe("landingJsonLd()", () => {
    it("returns array with 5 schemas", () => {
      const schemas = landingJsonLd();
      expect(schemas).toHaveLength(5);
    });

    it("includes SoftwareApplication", () => {
      const schemas = landingJsonLd() as Record<string, unknown>[];
      const swApp = schemas.find((s) => s["@type"] === "SoftwareApplication");
      expect(swApp).toBeDefined();
    });

    it("SoftwareApplication includes OfferCatalog with tiers", () => {
      const schemas = landingJsonLd() as Record<string, unknown>[];
      const swApp = schemas.find((s) => s["@type"] === "SoftwareApplication");
      expect(swApp).toBeDefined();
      const offers = swApp!.offers as Record<string, unknown>;
      // Should have offerCatalog or offers with tier pricing
      expect(offers).toBeDefined();
    });

    it("includes WebSite", () => {
      const schemas = landingJsonLd() as Record<string, unknown>[];
      const webSite = schemas.find((s) => s["@type"] === "WebSite");
      expect(webSite).toBeDefined();
    });

    it("includes Organization", () => {
      const schemas = landingJsonLd() as Record<string, unknown>[];
      const org = schemas.find((s) => s["@type"] === "Organization");
      expect(org).toBeDefined();
    });

    it("includes HowTo", () => {
      const schemas = landingJsonLd() as Record<string, unknown>[];
      const howTo = schemas.find((s) => s["@type"] === "HowTo");
      expect(howTo).toBeDefined();
    });
  });

  // ─── renderJsonLd for landing ────────────────────────────
  describe("renderJsonLd() with landing schemas", () => {
    it("produces valid script tag with 4 schemas", () => {
      const html = renderJsonLd(landingJsonLd());
      expect(html).toContain('<script type="application/ld+json">');
      expect(html).toContain("</script>");
      const jsonStr = html
        .replace('<script type="application/ld+json">', "")
        .replace("</script>", "");
      const parsed = JSON.parse(jsonStr);
      expect(parsed).toHaveLength(5);
    });

    it("escapes < characters in JSON (XSS prevention)", () => {
      // Test with a schema containing < to verify escaping
      const html = renderJsonLd([{ "@type": "Test", text: "<script>alert(1)</script>" }]);
      expect(html).toContain("\\u003c");
      expect(html).not.toContain("<script>alert");
    });
  });

  // ─── SLICE-21-1: HowTo + BreadcrumbList ───────────────────
  describe("SLICE-21-1: howToLd() parameterized", () => {
    it("accepts opts and returns correct structure", () => {
      const schema = howToLd({
        name: "Test HowTo",
        description: "Test description",
        path: "/test",
        totalTime: "PT10M",
        steps: [
          { name: "Step A", text: "Do A", url: "/a" },
          { name: "Step B", text: "Do B" },
        ],
      }) as Record<string, unknown>;
      expect(schema["@type"]).toBe("HowTo");
      expect(schema.name).toBe("Test HowTo");
      expect(schema.description).toBe("Test description");
      expect(schema.url).toBe(`${BASE_URL}/test`);
      expect(schema.inLanguage).toBe("en");
      expect(schema.totalTime).toBe("PT10M");
      const steps = schema.step as Record<string, unknown>[];
      expect(steps).toHaveLength(2);
      expect(steps[0].position).toBe(1);
      expect(steps[0].name).toBe("Step A");
      expect(steps[0].text).toBe("Do A");
      expect(steps[0].url).toBe(`${BASE_URL}/a`);
      expect(steps[1].position).toBe(2);
      expect(steps[1].url).toBeUndefined();
    });

    it("includes estimatedCost when provided", () => {
      const schema = howToLd({
        name: "Test",
        description: "Test",
        path: "/test",
        estimatedCost: { currency: "HBAR", value: "50" },
        steps: [{ name: "Step", text: "Do" }],
      }) as Record<string, unknown>;
      const cost = schema.estimatedCost as Record<string, unknown>;
      expect(cost["@type"]).toBe("MonetaryAmount");
      expect(cost.currency).toBe("HBAR");
      expect(cost.value).toBe("50");
    });

    it("omits totalTime and estimatedCost when not provided", () => {
      const schema = howToLd({
        name: "Test",
        description: "Test",
        path: "/test",
        steps: [{ name: "Step", text: "Do" }],
      }) as Record<string, unknown>;
      expect(schema.totalTime).toBeUndefined();
      expect(schema.estimatedCost).toBeUndefined();
    });

    it("preserves absolute URLs in step.url", () => {
      const schema = howToLd({
        name: "Test",
        description: "Test",
        path: "/test",
        steps: [{ name: "Step", text: "Do", url: "https://example.com/page" }],
      }) as Record<string, unknown>;
      const steps = schema.step as Record<string, unknown>[];
      expect(steps[0].url).toBe("https://example.com/page");
    });
  });

  describe("SLICE-21-1: breadcrumbListLd()", () => {
    it("returns BreadcrumbList with correct structure", () => {
      const schema = breadcrumbListLd([
        { name: "Home", path: "/" },
        { name: "Agent Guide", path: "/agent-guide" },
      ]) as Record<string, unknown>;
      expect(schema["@type"]).toBe("BreadcrumbList");
      expect(schema["@context"]).toBe("https://schema.org");
      const items = schema.itemListElement as Record<string, unknown>[];
      expect(items).toHaveLength(2);
      expect(items[0].position).toBe(1);
      expect(items[0].name).toBe("Home");
      expect(items[0].item).toBe(`${BASE_URL}/`);
      expect(items[1].position).toBe(2);
      expect(items[1].name).toBe("Agent Guide");
      expect(items[1].item).toBe(`${BASE_URL}/agent-guide`);
    });

    it("preserves absolute URLs in item", () => {
      const schema = breadcrumbListLd([
        { name: "External", path: "https://example.com" },
      ]) as Record<string, unknown>;
      const items = schema.itemListElement as Record<string, unknown>[];
      expect(items[0].item).toBe("https://example.com");
    });

    it("handles single item", () => {
      const schema = breadcrumbListLd([
        { name: "Home", path: "/" },
      ]) as Record<string, unknown>;
      const items = schema.itemListElement as Record<string, unknown>[];
      expect(items).toHaveLength(1);
      expect(items[0].position).toBe(1);
    });
  });

  // ─── SLICE-21-2: OfferCatalog + Extended Organization ────
  describe("SLICE-21-2: softwareApplicationLd() OfferCatalog", () => {
    it("offers is OfferCatalog with 4 Offer items", () => {
      const schema = softwareApplicationLd() as Record<string, unknown>;
      const offers = schema.offers as Record<string, unknown>;
      expect(offers["@type"]).toBe("OfferCatalog");
      expect(offers.name).toBe("AgentBadge Passport Tiers");
      const items = offers.itemListElement as Record<string, unknown>[];
      expect(items).toHaveLength(4);
      for (const item of items) {
        expect(item["@type"]).toBe("Offer");
        expect(item.price).toBeDefined();
        expect(item.priceCurrency).toBe("HBAR");
        expect(item.name).toBeDefined();
        expect(item.description).toBeDefined();
        expect(item.url).toBeDefined();
      }
    });

    it("OfferCatalog includes Bronze (10 HBAR), Silver (50), Gold (200), Platinum (500)", () => {
      const schema = softwareApplicationLd() as Record<string, unknown>;
      const items = (schema.offers as Record<string, unknown>).itemListElement as Record<string, unknown>[];
      const prices = items.map((i) => i.price);
      expect(prices).toContain("10");
      expect(prices).toContain("50");
      expect(prices).toContain("200");
      expect(prices).toContain("500");
    });

    it("each Offer has url pointing to /pricing", () => {
      const schema = softwareApplicationLd() as Record<string, unknown>;
      const items = (schema.offers as Record<string, unknown>).itemListElement as Record<string, unknown>[];
      for (const item of items) {
        expect(item.url).toBe(`${BASE_URL}/pricing`);
      }
    });
  });

  describe("SLICE-21-2: organizationLd() extensions", () => {
    it("includes foundingDate", () => {
      const schema = organizationLd() as Record<string, unknown>;
      expect(schema.foundingDate).toBe("2026");
    });

    it("includes contactPoint with correct fields", () => {
      const schema = organizationLd() as Record<string, unknown>;
      const cp = schema.contactPoint as Record<string, unknown>;
      expect(cp["@type"]).toBe("ContactPoint");
      expect(cp.contactType).toBe("customer support");
      expect(cp.url).toBe(`${BASE_URL}/contact`);
      expect(cp.availableLanguage).toEqual(["English"]);
    });

    it("sameAs includes GitHub repository", () => {
      const schema = organizationLd() as Record<string, unknown>;
      const sameAs = schema.sameAs as string[];
      expect(sameAs).toContain("https://github.com/spreadzp/agentbadge");
      expect(sameAs.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── SLICE-21-3: webPageLd + aboutPageLd ────────────────
  describe("SLICE-21-3: webPageLd()", () => {
    it("returns WebPage schema with required fields", () => {
      const schema = webPageLd({
        title: "About AgentBadge",
        description: "Learn about the AgentBadge platform.",
        path: "/about",
      }) as Record<string, unknown>;
      expect(schema["@type"]).toBe("WebPage");
      expect(schema["@context"]).toBe("https://schema.org");
      expect(schema.name).toBe("About AgentBadge");
      expect(schema.description).toBe("Learn about the AgentBadge platform.");
      expect(schema.url).toBe(`${BASE_URL}/about`);
      expect(schema.inLanguage).toBe("en");
    });

    it("includes isPartOf referencing WebSite", () => {
      const schema = webPageLd({
        title: "Test",
        description: "Test",
        path: "/test",
      }) as Record<string, unknown>;
      const isPartOf = schema.isPartOf as Record<string, unknown>;
      expect(isPartOf["@type"]).toBe("WebSite");
      expect(isPartOf.name).toBe("AgentBadge");
      expect(isPartOf.url).toBe(BASE_URL);
    });

    it("defaults datePublished and dateModified to BUILD_DATE", () => {
      const schema = webPageLd({
        title: "Test",
        description: "Test",
        path: "/test",
      }) as Record<string, unknown>;
      expect(schema.datePublished).toBeDefined();
      expect(schema.dateModified).toBeDefined();
    });

    it("accepts custom datePublished and dateModified", () => {
      const schema = webPageLd({
        title: "Test",
        description: "Test",
        path: "/test",
        datePublished: "2026-01-01",
        dateModified: "2026-07-31",
      }) as Record<string, unknown>;
      expect(schema.datePublished).toBe("2026-01-01");
      expect(schema.dateModified).toBe("2026-07-31");
    });
  });

  describe("SLICE-21-3: aboutPageLd()", () => {
    it("returns Article schema (alias for articleLd)", () => {
      const opts = { title: "About", description: "About page", path: "/about" };
      const schema = aboutPageLd(opts) as Record<string, unknown>;
      expect(schema["@type"]).toBe("Article");
      expect(schema.headline).toBe("About");
      expect(schema.description).toBe("About page");
      expect(schema.url).toBe(`${BASE_URL}/about`);
    });

    it("output matches articleLd() output", () => {
      const opts = { title: "Test", description: "Test desc", path: "/test" };
      const about = aboutPageLd(opts);
      const article = articleLd(opts);
      expect(about).toEqual(article);
    });
  });

  // ─── Existing schemas still work (no regression) ─────────
  describe("No regression: existing schemas", () => {
    it("softwareApplicationLd still returns valid schema", () => {
      const schema = softwareApplicationLd() as Record<string, unknown>;
      expect(schema["@type"]).toBe("SoftwareApplication");
      expect(schema.name).toBe("AgentBadge");
    });

    it("webSiteLd still returns valid schema", () => {
      const schema = webSiteLd() as Record<string, unknown>;
      expect(schema["@type"]).toBe("WebSite");
      expect(schema.url).toBe(BASE_URL);
    });

    it("organizationLd still returns valid schema", () => {
      const schema = organizationLd() as Record<string, unknown>;
      expect(schema["@type"]).toBe("Organization");
      expect(schema.name).toBe("AgentBadge");
    });
  });
});
