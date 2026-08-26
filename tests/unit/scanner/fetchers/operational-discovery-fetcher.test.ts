import { describe, it, expect } from "vitest";
import { fetchOperationalDiscovery } from "../../../../src/agent-readiness/scanner/fetchers/operational-discovery-fetcher";

describe("operational-discovery-fetcher", () => {
  it("returns no_data when homepage snapshot is null", async () => {
    const result = await fetchOperationalDiscovery("https://example.com", null);
    expect(result.status).toBe("no_data");
  });

  it("returns not_found when no LocalBusiness JSON-LD present", async () => {
    const htmlSnapshot = {
      body: '<html><head><script type="application/ld+json">{"@type":"WebSite","name":"Test"}</script></head></html>',
    };
    const result = await fetchOperationalDiscovery("https://example.com", htmlSnapshot as any);
    expect(result.status).toBe("not_found");
  });

  it("extracts LocalBusiness properties from JSON-LD", async () => {
    const jsonld = {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name: "Joe's Pizza",
      address: {
        "@type": "PostalAddress",
        streetAddress: "123 Main St",
        addressLocality: "Anytown",
        addressRegion: "CA",
        postalCode: "12345",
      },
      openingHours: "Mo-Sa 09:00-22:00",
      telephone: "+1-555-123-4567",
    };
    const htmlSnapshot = {
      body: `<html><head><script type="application/ld+json">${JSON.stringify(jsonld)}</script></head></html>`,
    };
    const result = await fetchOperationalDiscovery("https://example.com", htmlSnapshot as any);
    expect(result.status).toBe("found");
    expect(result.business?.name).toBe("Joe's Pizza");
    expect(result.business?.openingHours).toBe("Mo-Sa 09:00-22:00");
    expect(result.business?.telephone).toBe("+1-555-123-4567");
  });

  it("detects LocalBusiness subtypes (Restaurant, Store)", async () => {
    const jsonld = { "@type": "Restaurant", name: "Cafe Misto" };
    const htmlSnapshot = {
      body: `<html><head><script type="application/ld+json">${JSON.stringify(jsonld)}</script></head></html>`,
    };
    const result = await fetchOperationalDiscovery("https://example.com", htmlSnapshot as any);
    expect(result.status).toBe("found");
    expect(result.business?.name).toBe("Cafe Misto");
    expect(result.businessType).toBe("Restaurant");
  });

  it("validates required properties", async () => {
    const jsonld = { "@type": "LocalBusiness" };
    const htmlSnapshot = {
      body: `<html><head><script type="application/ld+json">${JSON.stringify(jsonld)}</script></head></html>`,
    };
    const result = await fetchOperationalDiscovery("https://example.com", htmlSnapshot as any);
    expect(result.status).toBe("found");
    expect(result.validation.missingRequired).toContain("name");
  });

  it("handles multiple JSON-LD blocks", async () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type":"WebSite","name":"Test"}</script>
      <script type="application/ld+json">{"@type":"LocalBusiness","name":"Shop"}</script>
    </head></html>`;
    const result = await fetchOperationalDiscovery("https://example.com", { body: html } as any);
    expect(result.status).toBe("found");
    expect(result.business?.name).toBe("Shop");
  });
});
