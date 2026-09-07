import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { getRegistry } from "../registry/loader";
import { ServicesPage } from "../../views/services-page";
import { WorkWithUsPage } from "../../views/work-with-us-page";
import { pageCoreSchemas, breadcrumbFor, collectionPageLd, webPageLd } from "../lib/json-ld";

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
