/**
 * SLICE-234-27: agent-guide link integrity.
 *
 * Prod 404s (7d): /agent-guide/concepts/mcp ×7,
 * /agent-guide/capabilities/mcp-json-rpc-client ×6 — crawlers follow
 * the /agent-guide/{concepts,capabilities}/<name> convention for names
 * declared in KO article metadata, and for hrefs inside articles.
 *
 * Two guards:
 *  1. Every agent-guide/(concepts|capabilities)/<name> href found in
 *     lib/blog/articles TS sources or agent-knowledge markdown must
 *     resolve to a real .md page (hard fail — a published link must work).
 *  2. KO capabilities/concepts names without pages are ratcheted
 *     against tests/fixtures/agent-guide-ko-known-gaps.json — the set
 *     may only SHRINK (new article with a new uncovered name fails
 *     until a page is added or the gap is consciously accepted).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTestApp, setupMockEnv } from "../e2e/helpers";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(ROOT, "src", "server");
const ARTICLES_DIR = join(SRC, "lib", "blog", "articles");
const KNOWLEDGE_DIR = join(SRC, "agent-knowledge");
const HREF_RE = /agent-guide\/(concepts|capabilities)\/([a-z0-9][a-z0-9-]*)/g;

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(ts|md)$/.test(e.name)) yield p;
  }
}

/** All agent-guide concept/capability hrefs referenced anywhere. */
function collectHrefs(): { kind: string; name: string; source: string }[] {
  const out: { kind: string; name: string; source: string }[] = [];
  const seen = new Set<string>();
  for (const file of [
    ...walk(ARTICLES_DIR),
    ...walk(KNOWLEDGE_DIR),
  ]) {
    const src = readFileSync(file, "utf-8");
    for (const m of src.matchAll(HREF_RE)) {
      const key = `${m[1]}/${m[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        kind: m[1],
        name: m[2],
        source: file.slice(ROOT.length + 1),
      });
    }
  }
  return out;
}

/** KO capabilities/concepts names declared in blog articles. */
function collectKoNames(): { capabilities: Set<string>; concepts: Set<string> } {
  const capabilities = new Set<string>();
  const concepts = new Set<string>();
  for (const f of readdirSync(ARTICLES_DIR).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(join(ARTICLES_DIR, f), "utf-8");
    for (const m of src.matchAll(/capabilities:\s*\[([^\]]*)\]/g)) {
      for (const s of m[1].split(",")) {
        const v = s.trim().replace(/["']/g, "");
        if (v) capabilities.add(v);
      }
    }
    for (const m of src.matchAll(/concepts:\s*\[([^\]]*)\]/g)) {
      for (const s of m[1].split(",")) {
        const v = s.trim().replace(/["']/g, "");
        if (v) concepts.add(v);
      }
    }
  }
  return { capabilities, concepts };
}

const pagePath = (kind: string, name: string) =>
  join(KNOWLEDGE_DIR, kind, `${name}.md`);

describe("SLICE-234-27: agent-guide link integrity", () => {
  setupMockEnv();
  const app = makeTestApp();

  it("GET /agent-guide/concepts/mcp → 200 text/markdown", async () => {
    const res = await app.request("/agent-guide/concepts/mcp");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(await res.text()).toContain("MCP");
  });

  it("GET /agent-guide/capabilities/mcp-json-rpc-client → 200", async () => {
    const res = await app.request(
      "/agent-guide/capabilities/mcp-json-rpc-client",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
  });

  it("GET /agent-guide/capabilities/x402 → 200 (was linked, missing)", async () => {
    const res = await app.request("/agent-guide/capabilities/x402");
    expect(res.status).toBe(200);
  });

  it("GET /agent-guide/capabilities/geo-optimization → 200 (was linked, missing)", async () => {
    const res = await app.request("/agent-guide/capabilities/geo-optimization");
    expect(res.status).toBe(200);
  });

  it("every agent-guide href in articles/knowledge resolves to a page", () => {
    const hrefs = collectHrefs();
    expect(hrefs.length).toBeGreaterThan(0);
    const broken = hrefs.filter(
      (h) => !existsSync(pagePath(h.kind, h.name)),
    );
    expect(
      broken,
      `broken agent-guide links: ${broken
        .map((b) => `${b.kind}/${b.name} (${b.source})`)
        .join(", ")}`,
    ).toEqual([]);
  });

  it("KO capability/concept names without pages match the known-gaps ratchet", () => {
    const fixture = JSON.parse(
      readFileSync(
        join(ROOT, "tests", "fixtures", "agent-guide-ko-known-gaps.json"),
        "utf-8",
      ),
    ) as { capabilities: string[]; concepts: string[] };
    const knownCaps = new Set(fixture.capabilities);
    const knownConcepts = new Set(fixture.concepts);

    const { capabilities, concepts } = collectKoNames();
    const capDir = join(KNOWLEDGE_DIR, "capabilities");
    const conDir = join(KNOWLEDGE_DIR, "concepts");
    const capFiles = new Set(readdirSync(capDir).map((f) => f.replace(/\.md$/, "")));
    const conFiles = new Set(readdirSync(conDir).map((f) => f.replace(/\.md$/, "")));

    const newCaps = [...capabilities].filter(
      (c) => !capFiles.has(c) && !knownCaps.has(c),
    );
    const newConcepts = [...concepts].filter(
      (c) => !conFiles.has(c) && !knownConcepts.has(c),
    );
    // Ratchet may only shrink: a NEW uncovered KO name fails here.
    expect(
      { newCapabilities: newCaps.sort(), newConcepts: newConcepts.sort() },
      "new KO capability/concept without an agent-guide page — " +
        "add the .md page or consciously extend the fixture",
    ).toEqual({ newCapabilities: [], newConcepts: [] });

    // And the fixture must not claim gaps that no longer exist
    // (a fixed page without fixture update is also a failure).
    const staleCaps = fixture.capabilities.filter(
      (c) => capFiles.has(c) || !capabilities.has(c),
    );
    const staleConcepts = fixture.concepts.filter(
      (c) => conFiles.has(c) || !concepts.has(c),
    );
    expect(
      { staleCapabilities: staleCaps, staleConcepts },
      "fixture lists gaps that are now covered or no longer referenced — " +
        "regenerate tests/fixtures/agent-guide-ko-known-gaps.json",
    ).toEqual({ staleCapabilities: [], staleConcepts: [] });
  });
});
