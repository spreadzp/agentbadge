/**
 * SLICE-201-14 (EPIC-201, track B): Knowledge Graph index route.
 *
 *   GET /knowledge/index.json → {version, entities:{byId}, edges[]} — a single
 *   index of all articles/projects/technologies/capabilities/guides with
 *   stable slug-based ids and typed edges (D-201-21). Deterministic output,
 *   cacheable.
 */
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { BLOG_ARTICLES } from "../lib/blog-data";
import { toKnowledgeIndex } from "../lib/blog/knowledge-index";

export const knowledgeRoutes = new Hono();

knowledgeRoutes.get(
  "/knowledge/index.json",
  describeRoute({
    tags: ["Knowledge"],
    summary: "Knowledge Graph index",
    description:
      "Single index of all content entities (article/project/technology/capability/guide/concept/topic/resource) with stable <type>:<slug> ids and typed edges derived from article metadata. Deterministic; edges always resolve.",
    responses: {
      200: { description: "Knowledge index document" },
    },
  }),
  (c) => {
    c.header("Cache-Control", "public, max-age=300");
    return c.json(toKnowledgeIndex(BLOG_ARTICLES));
  },
);
