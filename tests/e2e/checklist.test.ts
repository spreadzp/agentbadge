import { describe, it, expect } from "vitest";
import { RULE_DESCRIPTIONS, CATEGORY_DESCRIPTIONS, PILLAR_DESCRIPTIONS } from "../../src/agent-readiness/rule-descriptions";
import { CORE_RULE_IDS } from "../../src/agent-readiness/core-rules";
import { PILLAR_CATEGORIES } from "../../src/agent-readiness/scoring/pillar-map";
const BASE = "http://localhost:4021";

describe("SLICE-114-3: /agent-readiness-checklist route + JSON-LD", () => {
  it("GET /agent-readiness-checklist returns 200", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    expect(res.status).toBe(200);
  });

  it("GET /agent-readiness-checklist returns text/html", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("GET /agent-readiness-checklist has title with 'Agent Readiness Checklist'", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toMatch(/<title>[^<]*Agent Readiness Checklist/);
  });

  it("GET /agent-readiness-checklist has canonical URL", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/agentbadge\.xyz\/agent-readiness-checklist"/);
  });

  it("GET /agent-readiness-checklist has meta description", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toMatch(/<meta name="description" content="[^"]*checklist/);
  });

  it("GET /agent-readiness-checklist has ItemList JSON-LD", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toContain('"@type":"ItemList"');
    expect(html).toContain('"numberOfItems"');
  });

  it("GET /agent-readiness-checklist has BreadcrumbList JSON-LD", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toContain('"@type":"BreadcrumbList"');
  });

  it("GET /agent-readiness-checklist has CollectionPage JSON-LD", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toContain('"@type":"CollectionPage"');
  });

  it("GET /agent-readiness-checklist has all rule anchors", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toContain('id="AB-001"');
    expect(html).toContain('id="AB-002"');
    expect(html).toContain('id="AB-003"');
  });

  it("GET /agent-readiness-checklist has Core badges", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toContain("Core");
  });

  it("GET /agent-readiness-checklist has pillar sections", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toContain("Discovery");
    expect(html).toContain("Understandability");
    expect(html).toContain("Executability");
    expect(html).toContain("Verifiability");
  });

  it("GET /agent-readiness-checklist has CTA link", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toContain('href="/#scan"');
  });

  it("GET /sitemap.xml includes /agent-readiness-checklist", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const xml = await res.text();
    expect(xml).toContain("/agent-readiness-checklist");
  });

  it("GET /rules contains link to /agent-readiness-checklist", async () => {
    const res = await fetch(`${BASE}/rules`);
    const html = await res.text();
    expect(html).toContain('href="/agent-readiness-checklist"');
  });

  it("GET /rules link text contains 'checklist'", async () => {
    const res = await fetch(`${BASE}/rules`);
    const html = await res.text();
    expect(html).toMatch(/checklist/i);
  });
});

describe("SLICE-114-5: Comprehensive E2E tests", () => {
  it("response contains <h1> with 'Agent Readiness Checklist'", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toMatch(/<h1[^>]*>[^<]*Agent Readiness Checklist/);
  });

  it("response contains all rule IDs as id= anchors", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    for (const rule of RULE_DESCRIPTIONS) {
      expect(html).toContain(`id="${rule.rule_id}"`);
    }
  });

  it("response contains links to /rules/AB-XXX for all rules", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    for (const rule of RULE_DESCRIPTIONS) {
      expect(html).toContain(`href="/rules/${rule.rule_id}"`);
    }
  });

  it("response contains at least 20 'Core' badge occurrences", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    const coreCount = (html.match(/>Core</g) || []).length;
    expect(coreCount).toBeGreaterThanOrEqual(CORE_RULE_IDS.length);
  });

  it("response contains all 4 pillar section IDs", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toContain('id="pillar-discovery"');
    expect(html).toContain('id="pillar-understandability"');
    expect(html).toContain('id="pillar-executability"');
    expect(html).toContain('id="pillar-verifiability"');
  });

  it("response contains pillar questions", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    for (const pillar of Object.values(PILLAR_DESCRIPTIONS)) {
      expect(html).toContain(pillar.question);
    }
  });

  it("response contains all category titles for categories with rules", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    const categoriesWithRules = new Set(RULE_DESCRIPTIONS.map((r) => r.category));
    for (const cat of categoriesWithRules) {
      const desc = CATEGORY_DESCRIPTIONS[cat];
      if (desc) expect(html).toContain(desc.title);
    }
  });

  it("categories are in collapsible <details> elements", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    const detailsCount = (html.match(/<details/g) || []).length;
    expect(detailsCount).toBeGreaterThanOrEqual(10);
  });

  it("ItemList JSON-LD has correct numberOfItems matching rule count", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toContain(`"numberOfItems":${RULE_DESCRIPTIONS.length}`);
  });

  it("ItemList contains ListItem entries with position, name, url", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toContain('"@type":"ListItem"');
    expect(html).toContain('"position":1');
    expect(html).toContain('"position":2');
  });

  it("response contains Organization JSON-LD from defaultCoreSchemas", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toContain('"@type":"Organization"');
  });

  it("response contains editorial intro text", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toContain("How to Use This Checklist");
    expect(html).toContain("How Scoring Works");
    expect(html).toContain("Core Rules vs Advanced Rules");
  });

  it("intro contains link to /what-is-agent-readiness", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toContain('href="/what-is-agent-readiness"');
  });

  it("intro contains link to /faq", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toContain('href="/faq"');
  });

  it("intro contains link to /blog", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toContain('href="/blog"');
  });

  it("response contains 'Scan Your Site' CTA text", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toContain("Scan Your Site");
  });

  it("response contains Layout shell (DOCTYPE, html, head, body)", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("<head>");
    expect(html).toContain("<body");
  });

  it("response has og:title meta tag", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toContain('property="og:title"');
  });

  it("response has og:url meta tag", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toContain('property="og:url"');
  });

  it("response has twitter:card meta tag", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toContain('name="twitter:card"');
  });

  it("response has robots meta tag", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toMatch(/<meta name="robots"/);
  });

  it("response contains effort labels (Quick fix, Moderate, Complex)", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toContain("Quick fix");
    expect(html).toContain("Moderate");
    expect(html).toContain("Complex");
  });

  it("response contains progress summary with rule count", async () => {
    const res = await fetch(`${BASE}/agent-readiness-checklist`);
    const html = await res.text();
    expect(html).toContain(`${RULE_DESCRIPTIONS.length} rules`);
    expect(html).toContain(`${CORE_RULE_IDS.length} core`);
  });
});
