import { Hono } from "hono";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { html, raw } from "hono/html";
import { marked } from "marked";
import { LandingLayout } from "../../views/landing/layout";
import { PageMeta } from "../lib/page-meta";
import { parseFrontmatter } from "../lib/frontmatter";
import { defaultCoreSchemas, articleLd } from "../lib/json-ld";
import { describeRoute } from "hono-openapi";
import {
  RULE_DESCRIPTIONS,
  CATEGORY_DESCRIPTIONS,
  PILLAR_DESCRIPTIONS,
} from "../../agent-readiness/rule-descriptions";
import { BUILD_DATE } from "../lib/build-info";

function injectDynamicFacts(body: string): string {
  const replacements: Record<string, string> = {
    RULE_COUNT: String(RULE_DESCRIPTIONS.length),
    CATEGORY_COUNT: String(Object.keys(CATEGORY_DESCRIPTIONS).length),
    PILLAR_COUNT: String(Object.keys(PILLAR_DESCRIPTIONS).length),
    LAST_UPDATED: BUILD_DATE,
  };
  return body.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return replacements[key] ?? match;
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = join(__dirname, "../content");

function loadMarkdownFile(filename: string): { frontmatter: Record<string, unknown>; body: string } | null {
  const filepath = join(CONTENT_DIR, filename);
  if (!existsSync(filepath)) return null;
  const content = readFileSync(filepath, "utf-8");
  const parsed = parseFrontmatter(content);
  return { frontmatter: parsed.frontmatter, body: parsed.body };
}

function renderMarkdown(md: string): string {
  return marked.parse(md, { async: false }) as string;
}

function AuthorityPage(body: string, frontmatter: Record<string, unknown>): string {
  const title = (frontmatter.title as string) ?? "Authority Page";
  const description = (frontmatter.description as string) ?? "";
  const rendered = renderMarkdown(body);

  return html`<main class="mx-auto max-w-4xl px-4 py-12">
    <article class="prose prose-invert prose-slate max-w-none">
      <h1>${title}</h1>
      <p class="text-lg text-slate-400">${description}</p>
      ${raw(rendered)}
    </article>
  </main>`.toString();
}

export const authorityRoutes = new Hono();

// GET /agent-readiness → 301 redirect to /what-is-agent-readiness
authorityRoutes.get("/agent-readiness", (c) => {
  return c.redirect("/what-is-agent-readiness", 301);
});

// GET /what-is-agent-readiness — canonical authority page
authorityRoutes.get(
  "/what-is-agent-readiness",
  describeRoute({
    tags: ["Authority"],
    summary: "What Is Agent Readiness — canonical authority page",
    description: "Editorial markdown rendered as HTML with dynamic Rule Engine facts.",
    responses: { 200: { description: "HTML page" }, 500: { description: "Markdown file not found" } },
  }),
  (c) => {
    const loaded = loadMarkdownFile("what-is-agent-readiness.md");
    if (!loaded) {
      return c.text("Content not found", 500);
    }

    const { frontmatter, body: rawBody } = loaded;
    const body = injectDynamicFacts(rawBody);
    const title = (frontmatter.title as string) ?? "What Is Agent Readiness?";
    const description = (frontmatter.description as string) ?? "";
    const canonicalPath = (frontmatter.canonical as string) ?? "/what-is-agent-readiness";

    const meta: PageMeta = {
      title,
      description,
      path: canonicalPath,
      ogType: "article",
    };

    const schemas = [
      ...defaultCoreSchemas(),
      articleLd({
        title,
        description,
        path: canonicalPath,
        datePublished: BUILD_DATE,
        dateModified: BUILD_DATE,
      }),
      {
        "@context": "https://schema.org",
        "@type": "DefinedTermSet",
        name: "Agent Readiness",
        url: `https://agentbadge.xyz${canonicalPath}`,
        hasDefinedTerm: [
          {
            "@type": "DefinedTerm",
            name: "Agent Readiness",
            description:
              "The degree to which an API or service can be discovered, understood, and used by AI agents without human intervention.",
          },
          {
            "@type": "DefinedTerm",
            name: "Discovery",
            description: "Can AI agents find your API or service?",
          },
          {
            "@type": "DefinedTerm",
            name: "Understandability",
            description: "Can AI agents understand what your API does and how to use it?",
          },
          {
            "@type": "DefinedTerm",
            name: "Executability",
            description: "Can AI agents successfully call your API end-to-end?",
          },
          {
            "@type": "DefinedTerm",
            name: "Verifiability",
            description: "Can AI agents verify the results of their API calls?",
          },
        ],
      },
    ];

    const content = AuthorityPage(body, frontmatter);
    const pageHtml = LandingLayout(content, undefined, meta, schemas);
    return c.html(pageHtml);
  },
);
