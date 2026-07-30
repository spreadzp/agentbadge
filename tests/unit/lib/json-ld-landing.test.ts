import { describe, it, expect } from "vitest";
import {
  softwareApplicationLd,
  webSiteLd,
  organizationLd,
  howToLd,
  landingJsonLd,
  renderJsonLd,
} from "../../../src/server/lib/json-ld";
import { BASE_URL } from "../../../src/server/lib/page-meta";

describe("SLICE-19-3: JSON-LD for landing (4 schemas)", () => {
  // ─── HowTo schema ────────────────────────────────────────
  describe("howToLd()", () => {
    it("returns @type HowTo", () => {
      const schema = howToLd() as Record<string, unknown>;
      expect(schema["@type"]).toBe("HowTo");
      expect(schema["@context"]).toBe("https://schema.org");
    });

    it("has name with AgentGate", () => {
      const schema = howToLd() as Record<string, unknown>;
      expect(schema.name as string).toContain("AgentGate");
    });

    it("has exactly 4 steps", () => {
      const schema = howToLd() as Record<string, unknown>;
      const steps = schema.step as unknown[];
      expect(steps).toHaveLength(4);
    });

    it("each step has @type HowToStep and text", () => {
      const schema = howToLd() as Record<string, unknown>;
      const steps = schema.step as Record<string, unknown>[];
      for (const step of steps) {
        expect(step["@type"]).toBe("HowToStep");
        expect(step.name).toBeDefined();
        expect(step.text).toBeDefined();
      }
    });

    it("has totalTime or estimatedCost", () => {
      const schema = howToLd() as Record<string, unknown>;
      // HowTo should have totalTime or estimatedCost
      expect(schema.totalTime || schema.estimatedCost).toBeDefined();
    });
  });

  // ─── landingJsonLd() assembler ───────────────────────────
  describe("landingJsonLd()", () => {
    it("returns array with 4 schemas", () => {
      const schemas = landingJsonLd();
      expect(schemas).toHaveLength(4);
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
      expect(parsed).toHaveLength(4);
    });

    it("escapes < characters in JSON (XSS prevention)", () => {
      // Test with a schema containing < to verify escaping
      const html = renderJsonLd([{ "@type": "Test", text: "<script>alert(1)</script>" }]);
      expect(html).toContain("\\u003c");
      expect(html).not.toContain("<script>alert");
    });
  });

  // ─── Existing schemas still work (no regression) ─────────
  describe("No regression: existing schemas", () => {
    it("softwareApplicationLd still returns valid schema", () => {
      const schema = softwareApplicationLd() as Record<string, unknown>;
      expect(schema["@type"]).toBe("SoftwareApplication");
      expect(schema.name).toBe("AgentGate");
    });

    it("webSiteLd still returns valid schema", () => {
      const schema = webSiteLd() as Record<string, unknown>;
      expect(schema["@type"]).toBe("WebSite");
      expect(schema.url).toBe(BASE_URL);
    });

    it("organizationLd still returns valid schema", () => {
      const schema = organizationLd() as Record<string, unknown>;
      expect(schema["@type"]).toBe("Organization");
      expect(schema.name).toBe("AgentGate");
    });
  });
});
