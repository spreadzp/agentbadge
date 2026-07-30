import { Hono } from "hono";
import { html } from "hono/html";
import { LandingLayout } from "../../views/landing/layout";
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
    '<section id="landing-content" class="px-4 py-16 md:px-8"><div class="mx-auto max-w-4xl text-center"><h1 class="text-4xl font-bold text-white md:text-6xl">AgentGate</h1><p class="mt-4 text-lg text-slate-300">On-chain identity for AI agents on Hedera</p><div class="mt-8 flex justify-center gap-4"><a href="/agent-guide" class="rounded-lg bg-emerald-600 px-6 py-3 font-medium text-white hover:bg-emerald-500 transition-colors">Get Started</a><a href="/dashboard" class="rounded-lg border border-slate-700 px-6 py-3 font-medium text-slate-300 hover:border-emerald-500 hover:text-emerald-400 transition-colors">View Dashboard</a></div></div></section>',
    undefined,
    meta,
    jsonLd,
  );
  return c.html(pageHtml);
});

// Note: GET /dashboard is registered in ui.ts (the former GET / handler).
// landingRoutes only owns GET / to avoid route conflicts.
