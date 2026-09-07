import { describe, it, expect } from "vitest";
import {
  pageCoreSchemas,
  webPageLd,
  breadcrumbFor,
} from "../../../src/server/lib/json-ld";

/**
 * SLICE-112-6: Fix legal pages — remove SoftwareApplication.
 *
 * /terms and /privacy are legal documents, not software product pages.
 * They should use pageCoreSchemas() + webPageLd(), not defaultCoreSchemas()
 * (which includes SoftwareApplication).
 */
describe("SLICE-112-6: Legal pages — no SoftwareApplication", () => {
  function findType(schemas: object[], type: string): Record<string, unknown> | undefined {
    return schemas.find(
      (s) => (s as Record<string, unknown>)["@type"] === type,
    ) as Record<string, unknown> | undefined;
  }

  // ─── /terms ───
  it("/terms has WebPage schema", () => {
    const schemas = [
      ...pageCoreSchemas(),
      webPageLd({
        title: "Terms of Service",
        description: "Legal terms governing the use of AgentBadge.",
        path: "/terms",
      }),
      breadcrumbFor("/terms", "Terms"),
    ];
    expect(findType(schemas, "WebPage")).toBeDefined();
  });

  it("/terms does NOT have SoftwareApplication", () => {
    const schemas = [
      ...pageCoreSchemas(),
      webPageLd({
        title: "Terms of Service",
        description: "Legal terms governing the use of AgentBadge.",
        path: "/terms",
      }),
      breadcrumbFor("/terms", "Terms"),
    ];
    expect(findType(schemas, "SoftwareApplication")).toBeUndefined();
  });

  it("/terms still has WebSite and Organization", () => {
    const schemas = [
      ...pageCoreSchemas(),
      webPageLd({
        title: "Terms of Service",
        description: "Legal terms governing the use of AgentBadge.",
        path: "/terms",
      }),
      breadcrumbFor("/terms", "Terms"),
    ];
    expect(findType(schemas, "WebSite")).toBeDefined();
    expect(findType(schemas, "Organization")).toBeDefined();
  });

  // ─── /privacy ───
  it("/privacy has WebPage schema", () => {
    const schemas = [
      ...pageCoreSchemas(),
      webPageLd({
        title: "Privacy Policy",
        description: "Privacy disclosure for AgentBadge.",
        path: "/privacy",
      }),
      breadcrumbFor("/privacy", "Privacy"),
    ];
    expect(findType(schemas, "WebPage")).toBeDefined();
  });

  it("/privacy does NOT have SoftwareApplication", () => {
    const schemas = [
      ...pageCoreSchemas(),
      webPageLd({
        title: "Privacy Policy",
        description: "Privacy disclosure for AgentBadge.",
        path: "/privacy",
      }),
      breadcrumbFor("/privacy", "Privacy"),
    ];
    expect(findType(schemas, "SoftwareApplication")).toBeUndefined();
  });

  it("/privacy still has WebSite and Organization", () => {
    const schemas = [
      ...pageCoreSchemas(),
      webPageLd({
        title: "Privacy Policy",
        description: "Privacy disclosure for AgentBadge.",
        path: "/privacy",
      }),
      breadcrumbFor("/privacy", "Privacy"),
    ];
    expect(findType(schemas, "WebSite")).toBeDefined();
    expect(findType(schemas, "Organization")).toBeDefined();
  });
});
