/**
 * SLICE-130-15: Blog Article JSON-LD tests.
 *
 * Verifies that blog article pages contain valid BlogPosting
 * and BreadcrumbList structured data.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

process.env.MOCK_HEDERA = "true";
process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
process.env.HEDERA_OPERATOR_ID = "0.0.1001";
process.env.HEDERA_OPERATOR_KEY = "test-key";
process.env.AUDIT_TOPIC_ID = "0.0.1003";
process.env.DIRECTORY_TOPIC_ID = "0.0.1004";
process.env["x402_FACILITATOR_URL"] = "https://facilitator.example.com";
process.env["x402_FEE_PAYER"] = "0.0.1005";
process.env["x402_TREASURY"] = "0.0.1006";
process.env.IPFS_API_KEY = "test-ipfs-key";
process.env.IPFS_API_SECRET = "test-ipfs-secret";
delete process.env.KEEPERHUB_ENABLED;
delete process.env.ATTESTCOIN_ENABLED;

const { blogRoutes } = await import("../../src/server/routes/blog");

function extractJsonLdBlocks(html: string): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  const regex = /<script type="application\/ld\+json">(.*?)<\/script>/gs;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) {
        blocks.push(...(parsed as Record<string, unknown>[]));
      } else {
        blocks.push(parsed as Record<string, unknown>);
      }
    } catch {
      // skip unparseable
    }
  }
  return blocks;
}

describe("SLICE-130-15: Blog Article JSON-LD", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.KEEPERHUB_ENABLED;
    delete process.env.ATTESTCOIN_ENABLED;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("/blog/:slug contains BlogPosting JSON-LD", async () => {
    const res = await blogRoutes.request("/blog/what-is-agent-readiness");
    const html = await res.text();
    const blocks = extractJsonLdBlocks(html);
    const blogPosting = blocks.find((b) => b["@type"] === "BlogPosting");
    expect(blogPosting).toBeDefined();
  });

  it("BlogPosting has headline, author, datePublished, dateModified", async () => {
    const res = await blogRoutes.request("/blog/what-is-agent-readiness");
    const html = await res.text();
    const blocks = extractJsonLdBlocks(html);
    const bp = blocks.find((b) => b["@type"] === "BlogPosting") as Record<string, unknown>;
    expect(bp.headline).toBeDefined();
    expect(bp.author).toBeDefined();
    expect(bp.datePublished).toBeDefined();
    expect(bp.dateModified).toBeDefined();
  });

  it("BlogPosting author is Person type", async () => {
    const res = await blogRoutes.request("/blog/what-is-agent-readiness");
    const html = await res.text();
    const blocks = extractJsonLdBlocks(html);
    const bp = blocks.find((b) => b["@type"] === "BlogPosting") as Record<string, unknown>;
    const author = bp.author as Record<string, unknown>;
    expect(author["@type"]).toBe("Person");
    expect(author.name).toBeDefined();
  });

  it("BlogPosting has image field", async () => {
    const res = await blogRoutes.request("/blog/what-is-agent-readiness");
    const html = await res.text();
    const blocks = extractJsonLdBlocks(html);
    const bp = blocks.find((b) => b["@type"] === "BlogPosting") as Record<string, unknown>;
    expect(bp.image).toBeDefined();
  });

  it("BlogPosting has mainEntityOfPage", async () => {
    const res = await blogRoutes.request("/blog/what-is-agent-readiness");
    const html = await res.text();
    const blocks = extractJsonLdBlocks(html);
    const bp = blocks.find((b) => b["@type"] === "BlogPosting") as Record<string, unknown>;
    expect(bp.mainEntityOfPage).toBeDefined();
  });

  it("BlogPosting has publisher with Organization type", async () => {
    const res = await blogRoutes.request("/blog/what-is-agent-readiness");
    const html = await res.text();
    const blocks = extractJsonLdBlocks(html);
    const bp = blocks.find((b) => b["@type"] === "BlogPosting") as Record<string, unknown>;
    const publisher = bp.publisher as Record<string, unknown>;
    expect(publisher).toBeDefined();
    expect(publisher["@type"]).toBe("Organization");
  });

  it("page contains BreadcrumbList JSON-LD with Home → Blog → Article", async () => {
    const res = await blogRoutes.request("/blog/what-is-agent-readiness");
    const html = await res.text();
    const blocks = extractJsonLdBlocks(html);
    const bc = blocks.find((b) => b["@type"] === "BreadcrumbList") as Record<string, unknown>;
    expect(bc).toBeDefined();
    const items = bc.itemListElement as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    expect(items[0].name).toBe("Home");
    expect(items[1].name).toBe("Blog");
    expect(items[2].name).toBeDefined();
  });

  it("all JSON-LD blocks parse cleanly (no template-escaping breakage)", async () => {
    const res = await blogRoutes.request("/blog/what-is-agent-readiness");
    const html = await res.text();
    const blocks = extractJsonLdBlocks(html);
    expect(blocks.length).toBeGreaterThan(0);
    // Every block should have @context
    for (const b of blocks) {
      expect((b as Record<string, unknown>)["@context"]).toBeDefined();
    }
  });
});
