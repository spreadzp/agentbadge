/**
 * Agent Knowledge Layer routes — SLICE-42-1
 *
 * Serves Markdown content from src/server/agent-knowledge/ directory
 * to AI agents and humans.
 *
 * Routes:
 *   GET /agent-guide                    → text/markdown or application/json (content negotiation)
 *   GET /agent-guide/                   → text/markdown or application/json (content negotiation)
 *   GET /.well-known/agent-guide.json   → application/json (structured guide for scanners)
 *   GET /agent-guide/context            → text/markdown
 *   GET /agent-guide/learn              → text/markdown
 *   GET /agent-guide/knowledge-map.json → application/json
 *   GET /agent-guide/concepts/:name     → text/markdown (200 or 404)
 *   GET /agent-guide/capabilities/:name → text/markdown (200 or 404)
 *   GET /agent-guide/articles/:slug     → text/markdown (200 or 404)
 */

import { Hono, type Context } from "hono";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import { parseFrontmatter } from "../lib/frontmatter";
import { getRegistry } from "../registry/loader";
import { BASE_URL } from "../lib/page-meta";
import { RelevantEngineeringCapability } from "../../components/RelevantEngineeringCapability";
import { GuideLayout } from "../../views/guide-layout";
import { defaultCoreSchemas, howToLd, breadcrumbListLd } from "../lib/json-ld";
import { BUILD_DATE } from "../lib/build-info";

export const agentKnowledgeRoutes = new Hono();

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_DIR = join(__dirname, "../agent-knowledge");

async function serveMarkdownFile(
  filePath: string,
): Promise<Response> {
  try {
    const content = await readFile(filePath, "utf-8");
    return new Response(content, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    return new Response(
      JSON.stringify({
        error: "File not found",
        code: ErrorCodes.RESOURCE_NOT_FOUND,
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

agentKnowledgeRoutes.get("/agent-guide", async (c) => {
  const accept = c.req.header("Accept") ?? "";
  if (accept.includes("application/json")) {
    return serveAgentGuideJson(c);
  }
  const md = await readFile(join(BASE_DIR, "index.md"), "utf-8");
  const wantsHtml = accept.includes("text/html");
  if (!wantsHtml) {
    return new Response(md, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" } });
  }
  const schemas = [
    ...defaultCoreSchemas(),
    howToLd({
      name: "AgentBadge Agent Guide",
      description: "Machine-readable guide for AI agents to understand and use AgentBadge.",
      path: "/agent-guide",
      totalTime: "PT10M",
      steps: [
        { name: "Read the guide", text: "Fetch /agent-guide for the full knowledge index." },
        { name: "Get context", text: "Read /agent-guide/context for background." },
        { name: "Follow learning path", text: "Use /agent-guide/learn for step-by-step onboarding." },
      ],
    }),
    breadcrumbListLd([
      { name: "Home", path: "/" },
      { name: "Agent Guide", path: "/agent-guide" },
    ]),
  ].map((s) => (s as any)["@type"] === "HowTo" ? { ...(s as any), dateModified: BUILD_DATE } : s);
  return c.html(GuideLayout("Agent Guide", md, schemas, "/agent-guide", BUILD_DATE));
});

agentKnowledgeRoutes.get("/agent-guide/", (c) => {
  const accept = c.req.header("Accept") ?? "";
  if (accept.includes("application/json")) {
    return serveAgentGuideJson(c);
  }
  return serveMarkdownFile(join(BASE_DIR, "index.md"));
});

agentKnowledgeRoutes.get("/.well-known/agent-guide.json", async (c) => {
  return serveAgentGuideJson(c);
});

agentKnowledgeRoutes.get("/agent-guide.json", async (c) => {
  return serveAgentGuideJson(c);
});

async function serveAgentGuideJson(c: Context): Promise<Response> {
  try {
    const indexContent = await readFile(join(BASE_DIR, "index.md"), "utf-8");
    let knowledgeMap: Record<string, unknown> = {};
    try {
      const kmContent = await readFile(join(BASE_DIR, "knowledge-map.json"), "utf-8");
      knowledgeMap = JSON.parse(kmContent);
    } catch { /* optional */ }

    const guide = {
      schema: "agentbadge.agent-guide.v1",
      name: "AgentBadge Agent Guide",
      description: "Machine-readable guide for AI agents to understand and use AgentBadge",
      base_url: BASE_URL,
      endpoints: {
        context: "/agent-guide/context",
        learn: "/agent-guide/learn",
        knowledge_map: "/agent-guide/knowledge-map.json",
        marketplace_guide: "/marketplace-guide",
        llms_txt: "/llms.txt",
        openapi: "/api/specs",
      },
      api_endpoints: [
        "GET /passport/request",
        "GET /passport/address/{address}",
        "GET /passport/{tokenId}/{serial}",
        "GET /passports",
        "GET /did/{did}",
        "GET /agents",
        "GET /agents/{did}",
        "POST /agents/register",
        "POST /admin/revoke",
        "POST /admin/rebuild-cache",
        "POST /passport/{tokenId}/{serial}/upgrade",
        "GET /audit/{tokenId}/{serial}",
        "GET /catalog",
        "GET /.well-known/oauth-authorization-server",
        "GET /feed",
        "GET /marketplace-guide",
        "POST /a2a/send",
        "POST /a2a/send-with-key",
        "POST /a2a/send-signed",
        "GET /a2a/inbox",
        "GET /a2a/conversation",
        "GET /market/tasks",
        "GET /market/tasks/{taskId}",
        "POST /market/tasks",
        "POST /market/tasks/{taskId}/claim",
        "POST /market/tasks/{taskId}/deliver",
        "POST /market/tasks/{taskId}/claim-with-key",
        "POST /market/tasks/{taskId}/deliver-with-key",
        "POST /market/tasks/{taskId}/prepare-payment",
        "POST /market/tasks/{taskId}/complete",
        "POST /market/sign",
        "POST /market/tasks/{taskId}/complete-with-key",
        "POST /market/tasks/signed",
        "POST /market/tasks/{taskId}/cancel",
        "POST /market/tasks/{taskId}/increase-reward",
        "GET /market/tasks/{taskId}/escrow-status",
        "POST /market/tasks/{taskId}/verify",
        "GET /api/search",
        "GET /market-guide",
        "GET /medical-guide",
        "GET /faq",
        "GET /use-cases",
        "GET /about",
        "GET /pricing",
        "GET /terms",
        "GET /privacy",
        "GET /team",
        "GET /services",
        "GET /work-with-us",
        "GET /api/work-requests",
        "GET /api/work-requests/{id}",
        "GET /changelog",
      ],
      concepts: ["agent-readiness", "scoring", "badge"],
      capabilities: ["scanner", "cli"],
      articles: ["what-is-agent-readiness"],
      knowledge_map: knowledgeMap,
      index_markdown: indexContent,
    };
    return c.json(guide, 200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    });
  } catch {
    return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND, "Agent guide not found");
  }
}

agentKnowledgeRoutes.get("/agent-guide/context", (c) => {
  return serveMarkdownFile(join(BASE_DIR, "context.md"));
});

agentKnowledgeRoutes.get("/agent-guide/learn", (c) => {
  return serveMarkdownFile(join(BASE_DIR, "learn.md"));
});

agentKnowledgeRoutes.get("/agent-guide/knowledge-map.json", async (c) => {
  try {
    const content = await readFile(join(BASE_DIR, "knowledge-map.json"), "utf-8");
    return c.json(JSON.parse(content), 200, {
      "Cache-Control": "public, max-age=300",
    });
  } catch {
    return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND, "Knowledge map not found");
  }
});

agentKnowledgeRoutes.get("/agent-guide/concepts/:name", async (c) => {
  const name = c.req.param("name");
  const filePath = join(BASE_DIR, "concepts", `${name}.md`);
  try {
    const raw = await readFile(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(raw);

    let ctaHtml = "";
    if (frontmatter.related_capabilities && frontmatter.related_capabilities.length > 0) {
      try {
        const registry = await getRegistry();
        ctaHtml = RelevantEngineeringCapability(frontmatter, registry);
      } catch {
        // registry unavailable — skip CTA
      }
    }

    const output = ctaHtml ? `${body}\n\n${ctaHtml}` : body;
    return new Response(output, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    return new Response(
      JSON.stringify({
        error: "File not found",
        code: ErrorCodes.RESOURCE_NOT_FOUND,
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});

agentKnowledgeRoutes.get("/agent-guide/capabilities/:name", (c) => {
  const name = c.req.param("name");
  return serveMarkdownFile(join(BASE_DIR, "capabilities", `${name}.md`));
});

agentKnowledgeRoutes.get("/agent-guide/articles/:slug", async (c) => {
  const slug = c.req.param("slug");
  const filePath = join(BASE_DIR, "articles", `${slug}.md`);
  try {
    const raw = await readFile(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(raw);

    let ctaHtml = "";
    if (frontmatter.related_capabilities && frontmatter.related_capabilities.length > 0) {
      try {
        const registry = await getRegistry();
        ctaHtml = RelevantEngineeringCapability(frontmatter, registry);
      } catch {
        // registry unavailable — skip CTA
      }
    }

    const output = ctaHtml ? `${body}\n\n${ctaHtml}` : body;
    return new Response(output, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    return new Response(
      JSON.stringify({
        error: "File not found",
        code: ErrorCodes.RESOURCE_NOT_FOUND,
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});
