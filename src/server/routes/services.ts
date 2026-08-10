import { Hono } from "hono";
import { LandingLayout } from "../../views/landing/layout";
import { ServicePageView } from "../../views/service-page";
import { PageMeta as PageMetaRegistry } from "../lib/page-meta";
import { servicesJsonLd } from "../lib/json-ld";
import { AGENCY_SERVICES, getAgencyService } from "../lib/agency-config";

/**
 * Services routes — landing pages for each agency service.
 * SLICE-51-3, 51-4, 51-5
 */
export const servicesRoutes = new Hono();

/**
 * GET /services/scanner — Agent Readiness Scanner landing page.
 */
servicesRoutes.get("/services/scanner", async (c) => {
  const service = getAgencyService("scanner")!;
  const meta = PageMetaRegistry["/services/scanner"];
  const jsonLd = servicesJsonLd({ name: service.name, description: service.description, path: service.url });
  const content = ServicePageView(service, AGENCY_SERVICES).toString();
  const pageHtml = LandingLayout(content, undefined, meta, jsonLd);
  return c.html(pageHtml);
});

/**
 * GET /services/passports — On-Chain Agent Passports landing page.
 */
servicesRoutes.get("/services/passports", async (c) => {
  const service = getAgencyService("passports")!;
  const meta = PageMetaRegistry["/services/passports"];
  const jsonLd = servicesJsonLd({ name: service.name, description: service.description, path: service.url });
  const content = ServicePageView(service, AGENCY_SERVICES).toString();
  const pageHtml = LandingLayout(content, undefined, meta, jsonLd);
  return c.html(pageHtml);
});

/**
 * GET /services/marketplace — Agent Marketplace landing page.
 */
servicesRoutes.get("/services/marketplace", async (c) => {
  const service = getAgencyService("marketplace")!;
  const meta = PageMetaRegistry["/services/marketplace"];
  const jsonLd = servicesJsonLd({ name: service.name, description: service.description, path: service.url });
  const content = ServicePageView(service, AGENCY_SERVICES).toString();
  const pageHtml = LandingLayout(content, undefined, meta, jsonLd);
  return c.html(pageHtml);
});
