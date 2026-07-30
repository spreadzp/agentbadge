import { Hono } from "hono";
import { html } from "hono/html";
import { LandingLayout } from "../../views/landing/layout";
import { HeroSection } from "../../views/landing/hero";
import { PageMeta as PageMetaRegistry, type PageMeta } from "../lib/page-meta";
import { defaultCoreSchemas, landingJsonLd } from "../lib/json-ld";

/**
 * Landing page routes.
 * (SLICE-19-2)
 *
 * GET /           — landing page (marketing)
 * GET /dashboard  — dashboard page (was previously GET / in ui.ts)
 */
export const landingRoutes = new Hono();

/**
 * GET / — landing page.
 *
 * Renders the landing page using LandingLayout.
 * The actual page content (sections) will be assembled by LandingPage()
 * in SLICE-19-11. For now, a placeholder is rendered.
 */
landingRoutes.get("/", (c) => {
  const meta = PageMetaRegistry["/"];
  const jsonLd = landingJsonLd();
  const pageHtml = LandingLayout(
    HeroSection().toString(),
    undefined,
    meta,
    jsonLd,
  );
  return c.html(pageHtml);
});

// Note: GET /dashboard is registered in ui.ts (the former GET / handler).
// landingRoutes only owns GET / to avoid route conflicts.
