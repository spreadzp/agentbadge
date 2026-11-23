import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { Hono } from "hono";
import { contentNegotiationMiddleware } from "../../src/server/middleware/content-negotiation";
import { PUBLIC_STATS } from "../../src/server/lib/public-stats";

// SLICE-259-13: homepage markdown/json/text conneg + .md mirrors must
// not ship stale facts — the foreign `npx agentbadge` package, the
// never-published `npx @agentbadge/cli`, "built on Hedera" positioning
// (identity is ERC-8004 on Arc now; Hedera is legacy-labelled), or a
// hardcoded MCP tool count that drifts from the live registry.

const BANNED: Array<[RegExp, string]> = [
  [/\bnpx agentbadge\b/, "unscoped npx agentbadge (foreign npm package)"],
  [/\bnpm i(?:nstall)?(?: -g)? agentbadge\b/, "unscoped npm install agentbadge"],
  [/\bnpx @agentbadge\/cli\b/, "npx @agentbadge/cli (package never published)"],
  // SLICE-259-23: bin name ≠ package name — `agentbadge-scan` the
  // npm package does not exist; the bin lives in @agentbadge/scanner.
  [/\bnpx agentbadge-scan\b/, "npx agentbadge-scan (bin ≠ package; use npx @agentbadge/scanner)"],
  [/\bnpm i(?:nstall)?(?: -g)? agentbadge-scan\b/, "npm install agentbadge-scan (bin ≠ package)"],
  // SLICE-259-24: the GitHub Action repo was never created — CI scans
  // run as a plain `run: npx @agentbadge/scanner` workflow step.
  [/agentbadge\/scan-action/, "agentbadge/scan-action (action repo never created)"],
  [/built on Hedera/i, "'built on Hedera' — legacy positioning"],
  [/\bHCS-based\b/, "'HCS-based' — legacy positioning"],
  [/\b76 tools\b|\b\d{2,} MCP tools\b(?!\$\{)/, "hardcoded MCP tool count"],
];

const app = new Hono();
app.use(contentNegotiationMiddleware());
app.get("/", (c) => c.html("<html>homepage</html>"));

async function homepageFor(accept: string): Promise<string> {
  const res = await app.request("/", { headers: { Accept: accept } });
  expect(res.status).toBe(200);
  return res.text();
}

describe("SLICE-259-13: homepage conneg freshness gate", () => {
  it.each(["text/markdown", "text/plain", "application/json"])(
    "Accept: %s has no stale claims",
    async (accept) => {
      const body = await homepageFor(accept);
      for (const [re, why] of BANNED) {
        expect(body, `${why} found in ${accept} body`).not.toMatch(re);
      }
    },
  );

  it("markdown output carries the live MCP tool count", async () => {
    const md = await homepageFor("text/markdown");
    expect(md).toContain(String(PUBLIC_STATS.mcpTools));
  });

  it("markdown Quick Start uses a live command (scan API or web)", async () => {
    const md = await homepageFor("text/markdown");
    expect(md).toMatch(/\/scan\?url=|\/services\/scanner|curl/);
  });

  it("agent-knowledge index.md has no stale claims", () => {
    const md = readFileSync(
      "src/server/agent-knowledge/index.md",
      "utf-8",
    );
    for (const [re, why] of BANNED) {
      expect(md, `${why} found in agent-knowledge/index.md`).not.toMatch(
        re,
      );
    }
  });

  // SLICE-259-23: dead-package references are wrong in ANY file —
  // they never existed. Count/positioning patterns stay scoped to
  // living docs; dated articles keep their publication-time numbers.
  // Entries 0-5 = never-existing refs (dead packages + scan-action)
  // — banned everywhere incl. dated articles; the rest only in
  // living docs.
  const BANNED_PACKAGES = BANNED.slice(0, 6);
  it("agent-knowledge + blog sources: no dead-package references", () => {
    const roots = [
      "src/server/agent-knowledge",
      "src/server/lib/blog/articles",
      "src/server/content",
    ];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/\.(md|ts)$/.test(e.name)) files.push(p);
      }
    };
    roots.forEach(walk);
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const body = readFileSync(f, "utf-8");
      const banned = /articles\//.test(f) ? BANNED_PACKAGES : BANNED;
      for (const [re, why] of banned) {
        expect(body, `${why} found in ${f}`).not.toMatch(re);
      }
    }
  });
});
