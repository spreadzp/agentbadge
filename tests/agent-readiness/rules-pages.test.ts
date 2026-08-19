import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { contentPageRoutes } from "../../src/server/routes/content-pages";
import { rulesApiRoutes } from "../../src/server/routes/rules-api";

const app = new Hono();
app.route("/", contentPageRoutes);
app.route("/api", rulesApiRoutes);

describe("Rules Catalog Page (SLICE-50-2)", () => {
  it("GET /rules returns 200 with HTML", async () => {
    const res = await app.request("/rules");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("What We Check");
    expect(html).toContain("76 rules");
    expect(html).toContain("15 categories");
  });

  it("contains all 15 category sections", async () => {
    const res = await app.request("/rules");
    const html = await res.text();
    const categories = [
      "Discovery",
      "Documentation",
      "Actionability",
      "Machine-Readable",
      "Verification",
      "Content Negotiation",
      "Payments",
      "Bazaar",
      "OpenAPI",
      "Skills",
      "Agents.txt",
      "WebMCP",
      "Identity",
      "Bot Authentication",
      "Infrastructure",
    ];
    for (const cat of categories) {
      expect(html).toContain(cat);
    }
  });

  it("contains links to individual rule pages", async () => {
    const res = await app.request("/rules");
    const html = await res.text();
    expect(html).toContain('href="/rules/AB-001"');
    expect(html).toContain('href="/rules/AB-078"');
    expect(html).toContain('href="/rules/AB-056"');
  });

  it("includes FAQPage JSON-LD structured data", async () => {
    const res = await app.request("/rules");
    const html = await res.text();
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain("What is the Discovery category?");
  });

  it("has canonical URL and og tags", async () => {
    const res = await app.request("/rules");
    const html = await res.text();
    expect(html).toContain('rel="canonical" href="https://agentbadge.xyz/rules"');
    expect(html).toContain('og:title" content="Rules Catalog');
  });
});

describe("Rule Detail Page (SLICE-50-3)", () => {
  it("GET /rules/AB-001 returns 200 with rule content", async () => {
    const res = await app.request("/rules/AB-001");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("AB-001");
    expect(html).toContain("Robots.txt File");
    expect(html).toContain("What it means");
    expect(html).toContain("Why it matters");
    expect(html).toContain("What's wrong");
    expect(html).toContain("What's right");
  });

  it("GET /rules/AB-056 returns 200 with identity content", async () => {
    const res = await app.request("/rules/AB-056");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("AB-056");
    expect(html).toContain("WebFinger Identity Lookup");
  });

  it("GET /rules/INVALID returns 404", async () => {
    const res = await app.request("/rules/INVALID");
    expect(res.status).toBe(404);
  });

  it("GET /rules/AB-999 returns 404", async () => {
    const res = await app.request("/rules/AB-999");
    expect(res.status).toBe(404);
  });

  it("includes Article JSON-LD structured data", async () => {
    const res = await app.request("/rules/AB-001");
    const html = await res.text();
    expect(html).toContain('"@type":"Article"');
    expect(html).toContain("Robots.txt File");
  });

  it("has canonical URL for rule page", async () => {
    const res = await app.request("/rules/AB-001");
    const html = await res.text();
    expect(html).toContain('rel="canonical" href="https://agentbadge.xyz/rules/AB-001"');
  });

  it("shows related rules from same category", async () => {
    const res = await app.request("/rules/AB-001");
    const html = await res.text();
    expect(html).toContain("Related rules");
    expect(html).toContain('href="/rules/AB-002"');
  });

  it("has breadcrumbs", async () => {
    const res = await app.request("/rules/AB-001");
    const html = await res.text();
    expect(html).toContain('href="/rules"');
    expect(html).toContain("AB-001");
  });
});

describe("Rules JSON API (SLICE-50-4)", () => {
  it("GET /api/rules returns 200 with JSON", async () => {
    const res = await app.request("/api/rules");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const data = await res.json();
    expect(data.total).toBe(76);
    expect(data.categories.length).toBe(15);
    expect(data.rules.length).toBe(76);
  });

  it("GET /api/rules/AB-001 returns 200 with rule", async () => {
    const res = await app.request("/api/rules/AB-001");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.rule_id).toBe("AB-001");
    expect(data.title).toBe("Robots.txt File");
    expect(data.category).toBe("discovery");
  });

  it("GET /api/rules/INVALID returns 404", async () => {
    const res = await app.request("/api/rules/INVALID");
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Rule not found");
  });

  it("categories include rule counts", async () => {
    const res = await app.request("/api/rules");
    const data = await res.json();
    const discovery = data.categories.find((c: any) => c.id === "discovery");
    expect(discovery.rule_count).toBe(8);
    expect(discovery.icon).toBeTruthy();
    expect(discovery.title).toBeTruthy();
  });
});

describe("Rules Navigation (SLICE-50-5)", () => {
  it("footer contains Rules link", async () => {
    const res = await app.request("/rules");
    const html = await res.text();
    expect(html).toContain('href="/rules"');
  });

  it("catalog page links to scan CTA", async () => {
    const res = await app.request("/rules");
    const html = await res.text();
    expect(html).toContain('href="/#scan"');
  });

  it("detail page links back to catalog", async () => {
    const res = await app.request("/rules/AB-001");
    const html = await res.text();
    expect(html).toContain("Back to all rules");
    expect(html).toContain('href="/rules"');
  });
});
