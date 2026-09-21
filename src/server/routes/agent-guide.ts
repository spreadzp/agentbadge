/**
 * Agent onboarding guide route — GET /agent-guide
 *
 * Returns markdown-formatted step-by-step instructions that an AI agent
 * can fetch and execute linearly to fully onboard into the AgentBadge system.
 *
 * No authentication or payment required.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { howToLd, breadcrumbListLd, defaultCoreSchemas } from "../lib/json-ld";
import { GuideLayout } from "../../views/guide-layout";
import { generateAgentGuide } from "../lib/agent-guide/generator";

export const agentGuideRoutes = new Hono();

agentGuideRoutes.get(
  "/marketplace-guide",
  describeRoute({
    tags: ["Agent"],
    summary: "Agent onboarding guide (markdown)",
    description:
      "Returns step-by-step markdown instructions for AI agents to self-onboard: glossary, agent types & connection methods (IDE, terminal, cloud, LLM web), request passport, verify, register in directory, A2A messaging, marketplace, error codes.",
    responses: {
      200: {
        description: "Markdown onboarding guide",
        content: { "text/markdown": {} },
      },
    },
  }),
  (c) => {
    const markdown = generateAgentGuide();
    const accept = c.req.header("Accept") ?? "";
    const wantsMarkdown = accept.includes("text/markdown") || accept.includes("text/plain");

    if (wantsMarkdown) {
      return new Response(markdown, {
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      });
    }

    const guideDate = new Date().toISOString().split("T")[0];
    const schemas = [
      ...defaultCoreSchemas(),
      howToLd({
        name: "Mint an AI Agent Passport on AgentBadge",
        description: "Onboard an AI agent into AgentBadge: mint NFT passport, register in directory, join marketplace.",
        path: "/marketplace-guide",
        totalTime: "PT15M",
        steps: [
          { name: "Create Hedera testnet account", text: "Use portal.hedera.com to get an account ID and private key." },
          { name: "Mint passport", text: "POST /passport/request with tier and capabilities; pay via x402." },
          { name: "Verify passport", text: "GET /passport/:tokenId/:serial; confirm active=true." },
          { name: "Register in directory", text: "POST /agents/register with DID, capabilities, endpoint." },
          { name: "Join marketplace", text: "GET /market/tasks; claim, deliver, complete for HBAR." },
        ],
      }),
      breadcrumbListLd([
        { name: "Home", path: "/" },
        { name: "Marketplace Guide", path: "/marketplace-guide" },
      ]),
    ].map((s) => (s as Record<string, unknown>)["@type"] === "HowTo" ? { ...(s as Record<string, unknown>), dateModified: guideDate } : s);

    const html = GuideLayout("Agent Onboarding Guide", markdown, schemas, "/marketplace-guide");
    return c.html(html);
  },
);

