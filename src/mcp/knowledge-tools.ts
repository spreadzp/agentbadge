/**
 * SLICE-201-8 (EPIC-201, track B): MCP knowledge tools — search_knowledge and
 * get_knowledge_object. An agent finds AgentBadge articles/rules/concepts and
 * acts (scan, board, guide) without leaving its MCP client (D-201-11).
 *
 * search_knowledge ranking (D-201-21): exact slug/tag match > text hits
 * (title/description/qa) > relation hits via the 201-14 knowledge index
 * (query → entity → edges → articles). Results carry `status` so the agent can
 * filter PROTOTYPE vs PRODUCTION at search time. Compact JSON — curate
 * ruthlessly.
 *
 * get_knowledge_object(id): article:<slug> | bare slug → Knowledge Object v1
 * (201-5); rule:<id> → RuleDescription; concept:<id> | <map-node-id> →
 * knowledge-map node; guide:<slug> → guide ref. Unknown id → isError (same
 * contract as board_* tools).
 */
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ToolResult,
  type NamespaceRegistry,
  getNamespace,
} from "@agentbadge/mcp";

import { BLOG_ARTICLES, type BlogArticle } from "../server/lib/blog-data";
import { toKnowledgeObject } from "../server/lib/blog/knowledge-object";
import { extractQaFromContent } from "../server/lib/blog/knowledge-object";
import { toKnowledgeIndex } from "../server/lib/blog/knowledge-index";
import { entitySlug } from "../server/lib/blog/entity-registry";
import { RULE_DESCRIPTIONS } from "../agent-readiness/rule-descriptions";

const KM_PATH = join(__dirname, "../server/agent-knowledge/knowledge-map.json");

function getRegistry(ns?: NamespaceRegistry) {
  return ns ?? getNamespace("all")!;
}

function ok(payload: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

interface SearchHit {
  id: string;
  type: string;
  title: string;
  ref: string;
  status?: string;
  score: number;
}

/** Lazy-built knowledge index + article-QA cache (deterministic per process). */
let _index: ReturnType<typeof toKnowledgeIndex> | null = null;
const _qa = new Map<string, string[]>();
function index() {
  if (!_index) _index = toKnowledgeIndex(BLOG_ARTICLES);
  return _index;
}
function articleQuestions(a: BlogArticle): string[] {
  let qs = _qa.get(a.slug);
  if (!qs) {
    qs = extractQaFromContent(a.content, 12).map((q) =>
      q.question.toLowerCase(),
    );
    _qa.set(a.slug, qs);
  }
  return qs;
}

function scoreArticle(a: BlogArticle, tokens: string[], raw: string): number {
  let score = 0;
  const slugLc = a.slug.toLowerCase();
  if (entitySlug(raw) === slugLc) score += 100;
  const title = a.title.toLowerCase();
  const desc = `${a.description} ${a.shortAnswer ?? ""}`.toLowerCase();
  const qa = articleQuestions(a).join(" ");
  for (const t of tokens) {
    if (a.tags.some((tag) => tag.toLowerCase() === t)) score += 60;
    if (title.includes(t)) score += 15;
    if (desc.includes(t)) score += 5;
    if (qa.includes(t)) score += 3;
    if (slugLc === t) score += 50;
  }
  return score;
}

/** Topical edges only — documents/links are generic (every article documents
 * project:agentbadge; boosting through them flattens the ranking). */
const BOOST_EDGE_TYPES = new Set([
  "covers",
  "uses",
  "introduces",
  "demonstrates",
  "mentions",
  "has-guide",
]);

/** Relation boost: query token → index entity → edges → articles (+30). */
function relationBoost(tokens: string[]): Map<string, number> {
  const boost = new Map<string, number>();
  const idx = index();
  const matched = new Set<string>();
  for (const [id, e] of Object.entries(idx.entities)) {
    const label = e.label.toLowerCase();
    if (tokens.some((t) => label === t || label.includes(t))) matched.add(id);
  }
  if (matched.size === 0) return boost;
  for (const edge of idx.edges) {
    if (!BOOST_EDGE_TYPES.has(edge.type)) continue;
    if (!matched.has(edge.to)) continue;
    if (!edge.from.startsWith("article:")) continue;
    boost.set(edge.from, (boost.get(edge.from) ?? 0) + 30);
  }
  return boost;
}

function scoreRule(
  r: (typeof RULE_DESCRIPTIONS)[number],
  tokens: string[],
  raw: string,
): number {
  let score = 0;
  const rid = r.rule_id.toLowerCase();
  if (entitySlug(raw) === entitySlug(rid)) score += 80;
  const title = r.title.toLowerCase();
  const desc = r.short_description.toLowerCase();
  for (const t of tokens) {
    if (rid.includes(t)) score += 20;
    if (title.includes(t)) score += 15;
    if (desc.includes(t)) score += 4;
  }
  return score;
}

async function loadKnowledgeMap(): Promise<{
  version: string;
  nodes: {
    id: string;
    type: string;
    label: string;
    articles?: string[];
    [k: string]: unknown;
  }[];
}> {
  return JSON.parse(await readFile(KM_PATH, "utf-8"));
}

const searchArgs = {
  query: z
    .string()
    .describe("Free-text query — topic, tag, capability, concept or article slug"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Max results (default 5)"),
};

async function searchHandler(args: {
  query?: string;
  limit?: number;
}): Promise<ToolResult> {
  const query = (args.query ?? "").trim();
  const limit = args.limit ?? 5;
  if (!query) return ok({ results: [] });

  const tokens = tokenize(query);
  const boost = relationBoost(tokens);
  const hits: SearchHit[] = [];

  for (const a of BLOG_ARTICLES) {
    const id = `article:${a.slug}`;
    const score = scoreArticle(a, tokens, query) + (boost.get(id) ?? 0);
    if (score <= 0) continue;
    hits.push({
      id,
      type: "article",
      title: a.title,
      ref: `/blog/${a.slug}.json`,
      status: a.status ?? "LIVE",
      score,
    });
  }

  for (const r of RULE_DESCRIPTIONS) {
    const score = scoreRule(r, tokens, query);
    if (score <= 0) continue;
    hits.push({
      id: `rule:${r.rule_id}`,
      type: "rule",
      title: r.title,
      ref: `/rules/${r.rule_id}.json`,
      score,
    });
  }

  const km = await loadKnowledgeMap();
  for (const node of km.nodes) {
    const label = node.label.toLowerCase();
    const nid = node.id.toLowerCase();
    const score = tokens.some((t) => label.includes(t) || nid === t) ? 40 : 0;
    if (score > 0) {
      hits.push({
        id: `concept:${node.id}`,
        type: "concept",
        title: node.label,
        ref: "/agent-guide/knowledge-map.json",
        score,
      });
    }
  }

  hits.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
  return ok({ results: hits.slice(0, limit) });
}

const getArgs = {
  id: z
    .string()
    .describe(
      "Entity id: article:<slug> | bare article slug | rule:<rule_id> | concept:<id> | guide:<slug>",
    ),
};

async function getHandler(args: { id?: string }): Promise<ToolResult> {
  const id = (args.id ?? "").trim();
  if (!id) return fail("id is required");

  const [prefix, ...rest] = id.split(":");
  const value = rest.join(":");

  if (prefix === "article" && value) {
    const a = BLOG_ARTICLES.find((x) => x.slug === value);
    if (!a) return fail(`unknown id: ${id}`);
    return ok(toKnowledgeObject(a));
  }
  if (prefix === "rule" && value) {
    const r = RULE_DESCRIPTIONS.find((x) => x.rule_id === value);
    if (!r) return fail(`unknown id: ${id}`);
    return ok({ type: "rule", ...r });
  }
  if (prefix === "concept" && value) {
    const km = await loadKnowledgeMap();
    const node = km.nodes.find((n) => n.id === value);
    if (!node) return fail(`unknown id: ${id}`);
    return ok({ ...node, type: "concept" });
  }
  if (prefix === "guide" && value) {
    return ok({
      type: "guide",
      id: value,
      ref: `/agent-guide/articles/${value}`,
    });
  }

  // Bare id: article slug → concept node → fail.
  const a = BLOG_ARTICLES.find((x) => x.slug === id);
  if (a) return ok(toKnowledgeObject(a));
  const km = await loadKnowledgeMap();
  const node = km.nodes.find((n) => n.id === id);
  if (node) return ok({ ...node, type: "concept" });
  return fail(`unknown id: ${id}`);
}

export function registerKnowledgeTools(ns?: NamespaceRegistry): void {
  const r = getRegistry(ns);
  r.registerTool(
    "search_knowledge",
    "Search AgentBadge knowledge graph: articles (Knowledge Objects), readiness rules and concepts. Ranking: exact slug/tag > text > relation edges. Results carry status (LIVE/PRODUCTION/...) and ref links — fetch details via get_knowledge_object or GET <ref>.",
    searchArgs,
    searchHandler,
  );
  r.registerTool(
    "get_knowledge_object",
    "Fetch a full Knowledge Object by id: article:<slug> (Content Object v1 — status, claims, evidence, actions, economicContext), rule:<id> (readiness rule), concept:<id> (knowledge-map node), guide:<slug>. Use after search_knowledge to get the full document.",
    getArgs,
    getHandler,
  );
}
