/**
 * SLICE-201-14 (EPIC-201, track B): Knowledge Graph index — a single index of
 * all articles/projects/technologies/capabilities/guides with stable
 * slug-based ids and typed edges, so an agent searches by RELATIONS, not only
 * by words (research §2: otherwise it's a collection of JSON files, not a
 * knowledge graph).
 *
 *   Route     GET /knowledge/index.json → {version, entities:{byId}, edges[]}
 *   IDs       type:slug — article:arc-c29-task-board, project:agentbadge,
 *             technology:arc, capability:task-discovery, guide:hire-or-get-hired
 *   Edges     derived from BlogArticle metadata (topics/technologies/concepts/
 *             capabilities/relatedResources/agentGuideSlug)
 *   Determinism — byte-identical regeneration (CI drift-check, lesson of 178)
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { knowledgeRoutes } from "../src/server/routes/knowledge";
import { blogRoutes } from "../src/server/routes/blog";
import { BLOG_ARTICLES } from "../src/server/lib/blog-data";

const app = new Hono();
app.route("/", knowledgeRoutes);
app.route("/", blogRoutes);

async function getIndex() {
  const res = await app.request("/knowledge/index.json");
  return { res, body: res.status === 200 ? await res.json() : null };
}

describe("GET /knowledge/index.json", () => {
  it("200 + application/json + {version, entities, edges} shape", async () => {
    const { res, body } = await getIndex();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toContain("max-age");
    expect(body.version).toBe("1.0.0");
    expect(typeof body.entities).toBe("object");
    expect(Array.isArray(body.edges)).toBe(true);
  });

  it("covers every BLOG_ARTICLES article as article:<slug> entity", async () => {
    const { body } = await getIndex();
    for (const a of BLOG_ARTICLES) {
      const entity = body.entities[`article:${a.slug}`];
      expect(entity, `missing entity article:${a.slug}`).toBeDefined();
      expect(entity.type).toBe("article");
      expect(entity.label).toBe(a.title);
      expect(entity.ref).toBe(`/blog/${a.slug}.json`);
    }
  });

  it("stable slug-based ids: canonical examples from the spec exist", async () => {
    const { body } = await getIndex();
    expect(body.entities["article:arc-c29-task-board"]).toBeDefined();
    expect(body.entities["project:agentbadge"]).toBeDefined();
    expect(body.entities["technology:arc"]).toBeDefined();
    expect(body.entities["capability:task-discovery"]).toBeDefined();
    expect(body.entities["guide:hire-or-get-hired"]).toBeDefined();
  });

  it("no broken edges — every from/to resolves to an entity id", async () => {
    const { body } = await getIndex();
    const broken: string[] = [];
    for (const e of body.edges) {
      if (!body.entities[e.from]) broken.push(`from:${e.from}`);
      if (!body.entities[e.to]) broken.push(`to:${e.to}`);
      expect(typeof e.type).toBe("string");
    }
    expect(broken).toEqual([]);
  });

  it("at least one edge of each type in the vocabulary", async () => {
    const { body } = await getIndex();
    const types = new Set(body.edges.map((e: { type: string }) => e.type));
    for (const t of [
      "covers",
      "uses",
      "introduces",
      "demonstrates",
      "has-guide",
      "links",
      "documents",
    ]) {
      expect(types, `missing edge type ${t}`).toContain(t);
    }
  });

  it("article entity ref resolves — consistency with /blog/:slug.json (201-5)", async () => {
    const { body } = await getIndex();
    const entity = body.entities["article:arc-c29-task-board"];
    const res = await app.request(entity.ref);
    expect(res.status).toBe(200);
    const ko = await res.json();
    expect(ko.slug).toBe("arc-c29-task-board");
    expect(ko.title).toBe(entity.label);
  });

  it("deterministic — two generations are byte-identical (CI drift-check)", async () => {
    const a = await (await app.request("/knowledge/index.json")).text();
    const b = await (await app.request("/knowledge/index.json")).text();
    expect(b).toBe(a);
  });
});
