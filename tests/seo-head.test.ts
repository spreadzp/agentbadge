import { describe, it, expect } from "vitest";
import { Layout } from "../src/views/layout";
import { LandingLayout } from "../src/views/landing/layout";
import { PageMeta, BASE_URL, SITE_DESCRIPTION } from "../src/server/lib/page-meta";
import {
  softwareApplicationLd,
  webSiteLd,
  organizationLd,
  renderJsonLd,
  defaultCoreSchemas,
  passportLd,
  jobPostingLd,
  profilePageLd,
} from "../src/server/lib/json-ld";
import type { CachedMarketTask } from "@agentbadge/hedera-core";
import type { DirectoryEntry } from "@agentbadge/passport";

describe("SLICE-18-1: SEO Head Layer", () => {
  describe("Layout() with meta parameter", () => {
    it("renders meta description from PageMeta", () => {
      const html = Layout("<p>test</p>", "Agent Directory", PageMeta["/ui/agents"]).toString();
      expect(html).toContain('<meta name="description"');
      expect(html).toContain(PageMeta["/ui/agents"].description);
    });

    it("renders canonical link from PageMeta path", () => {
      const html = Layout("<p>test</p>", "Agent Directory", PageMeta["/ui/agents"]).toString();
      const expectedCanonical = `${BASE_URL}/ui/agents`;
      expect(html).toContain(`<link rel="canonical" href="${expectedCanonical}"`);
    });

    it("renders Open Graph tags", () => {
      const html = Layout("<p>test</p>", "Agent Directory", PageMeta["/ui/agents"]).toString();
      expect(html).toContain('<meta property="og:title"');
      expect(html).toContain('<meta property="og:description"');
      expect(html).toContain('<meta property="og:type" content="website"');
      expect(html).toContain('<meta property="og:url"');
      expect(html).toContain('<meta property="og:image"');
      expect(html).toContain('<meta property="og:site_name" content="AgentBadge"');
    });

    it("renders Twitter card tags", () => {
      const html = Layout("<p>test</p>", "Agent Directory", PageMeta["/ui/agents"]).toString();
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
      expect(html).toContain('<meta name="twitter:title"');
      expect(html).toContain('<meta name="twitter:description"');
      expect(html).toContain('<meta name="twitter:image"');
    });

    it("renders auto-discovery alternate links", () => {
      const html = Layout("<p>test</p>", "Test").toString();
      expect(html).toContain('rel="alternate" type="text/plain" title="LLM Context"');
      expect(html).toContain('rel="alternate" type="application/json" title="Agent Card (A2A)"');
      expect(html).toContain('rel="service-desc"');
    });

    it("falls back to SITE_DESCRIPTION when no meta provided", () => {
      const html = Layout("<p>test</p>", "Test").toString();
      expect(html).toContain(SITE_DESCRIPTION);
    });

    it("falls back to canonical '/' when no meta provided", () => {
      const html = Layout("<p>test</p>", "Test").toString();
      expect(html).toContain(`<link rel="canonical" href="${BASE_URL}/"`);
    });
  });

  describe("PageMeta registry", () => {
    it("has entries for all public routes", () => {
      const requiredPaths = [
        "/",
        "/ui/agents",
        "/ui/search",
        "/ui/catalog",
        "/ui/a2a",
        "/ui/market/tasks",
        "/ui/medical-demo",
        "/ui/help",
        "/ui/passport/request",
        "/contact",
      ];
      for (const path of requiredPaths) {
        expect(PageMeta[path]).toBeDefined();
        expect(PageMeta[path].description.length).toBeGreaterThan(20);
        expect(PageMeta[path].path).toBe(path);
      }
    });

    it("has unique descriptions per route", () => {
      const descriptions = Object.values(PageMeta).map((m) => m.description);
      const unique = new Set(descriptions);
      expect(unique.size).toBe(descriptions.length);
    });
  });
});

describe("SLICE-18-4: JSON-LD Core Schemas", () => {
  describe("softwareApplicationLd()", () => {
    it("returns valid SoftwareApplication schema", () => {
      const schema = softwareApplicationLd() as Record<string, unknown>;
      expect(schema["@context"]).toBe("https://schema.org");
      expect(schema["@type"]).toBe("SoftwareApplication");
      expect(schema.name).toBe("AgentBadge");
      expect(schema.url).toBe(BASE_URL);
      expect(schema.description).toBeDefined();
      expect(schema.offers).toBeDefined();
    });
  });

  describe("webSiteLd()", () => {
    it("returns valid WebSite schema with SearchAction", () => {
      const schema = webSiteLd() as Record<string, unknown>;
      expect(schema["@context"]).toBe("https://schema.org");
      expect(schema["@type"]).toBe("WebSite");
      expect(schema.name).toBe("AgentBadge");
      expect(schema.url).toBe(BASE_URL);
      const action = schema.potentialAction as Record<string, unknown>;
      expect(action["@type"]).toBe("SearchAction");
    });
  });

  describe("organizationLd()", () => {
    it("returns valid Organization schema", () => {
      const schema = organizationLd() as Record<string, unknown>;
      expect(schema["@context"]).toBe("https://schema.org");
      expect(schema["@type"]).toBe("Organization");
      expect(schema.name).toBe("AgentBadge");
      expect(schema.url).toBe(BASE_URL);
      expect(schema.logo).toContain("/icons/logo-32.png");
    });
  });

  describe("defaultCoreSchemas()", () => {
    it("returns 3 core schemas", () => {
      const schemas = defaultCoreSchemas();
      expect(schemas).toHaveLength(3);
      expect(schemas[0]).toHaveProperty("@type", "SoftwareApplication");
      expect(schemas[1]).toHaveProperty("@type", "WebSite");
      expect(schemas[2]).toHaveProperty("@type", "Organization");
    });
  });

  describe("renderJsonLd()", () => {
    it("renders script tag with application/ld+json type", () => {
      const html = renderJsonLd([softwareApplicationLd()]);
      expect(html).toContain('<script type="application/ld+json">');
      expect(html).toContain("</script>");
    });

    it("escapes < characters to prevent XSS", () => {
      const malicious = { "@type": "Test", name: "</script><script>alert(1)</script>" };
      const html = renderJsonLd([malicious]);
      expect(html).not.toContain("</script><script>alert(1)</script>");
      expect(html).toContain("\\u003c");
    });

    it("renders valid JSON array inside script tag", () => {
      const html = renderJsonLd(defaultCoreSchemas());
      const jsonStart = html.indexOf(">") + 1;
      const jsonEnd = html.lastIndexOf("</script>");
      const jsonStr = html.slice(jsonStart, jsonEnd);
      const parsed = JSON.parse(jsonStr);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(3);
    });
  });

  describe("Layout() with default JSON-LD", () => {
    it("includes JSON-LD script tag by default", () => {
      const html = Layout("<p>test</p>", "Test").toString();
      expect(html).toContain('<script type="application/ld+json">');
      expect(html).toContain("SoftwareApplication");
      expect(html).toContain("WebSite");
      expect(html).toContain("Organization");
    });

    it("renders custom JSON-LD when provided", () => {
      const custom = [{ "@context": "https://schema.org", "@type": "FAQPage" }];
      const html = Layout("<p>test</p>", "Test", undefined, custom).toString();
      expect(html).toContain("FAQPage");
    });
  });
});

describe("SLICE-18-5: JSON-LD Entity Schemas", () => {
  describe("passportLd()", () => {
    it("returns DigitalDocument with DID identifier", () => {
      const schema = passportLd({
        tokenId: "0.0.123456",
        serial: 1,
        tier: "gold",
      }) as Record<string, unknown>;
      expect(schema["@context"]).toBe("https://schema.org");
      expect(schema["@type"]).toBe("DigitalDocument");
      expect(schema.identifier).toBe("did:hcs:0.0.123456:1");
      expect(schema.additionalType).toBe("VerifiableCredential");
    });

    it("includes isPartOf SoftwareApplication ref", () => {
      const schema = passportLd({ tokenId: "0.0.1", serial: 2, tier: "bronze" }) as Record<string, unknown>;
      const isPartOf = schema.isPartOf as Record<string, unknown>;
      expect(isPartOf["@type"]).toBe("SoftwareApplication");
      expect(isPartOf.name).toBe("AgentBadge");
    });

    it("includes ownerDID as creator when provided", () => {
      const schema = passportLd({
        tokenId: "0.0.1",
        serial: 3,
        tier: "platinum",
        ownerDID: "did:hcs:0.0.1:3",
      }) as Record<string, unknown>;
      const creator = schema.creator as Record<string, unknown>;
      expect(creator.identifier).toBe("did:hcs:0.0.1:3");
    });

    it("omits creator when ownerDID not provided", () => {
      const schema = passportLd({ tokenId: "0.0.1", serial: 4, tier: "silver" }) as Record<string, unknown>;
      expect(schema.creator).toBeUndefined();
    });

    it("includes tier as keywords", () => {
      const schema = passportLd({ tokenId: "0.0.1", serial: 5, tier: "gold" }) as Record<string, unknown>;
      expect(schema.keywords).toBe("gold");
    });
  });

  describe("jobPostingLd()", () => {
    const mockTask: CachedMarketTask = {
      taskId: "task-001",
      posterDid: "did:hcs:0.0.123:1",
      title: "Data Analysis Task",
      description: "Analyze medical data and produce a report",
      priceHbar: 50,
      capabilities: ["data_analysis", "medical"],
      status: "posted",
      txId: "0.0.1-123-456",
      consensusTimestamp: "2024-01-01T00:00:00.000Z",
      createdAt: 1704067200000,
    };

    it("returns JobPosting with required fields", () => {
      const schema = jobPostingLd(mockTask) as Record<string, unknown>;
      expect(schema["@context"]).toBe("https://schema.org");
      expect(schema["@type"]).toBe("JobPosting");
      expect(schema.title).toBe("Data Analysis Task");
      expect(schema.description).toBe("Analyze medical data and produce a report");
      expect(schema.datePosted).toBeDefined();
      expect(schema.employmentType).toBe("CONTRACT");
    });

    it("includes hiringOrganization with poster DID", () => {
      const schema = jobPostingLd(mockTask) as Record<string, unknown>;
      const org = schema.hiringOrganization as Record<string, unknown>;
      expect(org["@type"]).toBe("Organization");
      expect(org.identifier).toBe("did:hcs:0.0.123:1");
    });

    it("includes baseSalary in HBAR", () => {
      const schema = jobPostingLd(mockTask) as Record<string, unknown>;
      const salary = schema.baseSalary as Record<string, unknown>;
      expect(salary["@type"]).toBe("MonetaryAmount");
      expect(salary.currency).toBe("HBAR");
      expect(salary.value).toBe(50);
    });

    it("includes skills from capabilities", () => {
      const schema = jobPostingLd(mockTask) as Record<string, unknown>;
      expect(schema.skills).toBe("data_analysis, medical");
    });

    it("includes validThrough when deadline set", () => {
      const taskWithDeadline = { ...mockTask, deadline: 1704153600000 };
      const schema = jobPostingLd(taskWithDeadline) as Record<string, unknown>;
      expect(schema.validThrough).toBeDefined();
    });

    it("omits validThrough when no deadline", () => {
      const schema = jobPostingLd(mockTask) as Record<string, unknown>;
      expect(schema.validThrough).toBeUndefined();
    });
  });

  describe("profilePageLd()", () => {
    const mockAgent: DirectoryEntry = {
      did: "did:hcs:0.0.123:1",
      tokenId: "0.0.123",
      serial: 1,
      accountId: "0.0.456",
      name: "MedBot AI",
      capabilities: ["data_provide", "data_consume"],
      endpoint: "https://medbot.example.com",
      tier: "gold",
      timestamp: 1704067200000,
    };

    it("returns ProfilePage with mainEntity", () => {
      const schema = profilePageLd(mockAgent) as Record<string, unknown>;
      expect(schema["@context"]).toBe("https://schema.org");
      expect(schema["@type"]).toBe("ProfilePage");
      const entity = schema.mainEntity as Record<string, unknown>;
      expect(entity["@type"]).toBe("Thing");
      expect(entity.name).toBe("MedBot AI");
      expect(entity.identifier).toBe("did:hcs:0.0.123:1");
    });

    it("includes sameAs from endpoint", () => {
      const schema = profilePageLd(mockAgent) as Record<string, unknown>;
      const entity = schema.mainEntity as Record<string, unknown>;
      expect(entity.sameAs).toBe("https://medbot.example.com");
    });

    it("includes knowsAbout from capabilities", () => {
      const schema = profilePageLd(mockAgent) as Record<string, unknown>;
      const entity = schema.mainEntity as Record<string, unknown>;
      expect(entity.knowsAbout).toEqual(["data_provide", "data_consume"]);
    });

    it("includes tier as additionalType", () => {
      const schema = profilePageLd(mockAgent) as Record<string, unknown>;
      const entity = schema.mainEntity as Record<string, unknown>;
      expect(entity.additionalType).toBe("gold");
    });

    it("omits sameAs when no endpoint", () => {
      const noEndpoint = { ...mockAgent, endpoint: "" };
      const schema = profilePageLd(noEndpoint) as Record<string, unknown>;
      const entity = schema.mainEntity as Record<string, unknown>;
      expect(entity.sameAs).toBeUndefined();
    });
  });

  describe("Entity schemas XSS safety", () => {
    it("passportLd with XSS attempt in tier is escaped by renderJsonLd", () => {
      const schema = passportLd({ tokenId: "0.0.1", serial: 1, tier: "<script>alert(1)</script>" });
      const html = renderJsonLd([schema]);
      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).toContain("\\u003c");
    });

    it("jobPostingLd with XSS attempt in title is escaped by renderJsonLd", () => {
      const xssTask: CachedMarketTask = {
        ...{
          taskId: "xss",
          posterDid: "did:hcs:0.0.1:1",
          title: "</script><script>alert(1)</script>",
          description: "test",
          priceHbar: 1,
          capabilities: [],
          status: "posted",
          txId: "0.0.1-1-1",
          consensusTimestamp: "2024-01-01T00:00:00.000Z",
          createdAt: 1704067200000,
        },
      };
      const html = renderJsonLd([jobPostingLd(xssTask)]);
      expect(html).not.toContain("</script><script>alert(1)</script>");
      expect(html).toContain("\\u003c");
    });
  });

  describe("Layout with entity JSON-LD", () => {
    it("renders both core and entity schemas on page", () => {
      const mockAgent: DirectoryEntry = {
        did: "did:hcs:0.0.123:1",
        tokenId: "0.0.123",
        serial: 1,
        accountId: "0.0.456",
        name: "TestBot",
        capabilities: ["api_call"],
        endpoint: "https://test.example.com",
        tier: "bronze",
        timestamp: 1704067200000,
      };
      const schemas = [...defaultCoreSchemas(), profilePageLd(mockAgent)];
      const html = Layout("<p>test</p>", "Agent Profile", undefined, schemas).toString();
      expect(html).toContain("SoftwareApplication");
      expect(html).toContain("WebSite");
      expect(html).toContain("Organization");
      expect(html).toContain("ProfilePage");
      expect(html).toContain("did:hcs:0.0.123:1");
    });
  });
});

describe("SLICE-73-1: Blog og:type=article + article: meta tags", () => {
  describe("LandingLayout with article meta", () => {
    const articleMeta = {
      title: "What Is Agent Readiness?",
      description: "Agent Readiness is the ability of your API to be discovered by AI agents.",
      path: "/blog/what-is-agent-readiness",
      ogType: "article" as const,
      articleAuthor: "AgentBadge Team",
      articlePublishedTime: "2026-08-14",
      articleModifiedTime: "2026-08-14",
    };

    it("renders og:type=article when meta.ogType is article", () => {
      const html = LandingLayout("<p>test</p>", undefined, articleMeta).toString();
      expect(html).toContain('<meta property="og:type" content="article"');
    });

    it("renders article:author meta tag when ogType is article", () => {
      const html = LandingLayout("<p>test</p>", undefined, articleMeta).toString();
      expect(html).toContain('<meta property="article:author" content="AgentBadge Team"');
    });

    it("renders article:published_time meta tag when ogType is article", () => {
      const html = LandingLayout("<p>test</p>", undefined, articleMeta).toString();
      expect(html).toContain('<meta property="article:published_time" content="2026-08-14"');
    });

    it("renders article:modified_time meta tag when ogType is article", () => {
      const html = LandingLayout("<p>test</p>", undefined, articleMeta).toString();
      expect(html).toContain('<meta property="article:modified_time" content="2026-08-14"');
    });

    it("does not render article: meta tags when ogType is not article", () => {
      const html = LandingLayout("<p>test</p>", undefined, {
        ...articleMeta,
        ogType: "website" as const,
      }).toString();
      expect(html).not.toContain("article:author");
      expect(html).not.toContain("article:published_time");
      expect(html).not.toContain("article:modified_time");
    });
  });

  describe("LandingLayout default og:type", () => {
    it("defaults to og:type=website when no ogType provided", () => {
      const html = LandingLayout("<p>test</p>", undefined, PageMeta["/"]).toString();
      expect(html).toContain('<meta property="og:type" content="website"');
    });

    it("defaults to og:type=website when meta is undefined", () => {
      const html = LandingLayout("<p>test</p>", "Test Page").toString();
      expect(html).toContain('<meta property="og:type" content="website"');
    });
  });

  describe("LandingLayout og:image:alt from meta", () => {
    it("uses meta.ogImageAlt when provided", () => {
      const html = LandingLayout("<p>test</p>", undefined, {
        ...PageMeta["/"],
        ogImageAlt: "Agency for the Agentic Web",
      }).toString();
      expect(html).toContain('og:image:alt" content="Agency for the Agentic Web"');
    });

    it("falls back to default og:image:alt when not provided", () => {
      const html = LandingLayout("<p>test</p>", undefined, PageMeta["/"]).toString();
      expect(html).toContain("og:image:alt");
    });
  });
});

describe("SLICE-73-4: Brand mismatch fixes", () => {
  describe("og:image:alt branding", () => {
    it("LandingLayout default og:image:alt says 'Agency for the Agentic Web' not 'On-Chain Identity'", () => {
      const html = LandingLayout("<p>test</p>", undefined, PageMeta["/"]).toString();
      expect(html).toContain("Agency for the Agentic Web");
      expect(html).not.toContain("On-Chain Identity for AI Agents on Hedera");
    });

    it("Layout default og:image:alt says 'Agency for the Agentic Web' not 'On-Chain Identity'", () => {
      const html = Layout("<p>test</p>").toString();
      expect(html).toContain("Agency for the Agentic Web");
      expect(html).not.toContain("On-Chain Identity for AI Agents on Hedera");
    });
  });

  describe("Layout default title branding", () => {
    it("Layout() default title says 'Agency for the Agentic Web' not 'On-chain Identity'", () => {
      const html = Layout("<p>test</p>").toString();
      expect(html).toContain("Agency for the Agentic Web");
      expect(html).not.toContain("On-chain Identity for AI Agents on Hedera");
    });
  });

  describe("About page meta description branding", () => {
    it("About page description says 'agency for the agentic web' not 'on-chain identity'", () => {
      expect(PageMeta["/about"].description).toContain("agency for the agentic web");
      expect(PageMeta["/about"].description).not.toContain("on-chain identity for AI agents");
    });
  });

  describe("Noscript fallback text branding", () => {
    it("LandingLayout noscript says 'Agency for the Agentic Web' not 'On-Chain Identity'", () => {
      const html = LandingLayout("<p>test</p>", undefined, PageMeta["/"]).toString();
      expect(html).toContain("Agency for the Agentic Web");
      expect(html).not.toContain("On-Chain Identity for AI Agents");
    });

    it("Layout noscript says 'Agency for the Agentic Web' not 'On-Chain Identity'", () => {
      const html = Layout("<p>test</p>").toString();
      expect(html).toContain("Agency for the Agentic Web");
      expect(html).not.toContain("On-Chain Identity for AI Agents");
    });
  });
});
