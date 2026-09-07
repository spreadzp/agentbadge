import { describe, it, expect } from "vitest";

const BASE = "http://localhost:4021";

/**
 * SLICE-112-9: E2E tests — validate JSON-LD schema correctness per route.
 *
 * Fetches each public route, extracts <script type="application/ld+json"> blocks,
 * parses JSON, and validates @type presence/absence against the test matrix.
 */

interface SchemaEntry {
  "@type"?: string;
  [key: string]: unknown;
}

async function fetchSchemas(path: string): Promise<SchemaEntry[]> {
  const res = await fetch(`${BASE}${path}`);
  expect(res.status).toBe(200);
  const html = await res.text();
  const schemas: SchemaEntry[] = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) {
        schemas.push(...parsed);
      } else {
        schemas.push(parsed);
      }
    } catch {
      // skip unparseable blocks
    }
  }
  return schemas;
}

function getTypes(schemas: SchemaEntry[]): string[] {
  return schemas.map((s) => s["@type"]).filter((t): t is string => typeof t === "string");
}

function hasType(schemas: SchemaEntry[], type: string): boolean {
  return getTypes(schemas).includes(type);
}

describe("SLICE-112-9: JSON-LD schema correctness per route", () => {
  // ─── Homepage ───
  describe("/", () => {
    it("has SoftwareApplication, WebSite, Organization, HowTo, FAQPage, BreadcrumbList", async () => {
      const schemas = await fetchSchemas("/");
      expect(hasType(schemas, "SoftwareApplication")).toBe(true);
      expect(hasType(schemas, "WebSite")).toBe(true);
      expect(hasType(schemas, "Organization")).toBe(true);
      expect(hasType(schemas, "HowTo")).toBe(true);
      expect(hasType(schemas, "FAQPage")).toBe(true);
      expect(hasType(schemas, "BreadcrumbList")).toBe(true);
    });
  });

  // ─── Passport ───
  describe("/passport", () => {
    it("has SoftwareApplication, WebSite, Organization, WebPage, BreadcrumbList", async () => {
      const schemas = await fetchSchemas("/passport");
      expect(hasType(schemas, "SoftwareApplication")).toBe(true);
      expect(hasType(schemas, "WebSite")).toBe(true);
      expect(hasType(schemas, "Organization")).toBe(true);
      expect(hasType(schemas, "WebPage")).toBe(true);
      expect(hasType(schemas, "BreadcrumbList")).toBe(true);
    });
    it("does NOT have HowTo or FAQPage", async () => {
      const schemas = await fetchSchemas("/passport");
      expect(hasType(schemas, "HowTo")).toBe(false);
      expect(hasType(schemas, "FAQPage")).toBe(false);
    });
  });

  // ─── Blog listing ───
  describe("/blog", () => {
    it("has WebSite, Organization, Blog, ItemList, BreadcrumbList", async () => {
      const schemas = await fetchSchemas("/blog");
      expect(hasType(schemas, "WebSite")).toBe(true);
      expect(hasType(schemas, "Organization")).toBe(true);
      expect(hasType(schemas, "Blog")).toBe(true);
      expect(hasType(schemas, "ItemList")).toBe(true);
      expect(hasType(schemas, "BreadcrumbList")).toBe(true);
    });
    it("does NOT have SoftwareApplication", async () => {
      const schemas = await fetchSchemas("/blog");
      expect(hasType(schemas, "SoftwareApplication")).toBe(false);
    });
  });

  // ─── Blog article ───
  describe("/blog/:slug", () => {
    it("has WebSite, Organization, Article, BreadcrumbList", async () => {
      const schemas = await fetchSchemas("/blog/what-is-agent-readiness");
      expect(hasType(schemas, "WebSite")).toBe(true);
      expect(hasType(schemas, "Organization")).toBe(true);
      expect(hasType(schemas, "Article")).toBe(true);
      expect(hasType(schemas, "BreadcrumbList")).toBe(true);
    });
    it("does NOT have SoftwareApplication", async () => {
      const schemas = await fetchSchemas("/blog/what-is-agent-readiness");
      expect(hasType(schemas, "SoftwareApplication")).toBe(false);
    });
  });

  // ─── FAQ ───
  describe("/faq", () => {
    it("has WebSite, Organization, FAQPage, BreadcrumbList", async () => {
      const schemas = await fetchSchemas("/faq");
      expect(hasType(schemas, "WebSite")).toBe(true);
      expect(hasType(schemas, "Organization")).toBe(true);
      expect(hasType(schemas, "FAQPage")).toBe(true);
      expect(hasType(schemas, "BreadcrumbList")).toBe(true);
    });
    it("does NOT have SoftwareApplication", async () => {
      const schemas = await fetchSchemas("/faq");
      expect(hasType(schemas, "SoftwareApplication")).toBe(false);
    });
  });

  // ─── Use Cases ───
  describe("/use-cases", () => {
    it("has WebSite, Organization, Article, BreadcrumbList", async () => {
      const schemas = await fetchSchemas("/use-cases");
      expect(hasType(schemas, "WebSite")).toBe(true);
      expect(hasType(schemas, "Organization")).toBe(true);
      expect(hasType(schemas, "Article")).toBe(true);
      expect(hasType(schemas, "BreadcrumbList")).toBe(true);
    });
    it("does NOT have SoftwareApplication", async () => {
      const schemas = await fetchSchemas("/use-cases");
      expect(hasType(schemas, "SoftwareApplication")).toBe(false);
    });
  });

  // ─── About ───
  describe("/about", () => {
    it("has WebSite, Organization, AboutPage, BreadcrumbList", async () => {
      const schemas = await fetchSchemas("/about");
      expect(hasType(schemas, "WebSite")).toBe(true);
      expect(hasType(schemas, "Organization")).toBe(true);
      expect(hasType(schemas, "AboutPage")).toBe(true);
      expect(hasType(schemas, "BreadcrumbList")).toBe(true);
    });
    it("does NOT have Article or SoftwareApplication", async () => {
      const schemas = await fetchSchemas("/about");
      expect(hasType(schemas, "Article")).toBe(false);
      expect(hasType(schemas, "SoftwareApplication")).toBe(false);
    });
  });

  // ─── Pricing ───
  describe("/pricing", () => {
    it("has WebSite, Organization, WebPage, BreadcrumbList", async () => {
      const schemas = await fetchSchemas("/pricing");
      expect(hasType(schemas, "WebSite")).toBe(true);
      expect(hasType(schemas, "Organization")).toBe(true);
      expect(hasType(schemas, "WebPage")).toBe(true);
      expect(hasType(schemas, "BreadcrumbList")).toBe(true);
    });
    it("does NOT have Article or SoftwareApplication", async () => {
      const schemas = await fetchSchemas("/pricing");
      expect(hasType(schemas, "Article")).toBe(false);
      expect(hasType(schemas, "SoftwareApplication")).toBe(false);
    });
  });

  // ─── Terms ───
  describe("/terms", () => {
    it("has WebSite, Organization, WebPage, BreadcrumbList", async () => {
      const schemas = await fetchSchemas("/terms");
      expect(hasType(schemas, "WebSite")).toBe(true);
      expect(hasType(schemas, "Organization")).toBe(true);
      expect(hasType(schemas, "WebPage")).toBe(true);
      expect(hasType(schemas, "BreadcrumbList")).toBe(true);
    });
    it("does NOT have SoftwareApplication", async () => {
      const schemas = await fetchSchemas("/terms");
      expect(hasType(schemas, "SoftwareApplication")).toBe(false);
    });
  });

  // ─── Privacy ───
  describe("/privacy", () => {
    it("has WebSite, Organization, WebPage, BreadcrumbList", async () => {
      const schemas = await fetchSchemas("/privacy");
      expect(hasType(schemas, "WebSite")).toBe(true);
      expect(hasType(schemas, "Organization")).toBe(true);
      expect(hasType(schemas, "WebPage")).toBe(true);
      expect(hasType(schemas, "BreadcrumbList")).toBe(true);
    });
    it("does NOT have SoftwareApplication", async () => {
      const schemas = await fetchSchemas("/privacy");
      expect(hasType(schemas, "SoftwareApplication")).toBe(false);
    });
  });

  // ─── Changelog ───
  describe("/changelog", () => {
    it("has WebSite, Organization, Article, BreadcrumbList", async () => {
      const schemas = await fetchSchemas("/changelog");
      expect(hasType(schemas, "WebSite")).toBe(true);
      expect(hasType(schemas, "Organization")).toBe(true);
      expect(hasType(schemas, "Article")).toBe(true);
      expect(hasType(schemas, "BreadcrumbList")).toBe(true);
    });
    it("does NOT have SoftwareApplication", async () => {
      const schemas = await fetchSchemas("/changelog");
      expect(hasType(schemas, "SoftwareApplication")).toBe(false);
    });
  });

  // ─── Rules ───
  describe("/rules", () => {
    it("has WebSite, Organization, CollectionPage, BreadcrumbList", async () => {
      const schemas = await fetchSchemas("/rules");
      expect(hasType(schemas, "WebSite")).toBe(true);
      expect(hasType(schemas, "Organization")).toBe(true);
      expect(hasType(schemas, "CollectionPage")).toBe(true);
      expect(hasType(schemas, "BreadcrumbList")).toBe(true);
    });
    it("does NOT have FAQPage or SoftwareApplication", async () => {
      const schemas = await fetchSchemas("/rules");
      expect(hasType(schemas, "FAQPage")).toBe(false);
      expect(hasType(schemas, "SoftwareApplication")).toBe(false);
    });
  });

  // ─── Services ───
  describe("/services", () => {
    it("has WebSite, Organization, CollectionPage, BreadcrumbList", async () => {
      const schemas = await fetchSchemas("/services");
      expect(hasType(schemas, "WebSite")).toBe(true);
      expect(hasType(schemas, "Organization")).toBe(true);
      expect(hasType(schemas, "CollectionPage")).toBe(true);
      expect(hasType(schemas, "BreadcrumbList")).toBe(true);
    });
    it("does NOT have Article or SoftwareApplication", async () => {
      const schemas = await fetchSchemas("/services");
      expect(hasType(schemas, "Article")).toBe(false);
      expect(hasType(schemas, "SoftwareApplication")).toBe(false);
    });
  });

  // ─── Work With Us ───
  describe("/work-with-us", () => {
    it("has WebSite, Organization, WebPage, BreadcrumbList", async () => {
      const schemas = await fetchSchemas("/work-with-us");
      expect(hasType(schemas, "WebSite")).toBe(true);
      expect(hasType(schemas, "Organization")).toBe(true);
      expect(hasType(schemas, "WebPage")).toBe(true);
      expect(hasType(schemas, "BreadcrumbList")).toBe(true);
    });
    it("does NOT have Article or SoftwareApplication", async () => {
      const schemas = await fetchSchemas("/work-with-us");
      expect(hasType(schemas, "Article")).toBe(false);
      expect(hasType(schemas, "SoftwareApplication")).toBe(false);
    });
  });
});
