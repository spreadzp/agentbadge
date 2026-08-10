import { describe, it, expect } from "vitest";
import { ServicePageView } from "../../src/views/service-page";
import { AGENCY_SERVICES, getAgencyService } from "../../src/server/lib/agency-config";
import { LandingLayout } from "../../src/views/landing/layout";
import { PageMeta as PageMetaRegistry } from "../../src/server/lib/page-meta";

describe("Cross-linking + Canonicals (SLICE-51-12)", () => {
  it("service pages have cross-links to other services", () => {
    const scanner = getAgencyService("scanner")!;
    const html = ServicePageView(scanner, AGENCY_SERVICES).toString();
    expect(html).toContain("/services/passports");
    expect(html).toContain("/services/marketplace");
  });

  it("service pages have breadcrumbs", () => {
    const scanner = getAgencyService("scanner")!;
    const html = ServicePageView(scanner, AGENCY_SERVICES).toString();
    expect(html).toMatch(/breadcrumb/i);
    expect(html).toContain('href="/"');
    expect(html).toContain("Home");
  });

  it("service pages have canonical URL via LandingLayout", () => {
    const scanner = getAgencyService("scanner")!;
    const meta = PageMetaRegistry["/services/scanner"];
    const content = ServicePageView(scanner, AGENCY_SERVICES).toString();
    const pageHtml = LandingLayout(content, undefined, meta).toString();
    expect(pageHtml).toMatch(/rel=["']canonical["']/i);
  });
});
