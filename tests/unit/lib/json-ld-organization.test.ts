import { describe, it, expect } from "vitest";
import { organizationLd } from "../../../src/server/lib/json-ld";
import { SITE_NAME, SITE_DESCRIPTION, BASE_URL } from "../../../src/server/lib/page-meta";

/**
 * SLICE-112-8: Enhance organizationLd() canonical entity.
 *
 * Organization schema should include:
 * - logo as ImageObject (not plain string)
 * - sameAs array with at least 3 URLs
 * - contactPoint with email
 * - slogan field
 * - description field
 */
describe("SLICE-112-8: Enhanced organizationLd()", () => {
  const org = organizationLd() as Record<string, unknown>;

  it("returns @type: Organization", () => {
    expect(org["@type"]).toBe("Organization");
  });

  it("has name and url", () => {
    expect(org.name).toBe(SITE_NAME);
    expect(org.url).toBe(BASE_URL);
  });

  it("has logo as ImageObject (not plain string)", () => {
    const logo = org.logo as Record<string, unknown>;
    expect(logo).toBeDefined();
    expect(logo["@type"]).toBe("ImageObject");
    expect(logo.url).toMatch(/^https?:\/\//);
  });

  it("has sameAs array with at least 3 URLs", () => {
    const sameAs = org.sameAs as string[];
    expect(Array.isArray(sameAs)).toBe(true);
    expect(sameAs.length).toBeGreaterThanOrEqual(3);
    for (const url of sameAs) {
      expect(url).toMatch(/^https?:\/\//);
    }
  });

  it("has contactPoint with email", () => {
    const cp = org.contactPoint as Record<string, unknown>;
    expect(cp).toBeDefined();
    expect(cp["@type"]).toBe("ContactPoint");
    expect(cp.email).toBeDefined();
    expect(typeof cp.email).toBe("string");
    expect(cp.email).toContain("@");
  });

  it("has slogan field", () => {
    expect(org.slogan).toBeDefined();
    expect(typeof org.slogan).toBe("string");
    expect((org.slogan as string).length).toBeGreaterThan(0);
  });

  it("has description field", () => {
    expect(org.description).toBe(SITE_DESCRIPTION);
  });
});
