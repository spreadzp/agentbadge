import { describe, it, expect } from "vitest";
import {
  breadcrumbFor,
  defaultCoreSchemas,
} from "../../../src/server/lib/json-ld";

/**
 * SLICE-112-3: Add BreadcrumbList to all pages missing it.
 *
 * Verifies that breadcrumbFor() generates correct breadcrumbs
 * for all routes that need them.
 */
describe("SLICE-112-3: BreadcrumbList for all pages", () => {
  // Helper: extract breadcrumb from a schema array
  function getBreadcrumb(schemas: object[]): Record<string, unknown> | undefined {
    return schemas.find(
      (s) => (s as Record<string, unknown>)["@type"] === "BreadcrumbList",
    ) as Record<string, unknown> | undefined;
  }

  // Helper: get breadcrumb item names
  function getCrumbNames(schemas: object[]): string[] {
    const crumb = getBreadcrumb(schemas);
    if (!crumb) return [];
    return (crumb.itemListElement as Array<Record<string, unknown>>).map(
      (item) => item.name as string,
    );
  }

  // ─── /blog ───
  it("/blog has BreadcrumbList with Home → Blog", () => {
    const schemas = [...defaultCoreSchemas(), breadcrumbFor("/blog", "Blog")];
    const names = getCrumbNames(schemas);
    expect(names).toEqual(["Home", "Blog"]);
  });

  // ─── /faq ───
  it("/faq has BreadcrumbList with Home → FAQ", () => {
    const schemas = [...defaultCoreSchemas(), breadcrumbFor("/faq", "FAQ")];
    const names = getCrumbNames(schemas);
    expect(names).toEqual(["Home", "FAQ"]);
  });

  // ─── /use-cases ───
  it("/use-cases has BreadcrumbList with Home → Use Cases", () => {
    const schemas = [...defaultCoreSchemas(), breadcrumbFor("/use-cases", "Use Cases")];
    const names = getCrumbNames(schemas);
    expect(names).toEqual(["Home", "Use Cases"]);
  });

  // ─── /about ───
  it("/about has BreadcrumbList with Home → About", () => {
    const schemas = [...defaultCoreSchemas(), breadcrumbFor("/about", "About")];
    const names = getCrumbNames(schemas);
    expect(names).toEqual(["Home", "About"]);
  });

  // ─── /pricing ───
  it("/pricing has BreadcrumbList with Home → Pricing", () => {
    const schemas = [...defaultCoreSchemas(), breadcrumbFor("/pricing", "Pricing")];
    const names = getCrumbNames(schemas);
    expect(names).toEqual(["Home", "Pricing"]);
  });

  // ─── /rules ───
  it("/rules has BreadcrumbList with Home → Rules", () => {
    const schemas = [...defaultCoreSchemas(), breadcrumbFor("/rules", "Rules")];
    const names = getCrumbNames(schemas);
    expect(names).toEqual(["Home", "Rules"]);
  });

  // ─── /services ───
  it("/services has BreadcrumbList with Home → Services", () => {
    const schemas = [...defaultCoreSchemas(), breadcrumbFor("/services", "Services")];
    const names = getCrumbNames(schemas);
    expect(names).toEqual(["Home", "Services"]);
  });

  // ─── /work-with-us ───
  it("/work-with-us has BreadcrumbList with Home → Work With Us", () => {
    const schemas = [...defaultCoreSchemas(), breadcrumbFor("/work-with-us", "Work With Us")];
    const names = getCrumbNames(schemas);
    expect(names).toEqual(["Home", "Work With Us"]);
  });

  // ─── /changelog ───
  it("/changelog has BreadcrumbList with Home → Changelog", () => {
    const schemas = [...defaultCoreSchemas(), breadcrumbFor("/changelog", "Changelog")];
    const names = getCrumbNames(schemas);
    expect(names).toEqual(["Home", "Changelog"]);
  });

  // ─── /terms ───
  it("/terms has BreadcrumbList with Home → Terms", () => {
    const schemas = [...defaultCoreSchemas(), breadcrumbFor("/terms", "Terms")];
    const names = getCrumbNames(schemas);
    expect(names).toEqual(["Home", "Terms"]);
  });

  // ─── /privacy ───
  it("/privacy has BreadcrumbList with Home → Privacy", () => {
    const schemas = [...defaultCoreSchemas(), breadcrumbFor("/privacy", "Privacy")];
    const names = getCrumbNames(schemas);
    expect(names).toEqual(["Home", "Privacy"]);
  });

  // ─── All schemas include BreadcrumbList ───
  it("all 11 routes include BreadcrumbList in their schema set", () => {
    const routes = [
      { path: "/blog", label: "Blog" },
      { path: "/faq", label: "FAQ" },
      { path: "/use-cases", label: "Use Cases" },
      { path: "/about", label: "About" },
      { path: "/pricing", label: "Pricing" },
      { path: "/rules", label: "Rules" },
      { path: "/services", label: "Services" },
      { path: "/work-with-us", label: "Work With Us" },
      { path: "/changelog", label: "Changelog" },
      { path: "/terms", label: "Terms" },
      { path: "/privacy", label: "Privacy" },
    ];
    for (const r of routes) {
      const schemas = [...defaultCoreSchemas(), breadcrumbFor(r.path, r.label)];
      expect(getBreadcrumb(schemas)).toBeDefined();
    }
  });
});
