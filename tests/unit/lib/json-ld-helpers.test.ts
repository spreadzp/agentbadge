import { describe, it, expect } from "vitest";
import {
  pageCoreSchemas,
  breadcrumbFor,
  aboutPageLd,
  collectionPageLd,
  defaultCoreSchemas,
} from "../../../src/server/lib/json-ld";
import { BASE_URL } from "../../../src/server/lib/page-meta";

describe("SLICE-112-1: Foundation helpers", () => {
  // ─── pageCoreSchemas() ───

  describe("pageCoreSchemas()", () => {
    it("returns array with WebSite and Organization", () => {
      const schemas = pageCoreSchemas();
      expect(Array.isArray(schemas)).toBe(true);
      expect(schemas).toHaveLength(2);
      const types = schemas.map((s) => (s as Record<string, unknown>)["@type"]);
      expect(types).toContain("WebSite");
      expect(types).toContain("Organization");
    });

    it("does NOT include SoftwareApplication", () => {
      const schemas = pageCoreSchemas();
      const types = schemas.map((s) => (s as Record<string, unknown>)["@type"]);
      expect(types).not.toContain("SoftwareApplication");
    });
  });

  // ─── breadcrumbFor() ───

  describe("breadcrumbFor()", () => {
    it("generates BreadcrumbList for /blog/my-article", () => {
      const crumb = breadcrumbFor("/blog/my-article") as Record<string, unknown>;
      expect(crumb["@type"]).toBe("BreadcrumbList");
      const items = crumb.itemListElement as Array<Record<string, unknown>>;
      expect(items).toHaveLength(3);
      expect(items[0].name).toBe("Home");
      expect(items[0].position).toBe(1);
      expect(items[1].name).toBe("Blog");
      expect(items[1].position).toBe(2);
      expect(items[2].name).toBe("My Article");
      expect(items[2].position).toBe(3);
    });

    it("generates BreadcrumbList for /services/scanner", () => {
      const crumb = breadcrumbFor("/services/scanner") as Record<string, unknown>;
      const items = crumb.itemListElement as Array<Record<string, unknown>>;
      expect(items).toHaveLength(3);
      expect(items[0].name).toBe("Home");
      expect(items[1].name).toBe("Services");
      expect(items[2].name).toBe("Scanner");
    });

    it("generates single-item breadcrumb for /", () => {
      const crumb = breadcrumbFor("/") as Record<string, unknown>;
      const items = crumb.itemListElement as Array<Record<string, unknown>>;
      expect(items).toHaveLength(1);
      expect(items[0].name).toBe("Home");
    });

    it("uses custom label when provided", () => {
      const crumb = breadcrumbFor("/blog/my-article", "Custom Title") as Record<string, unknown>;
      const items = crumb.itemListElement as Array<Record<string, unknown>>;
      expect(items[items.length - 1].name).toBe("Custom Title");
    });

    it("generates correct item URLs", () => {
      const crumb = breadcrumbFor("/blog/my-article") as Record<string, unknown>;
      const items = crumb.itemListElement as Array<Record<string, unknown>>;
      expect(items[0].item).toBe(`${BASE_URL}/`);
      expect(items[1].item).toBe(`${BASE_URL}/blog`);
      expect(items[2].item).toBe(`${BASE_URL}/blog/my-article`);
    });
  });

  // ─── aboutPageLd() ───

  describe("aboutPageLd()", () => {
    it("returns @type AboutPage", () => {
      const schema = aboutPageLd({
        title: "About AgentBadge",
        description: "Learn about our mission",
        path: "/about",
      }) as Record<string, unknown>;
      expect(schema["@type"]).toBe("AboutPage");
      expect(schema["@context"]).toBe("https://schema.org");
    });

    it("has mainEntity pointing to Organization", () => {
      const schema = aboutPageLd({
        title: "About AgentBadge",
        description: "Learn about our mission",
        path: "/about",
      }) as Record<string, unknown>;
      const mainEntity = schema.mainEntity as Record<string, unknown>;
      expect(mainEntity["@type"]).toBe("Organization");
      expect(mainEntity.name).toBeDefined();
      expect(mainEntity.url).toBe(BASE_URL);
    });

    it("has name and description", () => {
      const schema = aboutPageLd({
        title: "About AgentBadge",
        description: "Learn about our mission",
        path: "/about",
      }) as Record<string, unknown>;
      expect(schema.name).toBe("About AgentBadge");
      expect(schema.description).toBe("Learn about our mission");
    });

    it("has url", () => {
      const schema = aboutPageLd({
        title: "About AgentBadge",
        description: "Learn about our mission",
        path: "/about",
      }) as Record<string, unknown>;
      expect(schema.url).toBe(`${BASE_URL}/about`);
    });
  });

  // ─── collectionPageLd() ───

  describe("collectionPageLd()", () => {
    it("returns @type CollectionPage", () => {
      const schema = collectionPageLd({
        name: "Rules Catalog",
        description: "All AgentBadge scanner rules",
        path: "/rules",
      }) as Record<string, unknown>;
      expect(schema["@type"]).toBe("CollectionPage");
      expect(schema["@context"]).toBe("https://schema.org");
    });

    it("has name and description", () => {
      const schema = collectionPageLd({
        name: "Rules Catalog",
        description: "All AgentBadge scanner rules",
        path: "/rules",
      }) as Record<string, unknown>;
      expect(schema.name).toBe("Rules Catalog");
      expect(schema.description).toBe("All AgentBadge scanner rules");
    });

    it("has url", () => {
      const schema = collectionPageLd({
        name: "Rules Catalog",
        description: "All AgentBadge scanner rules",
        path: "/rules",
      }) as Record<string, unknown>;
      expect(schema.url).toBe(`${BASE_URL}/rules`);
    });

    it("isPartOf points to WebSite", () => {
      const schema = collectionPageLd({
        name: "Rules Catalog",
        description: "All AgentBadge scanner rules",
        path: "/rules",
      }) as Record<string, unknown>;
      const isPartOf = schema.isPartOf as Record<string, unknown>;
      expect(isPartOf["@type"]).toBe("WebSite");
    });
  });

  // ─── defaultCoreSchemas() backward compat ───

  describe("defaultCoreSchemas() backward compat", () => {
    it("still works and includes SoftwareApplication", () => {
      const schemas = defaultCoreSchemas();
      expect(schemas).toHaveLength(3);
      const types = schemas.map((s) => (s as Record<string, unknown>)["@type"]);
      expect(types).toContain("SoftwareApplication");
      expect(types).toContain("WebSite");
      expect(types).toContain("Organization");
    });
  });
});
