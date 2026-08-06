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

agentKnowledgeRoutes.get("/agent-guide", (c) => {
  const accept = c.req.header("Accept") ?? "";
  if (accept.includes("application/json")) {
    return serveAgentGuideJson(c);
  }
  return serveMarkdownFile(join(BASE_DIR, "index.md"));
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
      base_url: process.env.BASE_URL ?? "http://localhost:4021",
      endpoints: {
        context: "/agent-guide/context",
        learn: "/agent-guide/learn",
        knowledge_map: "/agent-guide/knowledge-map.json",
        marketplace_guide: "/marketplace-guide",
        llms_txt: "/llms.txt",
        openapi: "/api/specs",
      },
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

agentKnowledgeRoutes.get("/agent-guide/concepts/:name", (c) => {
  const name = c.req.param("name");
  return serveMarkdownFile(join(BASE_DIR, "concepts", `${name}.md`));
});

agentKnowledgeRoutes.get("/agent-guide/capabilities/:name", (c) => {
  const name = c.req.param("name");
  return serveMarkdownFile(join(BASE_DIR, "capabilities", `${name}.md`));
});

agentKnowledgeRoutes.get("/agent-guide/articles/:slug", (c) => {
  const slug = c.req.param("slug");
  return serveMarkdownFile(join(BASE_DIR, "articles", `${slug}.md`));
});
