import { Hono } from "hono";
import { LandingLayout } from "../../views/landing/layout";
import { DataHubLandingPage } from "../../views/landing/datahub-landing-page";
import { WebMcpHackathonPage } from "../../views/landing/webmcp-hackathon-page";
import { PageMeta as PageMetaRegistry } from "../lib/page-meta";
import { landingJsonLd } from "../lib/json-ld";

/**
 * Hackathon routes.
 * SLICE-91-1: Generic /hackathon/:name routing pattern.
 * SLICE-91-2: DataHub moved from /datahub to /hackathon/datahub.
 *
 * Supports multiple hackathon pages under a consistent URL structure.
 * Unknown names return 404. Name parameter validated (alphanumeric + hyphen).
 */
export const hackathonRoutes = new Hono();

// Alphanumeric + hyphen only
const NAME_PATTERN = /^[a-z0-9-]+$/;

// Known hackathon names (extended in subsequent slices)
const KNOWN_HACKATHONS = new Set(["webmcp", "datahub"]);

hackathonRoutes.get("/hackathon/:name", async (c) => {
  const name = c.req.param("name");

  if (!NAME_PATTERN.test(name) || !KNOWN_HACKATHONS.has(name)) {
    return c.text("Hackathon not found", 404);
  }

  const meta = PageMetaRegistry[`/hackathon/${name}`];
  if (!meta) {
    return c.text("Hackathon not found", 404);
  }

  let content: string;
  if (name === "datahub") {
    content = DataHubLandingPage().toString();
  } else if (name === "webmcp") {
    content = WebMcpHackathonPage().toString();
  } else {
    content = '<main><section class="hero"><h1>Hackathon</h1><p>Page not found.</p></section></main>';
  }

  const response = await c.html(LandingLayout(content, undefined, meta, landingJsonLd()));
  if (name === "webmcp") {
    response.headers.set(
      "Link",
      '</.well-known/webmcp.json>; rel="service-desc"',
    );
  }
  return response;
});
