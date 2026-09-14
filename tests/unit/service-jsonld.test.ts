/**
 * SLICE-130-16: Service page Service JSON-LD tests.
 *
 * Verifies that service pages contain valid Service JSON-LD
 * with serviceType, provider, areaServed, and audience.
 */

import { describe, it, expect } from "vitest";

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

const { servicesRoutes } = await import("../../src/server/routes/services");

function extractJsonLdBlocks(html: string): object[] {
  const blocks: object[] = [];
  const regex = /<script type="application\/ld\+json">(.*?)<\/script>/gs;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) {
        blocks.push(...parsed);
      } else {
        blocks.push(parsed);
      }
    } catch {
      // skip unparseable
    }
  }
  return blocks;
}

describe("SLICE-130-16: Service page Service JSON-LD", () => {
  it("/services/scanner contains Service JSON-LD", async () => {
    const res = await servicesRoutes.request("/services/scanner");
    const html = await res.text();
    const blocks = extractJsonLdBlocks(html);
    const service = blocks.find((b: Record<string, unknown>) => b["@type"] === "Service");
    expect(service).toBeDefined();
  });

  it("Service has serviceType field", async () => {
    const res = await servicesRoutes.request("/services/scanner");
    const html = await res.text();
    const blocks = extractJsonLdBlocks(html);
    const service = blocks.find((b: Record<string, unknown>) => b["@type"] === "Service");
    expect(service.serviceType).toBeDefined();
    expect(service.serviceType).toContain("Audit");
  });

  it("Service has provider Organization", async () => {
    const res = await servicesRoutes.request("/services/scanner");
    const html = await res.text();
    const blocks = extractJsonLdBlocks(html);
    const service = blocks.find((b: Record<string, unknown>) => b["@type"] === "Service");
    expect(service.provider).toBeDefined();
    expect(service.provider["@type"]).toBe("Organization");
    expect(service.provider.name).toBe("AgentBadge");
  });

  it("Service has areaServed Worldwide", async () => {
    const res = await servicesRoutes.request("/services/scanner");
    const html = await res.text();
    const blocks = extractJsonLdBlocks(html);
    const service = blocks.find((b: Record<string, unknown>) => b["@type"] === "Service");
    expect(service.areaServed).toBe("Worldwide");
  });

  it("Service has audience field", async () => {
    const res = await servicesRoutes.request("/services/scanner");
    const html = await res.text();
    const blocks = extractJsonLdBlocks(html);
    const service = blocks.find((b: Record<string, unknown>) => b["@type"] === "Service");
    expect(service.audience).toBeDefined();
    expect(service.audience["@type"]).toBe("Audience");
  });

  it("/services/passports contains Service JSON-LD with serviceType", async () => {
    const res = await servicesRoutes.request("/services/passports");
    const html = await res.text();
    const blocks = extractJsonLdBlocks(html);
    const service = blocks.find((b: Record<string, unknown>) => b["@type"] === "Service");
    expect(service).toBeDefined();
    expect(service.serviceType).toBeDefined();
  });

  it("/services/marketplace contains Service JSON-LD with serviceType", async () => {
    const res = await servicesRoutes.request("/services/marketplace");
    const html = await res.text();
    const blocks = extractJsonLdBlocks(html);
    const service = blocks.find((b: Record<string, unknown>) => b["@type"] === "Service");
    expect(service).toBeDefined();
    expect(service.serviceType).toBeDefined();
  });

  it("all Service JSON-LD blocks parse cleanly", async () => {
    const res = await servicesRoutes.request("/services/scanner");
    const html = await res.text();
    const blocks = extractJsonLdBlocks(html);
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      expect((b)["@context"]).toBeDefined();
    }
  });
});
