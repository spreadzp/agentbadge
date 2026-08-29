import { Hono } from "hono";
import { LandingLayout } from "../../views/landing/layout";
import { DataHubLandingPage } from "../../views/landing/datahub-landing-page";
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

hackathonRoutes.get("/hackathon/:name", (c) => {
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
  } else {
    content = '<main><section class="hero"><h1>WebMCP Challenge</h1><p>AgentBadge WebMCP implementation — agent-native compliance platform.</p></section></main>';
  }

  return c.html(LandingLayout(content, undefined, meta, landingJsonLd()));
});
