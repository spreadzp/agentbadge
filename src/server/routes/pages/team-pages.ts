import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { getRegistry } from "../../registry/loader";
import { ServicesPage } from "../../../views/pages/services-page";
import { WorkWithUsPage } from "../../../views/pages/work-with-us-page";
import { JoinPage } from "../../../views/pages/join-page";
import { PageMeta } from "../../lib/page-meta";
import { pageCoreSchemas, breadcrumbFor, collectionPageLd, webPageLd } from "../../lib/json-ld";

export const teamPageRoutes = new Hono();

teamPageRoutes.get(
  "/team",
  describeRoute({
    tags: ["Team"],
    summary: "301 redirect to /about",
    description:
      "Redirects /team to /about with 301 Moved Permanently. SLICE-55-1: fix duplicate canonical in GSC.",
    responses: { 301: { description: "Redirect to /about" } },
  }),
  (c) => {
    return c.redirect("/about", 301);
  },
);

teamPageRoutes.get(
  "/services",
  describeRoute({
    tags: ["Team"],
    summary: "Services catalog page",
    description:
      "Human-facing services catalog with problem, deliverables, and engagement models. Renders from registry data.",
    responses: { 200: { description: "HTML services page" } },
  }),
  async (c) => {
    try {
      const registry = await getRegistry();
      const schemas = [
        ...pageCoreSchemas(),
        collectionPageLd({
          name: "AgentBadge Services Catalog",
          description:
            "Engineering services: MCP server development, blockchain integration, AI agent architecture, GEO optimization.",
          path: "/services",
        }),
        breadcrumbFor("/services", "Services"),
      ];
      const html = ServicesPage(registry, schemas);
      return c.html(html);
    } catch {
      return c.html(
        '<section class="p-8 text-center text-slate-300">Services data temporarily unavailable. Please try again later.</section>',
        500,
      );
    }
  },
);

teamPageRoutes.get(
  "/work-with-us",
  describeRoute({
    tags: ["Team"],
    summary: "Work with us — engagement types, process, contact",
    description:
      "Human-facing page about how to engage with the AgentBadge team. Renders from registry data.",
    responses: { 200: { description: "HTML work-with-us page" } },
  }),
  async (c) => {
    try {
      const registry = await getRegistry();
      const schemas = [
        ...pageCoreSchemas(),
        webPageLd({
          title: "Work With the AgentBadge Team",
          description:
            "Engagement types: contract, part-time, fixed-scope. Process, availability, and contact channels.",
          path: "/work-with-us",
        }),
        breadcrumbFor("/work-with-us", "Work With Us"),
      ];
      const html = WorkWithUsPage(registry, schemas);
      return c.html(html);
    } catch {
      return c.html(
        '<section class="p-8 text-center text-slate-300">Page temporarily unavailable. Please try again later.</section>',
        500,
      );
    }
  },
);

// SLICE-234-31: /join onboarding hub — 7d prod: /join ×9, /join-us ×9
// → 404. Three audiences (developers/businesses/agents) + the real
// "list your agent" flow (passport mint → automatic /ui/agents
// listing). No fake forms.
teamPageRoutes.get(
  "/join",
  describeRoute({
    tags: ["Team"],
    summary: "Join AgentBadge — onboarding hub",
    description:
      "Three audiences (developers, businesses, agents) + how to list " +
      "your agent in the discovery directory (passport → /ui/agents).",
    responses: { 200: { description: "HTML join page" } },
  }),
  (c) => {
    const meta = PageMeta["/join"];
    const schemas = [
      ...pageCoreSchemas(),
      webPageLd({
        title: meta.title,
        description: meta.description,
        path: "/join",
      }),
      breadcrumbFor("/join", "Join"),
    ];
    return c.html(JoinPage(meta, schemas));
  },
);

// /join-us — real alias probed ×9 in prod logs.
teamPageRoutes.get(
  "/join-us",
  describeRoute({
    tags: ["Team"],
    summary: "301 redirect to /join",
    description: "Alias probed by users/agents — canonical page is /join.",
    responses: { 301: { description: "Redirect to /join" } },
  }),
  (c) => c.redirect("/join", 301),
);
