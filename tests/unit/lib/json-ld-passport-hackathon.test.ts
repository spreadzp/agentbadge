import { describe, it, expect } from "vitest";
import {
  landingJsonLd,
  pageCoreSchemas,
  softwareApplicationLd,
  webPageLd,
  breadcrumbFor,
} from "../../../src/server/lib/json-ld";

/**
 * SLICE-112-2: Fix /passport and /hackathon/* schemas.
 *
 * These pages should NOT use landingJsonLd() (which includes HowTo + FAQ).
 * They should use pageCoreSchemas() + softwareApplicationLd() + webPageLd() + breadcrumbFor().
 */
describe("SLICE-112-2: /passport and /hackathon/* schemas", () => {
  // ─── /passport ───

  describe("/passport schema set", () => {
    const passportSchemas = [
      ...pageCoreSchemas(),
      softwareApplicationLd(),
      webPageLd({
        title: "Passport",
        description: "AgentBadge Passport — on-chain AI agent identity",
        path: "/passport",
      }),
      breadcrumbFor("/passport", "Passport"),
    ];

    it("does NOT include HowTo schema", () => {
      const types = passportSchemas.map((s) => (s as Record<string, unknown>)["@type"]);
      expect(types).not.toContain("HowTo");
    });

    it("does NOT include FAQPage schema", () => {
      const types = passportSchemas.map((s) => (s as Record<string, unknown>)["@type"]);
      expect(types).not.toContain("FAQPage");
    });

    it("includes SoftwareApplication", () => {
      const types = passportSchemas.map((s) => (s as Record<string, unknown>)["@type"]);
      expect(types).toContain("SoftwareApplication");
    });

    it("includes WebSite and Organization", () => {
      const types = passportSchemas.map((s) => (s as Record<string, unknown>)["@type"]);
      expect(types).toContain("WebSite");
      expect(types).toContain("Organization");
    });

    it("includes WebPage", () => {
      const types = passportSchemas.map((s) => (s as Record<string, unknown>)["@type"]);
      expect(types).toContain("WebPage");
    });

    it("includes BreadcrumbList", () => {
      const types = passportSchemas.map((s) => (s as Record<string, unknown>)["@type"]);
      expect(types).toContain("BreadcrumbList");
    });

    it("breadcrumb has Home → Passport", () => {
      const crumb = passportSchemas.find(
        (s) => (s as Record<string, unknown>)["@type"] === "BreadcrumbList",
      ) as Record<string, unknown>;
      const items = crumb.itemListElement as Array<Record<string, unknown>>;
      expect(items).toHaveLength(2);
      expect(items[0].name).toBe("Home");
      expect(items[1].name).toBe("Passport");
    });
  });

  // ─── /hackathon/datahub ───

  describe("/hackathon/datahub schema set", () => {
    const datahubSchemas = [
      ...pageCoreSchemas(),
      softwareApplicationLd(),
      webPageLd({
        title: "DataHub",
        description: "Hackathon DataHub project",
        path: "/hackathon/datahub",
      }),
      breadcrumbFor("/hackathon/datahub", "DataHub"),
    ];

    it("does NOT include HowTo schema", () => {
      const types = datahubSchemas.map((s) => (s as Record<string, unknown>)["@type"]);
      expect(types).not.toContain("HowTo");
    });

    it("does NOT include FAQPage schema", () => {
      const types = datahubSchemas.map((s) => (s as Record<string, unknown>)["@type"]);
      expect(types).not.toContain("FAQPage");
    });

    it("includes WebPage and BreadcrumbList", () => {
      const types = datahubSchemas.map((s) => (s as Record<string, unknown>)["@type"]);
      expect(types).toContain("WebPage");
      expect(types).toContain("BreadcrumbList");
    });

    it("breadcrumb has Home → Hackathon → DataHub", () => {
      const crumb = datahubSchemas.find(
        (s) => (s as Record<string, unknown>)["@type"] === "BreadcrumbList",
      ) as Record<string, unknown>;
      const items = crumb.itemListElement as Array<Record<string, unknown>>;
      expect(items).toHaveLength(3);
      expect(items[0].name).toBe("Home");
      expect(items[1].name).toBe("Hackathon");
      expect(items[2].name).toBe("DataHub");
    });
  });

  // ─── /hackathon/webmcp ───

  describe("/hackathon/webmcp schema set", () => {
    const webmcpSchemas = [
      ...pageCoreSchemas(),
      softwareApplicationLd(),
      webPageLd({
        title: "WebMCP",
        description: "Hackathon WebMCP project",
        path: "/hackathon/webmcp",
      }),
      breadcrumbFor("/hackathon/webmcp", "WebMCP"),
    ];

    it("does NOT include HowTo schema", () => {
      const types = webmcpSchemas.map((s) => (s as Record<string, unknown>)["@type"]);
      expect(types).not.toContain("HowTo");
    });

    it("does NOT include FAQPage schema", () => {
      const types = webmcpSchemas.map((s) => (s as Record<string, unknown>)["@type"]);
      expect(types).not.toContain("FAQPage");
    });

    it("includes WebPage and BreadcrumbList", () => {
      const types = webmcpSchemas.map((s) => (s as Record<string, unknown>)["@type"]);
      expect(types).toContain("WebPage");
      expect(types).toContain("BreadcrumbList");
    });

    it("breadcrumb has Home → Hackathon → WebMCP", () => {
      const crumb = webmcpSchemas.find(
        (s) => (s as Record<string, unknown>)["@type"] === "BreadcrumbList",
      ) as Record<string, unknown>;
      const items = crumb.itemListElement as Array<Record<string, unknown>>;
      expect(items).toHaveLength(3);
      expect(items[0].name).toBe("Home");
      expect(items[1].name).toBe("Hackathon");
      expect(items[2].name).toBe("WebMCP");
    });
  });

  // ─── landingJsonLd() still has HowTo + FAQ (for /, not for /passport) ───

  describe("landingJsonLd() still has HowTo + FAQ (used only for /)", () => {
    it("includes HowTo", () => {
      const types = landingJsonLd().map((s) => (s as Record<string, unknown>)["@type"]);
      expect(types).toContain("HowTo");
    });

    it("includes FAQPage", () => {
      const types = landingJsonLd().map((s) => (s as Record<string, unknown>)["@type"]);
      expect(types).toContain("FAQPage");
    });
  });
});
