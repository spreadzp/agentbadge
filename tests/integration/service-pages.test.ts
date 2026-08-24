import { describe, it, expect } from "vitest";
import { ServicePageView } from "../../src/views/service-page";
import { ServicesPage } from "../../src/views/services-page";
import { AGENCY_SERVICES } from "../../src/server/lib/agency-config";
import { servicesJsonLd, breadcrumbListLd } from "../../src/server/lib/json-ld";
import type { RegistryIndex } from "../../src/server/registry/types";

const MOCK_REGISTRY: RegistryIndex = {
  schema_version: "1.0",
  categories: [],
  skills: [],
  capabilities: [],
  services: [],
  people: [],
  warnings: [],
};

function stripTags(html: string): string {
  return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const serviceIds = ["scanner", "passports", "marketplace"];

describe("SLICE-77-1: Service page content depth (AB-100)", () => {
  for (const id of serviceIds) {
    const service = AGENCY_SERVICES.find((s) => s.id === id)!;
    const others = AGENCY_SERVICES.filter((s) => s.id !== id);
    const html = ServicePageView(service, others).toString();

    it(`${id}: body has 500+ words`, () => {
      const body = stripTags(html);
      expect(countWords(body)).toBeGreaterThanOrEqual(500);
    });

    it(`${id}: has at least 3 <h2> headings`, () => {
      const h2Count = (html.match(/<h2/g) ?? []).length;
      expect(h2Count).toBeGreaterThanOrEqual(3);
    });

    it(`${id}: has at least 5 <h3> headings`, () => {
      const h3Count = (html.match(/<h3/g) ?? []).length;
      expect(h3Count).toBeGreaterThanOrEqual(5);
    });

    it(`${id}: has "How it works" section`, () => {
      expect(html).toMatch(/How it works/i);
    });

    it(`${id}: has "FAQ" section`, () => {
      expect(html).toMatch(/FAQ/i);
    });

    it(`${id}: has "Use cases" section`, () => {
      expect(html).toMatch(/Use cases/i);
    });

    it(`${id}: has "Pricing" section`, () => {
      expect(html).toMatch(/Pricing/i);
    });

    it(`${id}: heading hierarchy h1 → h2 → h3 (no skipped levels)`, () => {
      const headings = html.match(/<h([1-3])[^>]*>/g) ?? [];
      const levels = headings.map((h) => parseInt(h[2]));
      for (let i = 1; i < levels.length; i++) {
        if (levels[i] > levels[i - 1]) {
          expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
        }
      }
    });
  }
});

describe("SLICE-77-2: JSON-LD BreadcrumbList on service pages (AB-101)", () => {
  for (const id of serviceIds) {
    const service = AGENCY_SERVICES.find((s) => s.id === id)!;
    const schemas = servicesJsonLd({
      name: service.name,
      description: service.description,
      path: service.url,
    });

    it(`${id}: servicesJsonLd returns BreadcrumbList`, () => {
      const breadcrumb = schemas.find(
        (s) => (s as Record<string, unknown>)["@type"] === "BreadcrumbList",
      );
      expect(breadcrumb).toBeDefined();
    });

    it(`${id}: breadcrumb has Home → Services → {Service Name}`, () => {
      const breadcrumb = schemas.find(
        (s) => (s as Record<string, unknown>)["@type"] === "BreadcrumbList",
      ) as Record<string, unknown>;
      const items = breadcrumb.itemListElement as Array<Record<string, unknown>>;
      expect(items).toHaveLength(3);
      expect(items[0].name).toBe("Home");
      expect(items[1].name).toBe("Services");
      expect(items[2].name).toBe(service.name);
    });

    it(`${id}: each breadcrumb item has ListItem, position, name, item`, () => {
      const breadcrumb = schemas.find(
        (s) => (s as Record<string, unknown>)["@type"] === "BreadcrumbList",
      ) as Record<string, unknown>;
      const items = breadcrumb.itemListElement as Array<Record<string, unknown>>;
      for (const item of items) {
        expect(item["@type"]).toBe("ListItem");
        expect(item.position).toBeDefined();
        expect(item.name).toBeDefined();
        expect(item.item).toBeDefined();
        expect(item.item).toMatch(/^https?:\/\//);
      }
    });
  }
});

describe("SLICE-77-3: Breadcrumbs on /services list page + rule detail page", () => {
  it("/services page has HTML breadcrumb nav with aria-label", () => {
    const html = ServicesPage(MOCK_REGISTRY).toString();
    expect(html).toMatch(/aria-label="Breadcrumb"/);
  });

  it("/services page has BreadcrumbList JSON-LD", () => {
    const html = ServicesPage(MOCK_REGISTRY).toString();
    expect(html).toMatch(/BreadcrumbList/);
  });

  it("/services breadcrumb: Home → Services", () => {
    const html = ServicesPage(MOCK_REGISTRY).toString();
    expect(html).toMatch(/href="\/"/);
    expect(html).toMatch(/Services/i);
  });

  it("breadcrumbListLd helper produces correct structure for /services", () => {
    const ld = breadcrumbListLd([
      { name: "Home", path: "/" },
      { name: "Services", path: "/services" },
    ]) as Record<string, unknown>;
    expect(ld["@type"]).toBe("BreadcrumbList");
    const items = ld.itemListElement as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("Home");
    expect(items[1].name).toBe("Services");
  });
});
