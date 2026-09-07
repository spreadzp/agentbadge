import { describe, it, expect } from "vitest";
import {
  articleLd,
  collectionPageLd,
  webPageLd,
  breadcrumbFor,
  defaultCoreSchemas,
} from "../../../src/server/lib/json-ld";

/**
 * SLICE-112-7: Fix /changelog, /services, /work-with-us schema types.
 *
 * /changelog — add Article schema with dateModified
 * /services — replace articleLd with collectionPageLd (catalog, not article)
 * /work-with-us — replace articleLd with webPageLd (not an article)
 */
describe("SLICE-112-7: Fix /changelog, /services, /work-with-us", () => {
  function findType(schemas: object[], type: string): Record<string, unknown> | undefined {
    return schemas.find(
      (s) => (s as Record<string, unknown>)["@type"] === type,
    ) as Record<string, unknown> | undefined;
  }

  // ─── /changelog ───
  it("/changelog has Article schema with dateModified", () => {
    const schemas = [
      ...defaultCoreSchemas(),
      articleLd({
        title: "Changelog",
        description: "All notable changes to AgentBadge, newest first.",
        path: "/changelog",
        dateModified: "2026-09-07",
      }),
      breadcrumbFor("/changelog", "Changelog"),
    ];
    const article = findType(schemas, "Article");
    expect(article).toBeDefined();
    expect(article!.dateModified).toBe("2026-09-07");
  });

  // ─── /services ───
  it("/services has CollectionPage schema (not Article)", () => {
    const schemas = [
      ...defaultCoreSchemas(),
      collectionPageLd({
        name: "AgentBadge Services Catalog",
        description:
          "Engineering services: MCP server development, blockchain integration, AI agent architecture, GEO optimization.",
        path: "/services",
      }),
      breadcrumbFor("/services", "Services"),
    ];
    expect(findType(schemas, "CollectionPage")).toBeDefined();
    expect(findType(schemas, "Article")).toBeUndefined();
  });

  // ─── /work-with-us ───
  it("/work-with-us has WebPage schema (not Article)", () => {
    const schemas = [
      ...defaultCoreSchemas(),
      webPageLd({
        title: "Work With the AgentBadge Team",
        description:
          "Engagement types: contract, part-time, fixed-scope. Process, availability, and contact channels.",
        path: "/work-with-us",
      }),
      breadcrumbFor("/work-with-us", "Work With Us"),
    ];
    expect(findType(schemas, "WebPage")).toBeDefined();
    expect(findType(schemas, "Article")).toBeUndefined();
  });
});
