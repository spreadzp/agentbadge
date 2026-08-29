import { Hono } from "hono";
import { LandingLayout } from "../../views/landing/layout";
import { PageMeta as PageMetaRegistry } from "../lib/page-meta";
import { landingJsonLd } from "../lib/json-ld";

/**
 * Hackathon routes.
 * SLICE-91-1: Generic /hackathon/:name routing pattern.
 *
 * Supports multiple hackathon pages under a consistent URL structure.
 * Unknown names return 404. Name parameter validated (alphanumeric + hyphen).
 */
export const hackathonRoutes = new Hono();

// Alphanumeric + hyphen only
const NAME_PATTERN = /^[a-z0-9-]+$/;

// Known hackathon names (extended in subsequent slices)
const KNOWN_HACKATHONS = new Set(["webmcp"]);

hackathonRoutes.get("/hackathon/:name", (c) => {
  const name = c.req.param("name");

  if (!NAME_PATTERN.test(name) || !KNOWN_HACKATHONS.has(name)) {
    return c.text("Hackathon not found", 404);
  }

  const meta = PageMetaRegistry[`/hackathon/${name}`];
  if (!meta) {
    return c.text("Hackathon not found", 404);
  }

  const content = '<main><section class="hero"><h1>WebMCP Challenge</h1><p>AgentBadge WebMCP implementation — agent-native compliance platform.</p></section></main>';
  return c.html(LandingLayout(content, undefined, meta, landingJsonLd()));
});
