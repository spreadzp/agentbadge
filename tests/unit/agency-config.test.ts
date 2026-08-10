import { describe, it, expect } from "vitest";
import {
  AGENCY_SERVICES,
  getAgencyService,
  AGENCY_BRAND,
} from "../../src/server/lib/agency-config";

describe("Agency Config (SLICE-51-1)", () => {
  it("defines at least 3 services", () => {
    expect(AGENCY_SERVICES.length).toBeGreaterThanOrEqual(3);
  });

  it("each service has required fields", () => {
    for (const s of AGENCY_SERVICES) {
      expect(s.id).toBeTruthy();
      expect(s.name).toBeTruthy();
      expect(s.tagline).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(s.url).toMatch(/^\/services\//);
      expect(s.icon).toBeTruthy();
      expect(s.features.length).toBeGreaterThan(0);
    }
  });

  it("has scanner, passports, marketplace services", () => {
    const ids = AGENCY_SERVICES.map((s) => s.id);
    expect(ids).toContain("scanner");
    expect(ids).toContain("passports");
    expect(ids).toContain("marketplace");
  });

  it("getAgencyService returns by id", () => {
    expect(getAgencyService("scanner")?.id).toBe("scanner");
    expect(getAgencyService("passports")?.id).toBe("passports");
    expect(getAgencyService("marketplace")?.id).toBe("marketplace");
    expect(getAgencyService("nonexistent")).toBeUndefined();
  });

  it("AGENCY_BRAND has agency-level defaults", () => {
    expect(AGENCY_BRAND.name).toBe("AgentBadge");
    expect(AGENCY_BRAND.tagline.toLowerCase()).toContain("agency");
    expect(AGENCY_BRAND.description).toBeTruthy();
  });

  it("service URLs are unique", () => {
    const urls = AGENCY_SERVICES.map((s) => s.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("service IDs are unique", () => {
    const ids = AGENCY_SERVICES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
