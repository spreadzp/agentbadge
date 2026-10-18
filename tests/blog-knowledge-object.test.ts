/**
 * SLICE-201-5 (EPIC-201, track B): blog Knowledge Objects — every published
 * article is readable by an agent as a typed JSON object at /blog/:slug.json,
 * validatable against public/schemas/content/v1.json with controlled
 * vocabularies (status, claim status, evidence type, action type,
 * relatedResources type).
 *
 *   Route     GET /blog/:slug.json → Content Knowledge Object v1 (200 or 404)
 *   Schema    public/schemas/content/v1.json (served at /schemas/content/v1.json)
 *   Map       knowledge-map.json v1.3.0 — node.articles are resolvable slugs
 *   Drift     toKnowledgeObject(article) is deterministic (regen == diff-empty)
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import Ajv from "ajv/dist/2020";
import { readFile } from "node:fs/promises";
import { blogRoutes } from "../src/server/routes/blog";
import { BLOG_ARTICLES } from "../src/server/lib/blog-data";

const app = new Hono();
app.route("/", blogRoutes);

let validate: ReturnType<Ajv["compile"]>;
async function getValidator() {
  if (!validate) {
    const schema = JSON.parse(
      await readFile("public/schemas/content/v1.json", "utf-8"),
    );
    validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  }
  return validate;
}

async function getKnowledgeObject(slug: string) {
  const res = await app.request(`/blog/${slug}.json`);
  return { res, body: res.status === 200 ? await res.json() : null };
}

describe("GET /blog/:slug.json — Content Knowledge Object v1", () => {
  it("reference article arc-c29-task-board → 200 + schema-valid + economicContext", async () => {
    const { res, body } = await getKnowledgeObject("arc-c29-task-board");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const v = await getValidator();
    expect(v(body), JSON.stringify(v.errors)).toBe(true);

    expect(body.type).toBe("article");
    expect(body.slug).toBe("arc-c29-task-board");
    expect(body.status).toBe("LIVE");
    // canonical is the HTML page, not the .json/.md mirror (D-201-16)
    expect(body.canonical).toBe("https://agentbadge.xyz/blog/arc-c29-task-board");
    expect(body.markdownUrl).toBe(
      "https://agentbadge.xyz/blog/arc-c29-task-board.md",
    );
    // agent-economy article → economicContext with board endpoints
    expect(body.economicContext?.endpoints?.board).toContain("/api/board/cards");
    expect(body.economicContext?.payment?.currency).toBe("USDC");
    // actions use only real types
    for (const a of body.actions) {
      expect(["read", "view-demo", "view-code", "contact"]).toContain(a.type);
    }
    // relatedResources includes task-board link (D-201-23)
    expect(
      body.relatedResources?.some((r: { type: string }) => r.type === "task-board"),
    ).toBe(true);
  });

  it("all articles → 200 + schema-valid + qa non-empty + markdownUrl contains slug", async () => {
    const v = await getValidator();
    expect(BLOG_ARTICLES.length).toBeGreaterThanOrEqual(33);
    const failures: string[] = [];
    for (const article of BLOG_ARTICLES) {
      const { res, body } = await getKnowledgeObject(article.slug);
      if (res.status !== 200) {
        failures.push(`${article.slug}: HTTP ${res.status}`);
        continue;
      }
      if (!v(body)) {
        failures.push(
          `${article.slug}: schema ${JSON.stringify(v.errors?.slice(0, 2))}`,
        );
        continue;
      }
      if (!Array.isArray(body.qa) || body.qa.length === 0) {
        failures.push(`${article.slug}: qa empty`);
      }
      if (!body.markdownUrl?.includes(article.slug)) {
        failures.push(`${article.slug}: markdownUrl mismatch`);
      }
      if (body.canonical !== `https://agentbadge.xyz/blog/${article.slug}`) {
        failures.push(`${article.slug}: canonical mismatch`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("unknown slug → 404", async () => {
    const res = await app.request("/blog/no-such-article-xyz.json");
    expect(res.status).toBe(404);
  });

  it("generator is deterministic — two generations are deep-equal (CI drift-check)", async () => {
    const a = (await getKnowledgeObject("arc-c29-task-board")).body;
    const b = (await getKnowledgeObject("arc-c29-task-board")).body;
    expect(b).toEqual(a);
  });

  it("controlled vocabularies reject invalid values", async () => {
    const v = await getValidator();
    const { body } = await getKnowledgeObject("arc-c29-task-board");
    const bad = { ...body, status: "SHIPPED" };
    expect(v(bad)).toBe(false);
    const badClaim = {
      ...body,
      claims: [{ id: "c1", text: "x", status: "PROVEN" }],
    };
    expect(v(badClaim)).toBe(false);
    const badAction = {
      ...body,
      actions: [{ type: "hire-agent", label: "x", url: "y" }],
    };
    expect(v(badAction)).toBe(false);
  });
});

describe("knowledge-map.json v1.3.0 — articles are resolvable slugs", () => {
  it("every node.articles entry resolves to a BLOG_ARTICLES slug", async () => {
    const km = JSON.parse(
      await readFile("src/server/agent-knowledge/knowledge-map.json", "utf-8"),
    );
    expect(km.version).toBe("1.3.0");
    const slugs = new Set(BLOG_ARTICLES.map((a) => a.slug));
    const unresolved: string[] = [];
    for (const node of km.nodes) {
      for (const ref of node.articles ?? []) {
        if (typeof ref !== "string" || !slugs.has(ref)) {
          unresolved.push(`${node.id}:${String(ref)}`);
        }
      }
    }
    expect(unresolved).toEqual([]);
    // no numeric refs left
    const numeric = km.nodes.some((n: { articles?: unknown[] }) =>
      (n.articles ?? []).some((r) => typeof r === "number"),
    );
    expect(numeric).toBe(false);
  });
});
