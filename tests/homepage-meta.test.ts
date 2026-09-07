import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { LandingLayout } from "../src/views/landing/layout";
import { PageMeta } from "../src/server/lib/page-meta";
import { landingJsonLd } from "../src/server/lib/json-ld";
import { ReadinessHeroSection } from "../src/views/landing/sections/readiness-hero";
import { ReadinessImmediateProofSection } from "../src/views/landing/sections/readiness-immediate-proof";
import { ReadinessConceptualFlowSection } from "../src/views/landing/sections/readiness-conceptual-flow";
import { ReadinessAgentReadyProofSection } from "../src/views/landing/sections/readiness-agent-ready-proof";
import { ReadinessLandingPage } from "../src/views/landing/readiness-landing-page";
import { ReadinessPassportSecondarySection } from "../src/views/landing/sections/readiness-passport-secondary";
import { RULE_DESCRIPTIONS } from "../src/agent-readiness/rule-descriptions";

describe("Homepage meta fixes", () => {
  let app: Hono;

  beforeAll(() => {
    app = new Hono();
    // Serve favicon.svg statically
    app.use("/favicon.svg", (c, next) => {
      c.header("Cache-Control", "public, max-age=86400");
      c.header("Content-Type", "image/svg+xml");
      return next();
    }, serveStatic({ root: "./public", path: "/favicon.svg" }));

    // Homepage route
    app.get("/", (c) => {
      const meta = PageMeta["/"];
      const html = LandingLayout("content", undefined, meta, []);
      return c.html(html.toString());
    });
  });

  it("has SVG favicon link in HTML", async () => {
    const res = await app.request("/");
    const html = await res.text();

    expect(html).toMatch(/rel=["']icon["'].*type=["']image\/svg\+xml["']/);
    expect(html).toContain("/favicon.svg");
  });

  it("favicon.svg is reachable", async () => {
    const res = await app.request("/favicon.svg");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
  });

  it("canonical URL points to production domain", async () => {
    const res = await app.request("/");
    const html = await res.text();
    const canonicalMatch = html.match(/<link rel=["']canonical["'] href="([^"]+)"/);
    expect(canonicalMatch).toBeTruthy();
    expect(canonicalMatch![1]).toContain("agentbadge.xyz");
    expect(canonicalMatch![1]).not.toContain("localhost");
  });

  it("og:image URL contains agentbadge.xyz", async () => {
    const res = await app.request("/");
    const html = await res.text();
    const ogMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
    expect(ogMatch).toBeTruthy();
    expect(ogMatch![1]).toContain("agentbadge.xyz");
  });
});

describe("SLICE-110-2: Hero repositioning", () => {
  it("renders H1 with 'Can AI Agents Actually Use Your API?'", () => {
    const html = ReadinessHeroSection().toString();
    expect(html).toContain("Can AI Agents Actually");
    expect(html).toContain("Use Your API?");
  });

  it("subtitle contains 'Agent Readiness'", () => {
    const html = ReadinessHeroSection().toString();
    expect(html).toContain("Agent Readiness");
  });

  it("primary CTA links to /services/scanner", () => {
    const html = ReadinessHeroSection().toString();
    expect(html).toContain('href="/services/scanner"');
    expect(html).toContain("Scan Your API");
  });
});

describe("SLICE-110-3: Immediate proof section", () => {
  it("renders with correct rule count from RULE_DESCRIPTIONS", () => {
    const html = ReadinessImmediateProofSection().toString();
    expect(html).toContain(`${RULE_DESCRIPTIONS.length}+`);
  });

  it("contains 'evidence-based' text", () => {
    const html = ReadinessImmediateProofSection().toString();
    expect(html).toContain("evidence-based");
  });

  it("contains 'WebMCP' text", () => {
    const html = ReadinessImmediateProofSection().toString();
    expect(html).toContain("WebMCP");
  });
});

describe("SLICE-110-4: Conceptual flow section", () => {
  it("renders all 4 steps: Discover, Understand, Access, Act", () => {
    const html = ReadinessConceptualFlowSection().toString();
    expect(html).toContain("Discover");
    expect(html).toContain("Understand");
    expect(html).toContain("Access");
    expect(html).toContain("Act");
  });

  it("each step has icon and description", () => {
    const html = ReadinessConceptualFlowSection().toString();
    expect(html).toContain("🔍");
    expect(html).toContain("📖");
    expect(html).toContain("🔑");
    expect(html).toContain("⚡");
    expect(html).toContain("llms.txt");
    expect(html).toContain("OpenAPI");
    expect(html).toContain("x402");
    expect(html).toContain("idempotency");
  });

  it("flow order is Discover → Understand → Access → Act", () => {
    const html = ReadinessConceptualFlowSection().toString();
    const discoverIdx = html.indexOf("Discover");
    const understandIdx = html.indexOf("Understand");
    const accessIdx = html.indexOf("Access");
    const actIdx = html.indexOf("Act");
    expect(discoverIdx).toBeLessThan(understandIdx);
    expect(understandIdx).toBeLessThan(accessIdx);
    expect(accessIdx).toBeLessThan(actIdx);
  });
});

describe("SLICE-110-5: Agent-ready proof block", () => {
  it("renders checklist with 6+ items", () => {
    const html = ReadinessAgentReadyProofSection().toString();
    const checkCount = (html.match(/✓/g) || []).length;
    expect(checkCount).toBeGreaterThanOrEqual(6);
  });

  it("contains 'agent-ready' statement", () => {
    const html = ReadinessAgentReadyProofSection().toString();
    expect(html).toContain("agent-ready");
    expect(html).toContain("We built AgentBadge");
  });

  it("each item has ✓ icon", () => {
    const html = ReadinessAgentReadyProofSection().toString();
    expect(html).toContain("✓");
    expect(html).toContain("/llms.txt");
    expect(html).toContain("/agent-guide");
    expect(html).toContain("/openapi.json");
    expect(html).toContain("webmcp.json");
  });
});

describe("SLICE-110-6: Section repositioning", () => {
  it("all sections present in landing page", () => {
    const html = ReadinessLandingPage().toString();
    expect(html).toContain('id="scan"');
    expect(html).toContain("Immediate Proof");
    expect(html).toContain("Conceptual Model");
    expect(html).toContain("Agent-Ready Proof");
    expect(html).toContain('id="pricing"');
  });

  it("section order: Hero → ImmediateProof → ConceptualFlow → How → AgentReadyProof", () => {
    const html = ReadinessLandingPage().toString();
    const heroIdx = html.indexOf('id="scan"');
    const proofIdx = html.indexOf("Immediate Proof");
    const flowIdx = html.indexOf("Conceptual Model");
    const howIdx = html.indexOf('id="how"');
    const agentReadyIdx = html.indexOf("Agent-Ready Proof");
    expect(heroIdx).toBeLessThan(proofIdx);
    expect(proofIdx).toBeLessThan(flowIdx);
    expect(flowIdx).toBeLessThan(howIdx);
    expect(howIdx).toBeLessThan(agentReadyIdx);
  });
});

describe("SLICE-110-7: Passport secondary block", () => {
  it("renders H2 'Verify Agent Identity'", () => {
    const html = ReadinessPassportSecondarySection().toString();
    expect(html).toContain("Verify Agent Identity");
  });

  it("CTA links to /passport", () => {
    const html = ReadinessPassportSecondarySection().toString();
    expect(html).toContain('href="/passport"');
    expect(html).toContain("Learn about Agent Passports");
  });

  it("contains Agent Readiness and Agent Passport distinction", () => {
    const html = ReadinessPassportSecondarySection().toString();
    expect(html).toContain("Agent Readiness");
    expect(html).toContain("Agent Passport");
    expect(html).toContain("verifiable identity");
  });
});

describe("SLICE-110-1: PageMeta & SEO metadata for /", () => {
  it("PageMeta / has scanner-first title", () => {
    const meta = PageMeta["/"];
    expect(meta).toBeDefined();
    expect(meta.title).toContain("Agent Readiness Scanner");
    expect(meta.title).toContain("AgentBadge");
  });

  it("PageMeta / description mentions 145+ checks and evidence-based scoring", () => {
    const meta = PageMeta["/"];
    expect(meta.description).toContain("145+");
    expect(meta.description).toContain("evidence-based");
    expect(meta.description).toContain("scan");
  });

  it("PageMeta / path is /", () => {
    const meta = PageMeta["/"];
    expect(meta.path).toBe("/");
  });

  it("landingJsonLd returns Organization + SoftwareApplication + WebSite schemas", () => {
    const schemas = landingJsonLd() as { "@type": string }[];
    const types = schemas.map((s) => s["@type"]);
    expect(types).toContain("SoftwareApplication");
    expect(types).toContain("WebSite");
    expect(types).toContain("Organization");
  });
});
