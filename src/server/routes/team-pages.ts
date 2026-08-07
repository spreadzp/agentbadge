import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { getRegistry } from "../registry/loader";
import { TeamPage } from "../../views/team-page";
import { ServicesPage } from "../../views/services-page";
import { WorkWithUsPage } from "../../views/work-with-us-page";
import { articleLd, defaultCoreSchemas } from "../lib/json-ld";

export const teamPageRoutes = new Hono();

teamPageRoutes.get(
  "/team",
  describeRoute({
    tags: ["Team"],
    summary: "Team page — who we are, capabilities, services, people",
    description:
      "Human-facing page about the AgentBadge engineering team. Renders from registry data.",
    responses: { 200: { description: "HTML team page" } },
  }),
  async (c) => {
    try {
      const registry = await getRegistry();
      const html = TeamPage(registry);
      const schemas = [
        ...defaultCoreSchemas(),
        articleLd({
          title: "AgentBadge Engineering Team",
          description:
            "MCP development, blockchain integration, AI agent architecture, and GEO optimization. Available for contract work.",
          path: "/team",
          sections: [
            {
              title: "Capabilities",
              body: registry.capabilities.map((cap) => `${cap.name}: ${cap.description ?? ""}`).join("; "),
            },
          ],
        }),
      ];
      return c.html(html);
    } catch {
      return c.html(
        '<section class="p-8 text-center text-slate-300">Team data temporarily unavailable. Please try again later.</section>',
        500,
      );
    }
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
      const html = ServicesPage(registry);
      const schemas = [
        ...defaultCoreSchemas(),
        articleLd({
          title: "AgentBadge Services Catalog",
          description:
            "Engineering services: MCP server development, blockchain integration, AI agent architecture, GEO optimization.",
          path: "/services",
          sections: registry.services.map((s) => ({
            title: s.name,
            body: `${s.problem} Deliverables: ${s.deliverables.join(", ")}.`,
          })),
        }),
      ];
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
      const html = WorkWithUsPage(registry);
      const schemas = [
        ...defaultCoreSchemas(),
        articleLd({
          title: "Work With the AgentBadge Team",
          description:
            "Engagement types: contract, part-time, fixed-scope. Process, availability, and contact channels.",
          path: "/work-with-us",
          sections: [
            {
              title: "Engagement",
              body: "Contract, part-time, fixed-scope. Weekly demos for contract, milestone-based for fixed-scope.",
            },
          ],
        }),
      ];
      return c.html(html);
    } catch {
      return c.html(
        '<section class="p-8 text-center text-slate-300">Page temporarily unavailable. Please try again later.</section>',
        500,
      );
    }
  },
);
