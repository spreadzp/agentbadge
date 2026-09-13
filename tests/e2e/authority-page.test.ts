import { describe, it, expect } from "vitest";
const BASE = "http://localhost:4021";

describe("Authority page — /what-is-agent-readiness (SLICE-111-2)", () => {
  it("GET /what-is-agent-readiness returns 200", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    expect(res.status).toBe(200);
  });

  it("GET /what-is-agent-readiness has canonical URL", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/agentbadge\.xyz\/what-is-agent-readiness"/);
  });

  it("GET /what-is-agent-readiness has meta description", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toMatch(/<meta name="description" content=".*Agent Readiness is the degree to which/);
  });

  it("GET /what-is-agent-readiness has Article JSON-LD", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toContain('"@type":"Article"');
  });

  it("GET /what-is-agent-readiness has og:type article", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toMatch(/<meta property="og:type" content="article"/);
  });

  it("GET /what-is-agent-readiness contains editorial content", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toContain("What Is Agent Readiness");
  });

  it("GET /what-is-agent-readiness contains markdown body", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toContain("Agent Readiness is the degree to which");
  });

  it("GET /agent-readiness redirects to /what-is-agent-readiness with 301", async () => {
    const res = await fetch(`${BASE}/agent-readiness`, { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/what-is-agent-readiness");
  });

  // SLICE-111-3: Dynamic facts injection
  it("GET /what-is-agent-readiness has dynamic rule count (no {{RULE_COUNT}} placeholder)", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).not.toContain("{{RULE_COUNT}}");
    expect(html).toMatch(/\d+ rules across \d+ categories/);
  });

  it("GET /what-is-agent-readiness has dynamic category count", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).not.toContain("{{CATEGORY_COUNT}}");
  });

  it("GET /what-is-agent-readiness has dynamic pillar count", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).not.toContain("{{PILLAR_COUNT}}");
    expect(html).toMatch(/\d+ pillars/);
  });

  it("GET /what-is-agent-readiness has last updated date (no {{LAST_UPDATED}} placeholder)", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).not.toContain("{{LAST_UPDATED}}");
    expect(html).toMatch(/Last updated: \d{4}-\d{2}-\d{2}/);
  });

  it("GET /what-is-agent-readiness has no unreplaced placeholders", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  // SLICE-111-4: PageMeta, Sitemap, JSON-LD
  it("GET /what-is-agent-readiness has DefinedTermSet JSON-LD", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toContain('"@type":"DefinedTermSet"');
    expect(html).toContain('"Agent Readiness"');
  });

  it("GET /what-is-agent-readiness has 4 pillar DefinedTerms", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toContain('"Discovery"');
    expect(html).toContain('"Understandability"');
    expect(html).toContain('"Executability"');
    expect(html).toContain('"Verifiability"');
  });

  it("GET /what-is-agent-readiness has Article schema with datePublished", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toContain('"@type":"Article"');
    expect(html).toMatch(/"datePublished":"\d{4}-\d{2}-\d{2}"/);
  });

  it("GET /sitemap.xml includes /what-is-agent-readiness", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const xml = await res.text();
    expect(xml).toContain("/what-is-agent-readiness");
  });

  it("GET /sitemap.xml has priority 0.9 for /what-is-agent-readiness", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const xml = await res.text();
    const entry = xml.match(/<loc>[^<]*\/what-is-agent-readiness<\/loc>[\s\S]*?<\/url>/);
    expect(entry).toBeTruthy();
    expect(entry![0]).toContain("<priority>0.9</priority>");
  });

  it("GET /what-is-agent-readiness does NOT include /agent-readiness in sitemap", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const xml = await res.text();
    // /agent-readiness is a redirect, should not be in sitemap
    expect(xml).not.toMatch(/<loc>[^<]*\/agent-readiness<\/loc>/);
  });

  // SLICE-111-5: Markdown rendering (md → HTML with prose styling)
  it("GET /what-is-agent-readiness renders markdown as HTML (not in <pre>)", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    // Should not have <pre> wrapping the content
    expect(html).not.toContain("whitespace-pre-wrap text-sm text-slate-300 bg-slate-900/50");
  });

  it("GET /what-is-agent-readiness has rendered h2 headings", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toContain("<h2>");
    expect(html).toMatch(/<h2[^>]*>Definition<\/h2>/);
  });

  it("GET /what-is-agent-readiness has rendered tables", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
  });

  it("GET /what-is-agent-readiness has rendered lists", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>");
  });

  it("GET /what-is-agent-readiness has rendered code blocks", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toContain("<code>");
  });

  it("GET /what-is-agent-readiness has prose styling classes", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toContain("prose");
    expect(html).toContain("prose-invert");
  });

  // SLICE-111-6: Comprehensive E2E — content structure, FAQ, SEO completeness
  it("GET /what-is-agent-readiness has all required section headings", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    const requiredSections = [
      "Definition",
      "Why Agent Readiness Matters",
      "Agent Readiness vs SEO",
      "Agent Readiness vs GEO",
      "OpenAPI Is Not Enough",
      "How AgentBadge Measures Readiness",
      "How to Check Your API",
      "FAQ",
      "Related Resources",
    ];
    for (const section of requiredSections) {
      expect(html).toContain(section);
    }
  });

  it("GET /what-is-agent-readiness has 4 pillar subheadings", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toMatch(/<h3[^>]*>Discovery<\/h3>/);
    expect(html).toMatch(/<h3[^>]*>Understandability<\/h3>/);
    expect(html).toMatch(/<h3[^>]*>Executability<\/h3>/);
    expect(html).toMatch(/<h3[^>]*>Verifiability<\/h3>/);
  });

  it("GET /what-is-agent-readiness has comparison tables (SEO and GEO)", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    const tableCount = (html.match(/<table>/g) || []).length;
    expect(tableCount).toBeGreaterThanOrEqual(2);
  });

  it("GET /what-is-agent-readiness has FAQ section with questions", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    // FAQ section should contain question-like content
    expect(html).toMatch(/FAQ/);
    // Check for at least 3 FAQ entries (h3 or strong within FAQ area)
    const faqHeadings = html.match(/<h3[^>]*>[^<]*<\/h3>/g) || [];
    expect(faqHeadings.length).toBeGreaterThanOrEqual(3);
  });

  it("GET /what-is-agent-readiness has og:title meta tag", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toMatch(/<meta property="og:title" content="[^"]*Agent Readiness/);
  });

  it("GET /what-is-agent-readiness has og:url meta tag", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toMatch(/<meta property="og:url" content="https:\/\/agentbadge\.xyz\/what-is-agent-readiness"/);
  });

  it("GET /what-is-agent-readiness has twitter:card meta tag", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toMatch(/<meta name="twitter:card"/);
  });

  it("GET /what-is-agent-readiness returns text/html content-type", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const ct = res.headers.get("content-type");
    expect(ct).toContain("text/html");
  });

  it("GET /what-is-agent-readiness has robots meta tag", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toMatch(/<meta name="robots" content="[^"]*"/);
  });

  it("GET /what-is-agent-readiness has LandingLayout shell (html, head, body)", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("<head>");
    expect(html).toContain("<body");
    expect(html).toContain("</html>");
  });

  it("GET /what-is-agent-readiness dynamic facts show actual numbers (not zeros)", async () => {
    const res = await fetch(`${BASE}/what-is-agent-readiness`);
    const html = await res.text();
    // Rule count should be > 0
    const ruleMatch = html.match(/(\d+) rules across (\d+) categories/);
    expect(ruleMatch).toBeTruthy();
    expect(Number(ruleMatch![1])).toBeGreaterThan(0);
    expect(Number(ruleMatch![2])).toBeGreaterThan(0);
    // Pillar count should be 4
    const pillarMatch = html.match(/(\d+) pillars/);
    expect(pillarMatch).toBeTruthy();
    expect(Number(pillarMatch![1])).toBe(4);
  });

  it("GET /agent-readiness redirect is permanent (301)", async () => {
    const res = await fetch(`${BASE}/agent-readiness`, { redirect: "manual" });
    expect(res.status).toBe(301);
    const location = res.headers.get("location");
    expect(location).toBe("/what-is-agent-readiness");
  });
});
