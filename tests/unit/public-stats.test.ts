/**
 * PUBLIC_STATS guard test — SLICE-218-1 (D-218-1).
 *
 * Two jobs:
 * 1. PUBLIC_STATS derives from the canonical sources (rule descriptions,
 *    category/pillar maps, MCP + WebMCP tool registries).
 * 2. Public-facing source files must not reintroduce hardcoded total
 *    counts — the drift that produced "72/82/122/130/145 rules" and
 *    "15/17/18 categories" claims across different pages.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_STATS, injectDynamicFacts, publicStatsVars } from "../../src/server/lib/public-stats";
import {
  RULE_DESCRIPTIONS,
  CATEGORY_DESCRIPTIONS,
  PILLAR_DESCRIPTIONS,
} from "../../src/agent-readiness/rule-descriptions";

const SRC_ROOT = join(fileURLToPath(import.meta.url), "../../..");

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (/\.(ts|md)$/.test(entry)) {
      yield full;
    }
  }
}

/** Directories whose content is rendered to public surfaces. */
const SCANNED_DIRS = [
  "src/views",
  "src/server",
];

/**
 * Files where a numeric total-count claim is legitimate and must not be
 * rewritten by the guard:
 * - historical audit logs / dataset rows (notes-data, regression fixtures)
 * - internal rule-description taxonomy docs (pillar→category mapping)
 * - schema/monitoring internals not rendered as marketing copy
 * - articles describing third-party tool counts (GEC's own MCP)
 * - example outputs and this test itself
 */
const EXEMPT_PATHS: RegExp[] = [
  /notes-data\.ts$/,
  /report\.schema\.ts$/,
  /snapshot-verifier\.ts$/,
  /src\/monitoring\//,
  /src\/agent-readiness\//,
  /gec-interop-field-report\.ts$/,
  /arc-c16-verdict-verification\.ts$/,
  /openapi-vs-agent-readiness\.md$/,
  /public-stats\.ts$/,
  /public-stats\.test\.ts$/,
];

const BANNED_PATTERNS: { name: string; re: RegExp }[] = [
  {
    name: "hardcoded rules/checks across categories",
    re: /\b\d+\+?\s+(?:agent readiness )?(?:rules|checks)\s+across\s+\d+\s+categories\b/i,
  },
  {
    name: "hardcoded total agent readiness rules",
    re: /\b\d+\+?\s+agent readiness (?:rules|checks)\b/i,
  },
  {
    name: "hardcoded MCP server tool total",
    re: /\b(?:MCP\s+(?:server\s+)?with|with|exposes?|server\s+with)\s+\d+\+?\s+tools\b/i,
  },
  {
    name: "hardcoded 'N checks in seconds' marketing claim",
    re: /\b\d+\+?\s+(?:deterministic\s+)?checks\s+in seconds\b/i,
  },
];

describe("PUBLIC_STATS", () => {
  it("derives rule count from the canonical ruleset", () => {
    expect(PUBLIC_STATS.rules).toBe(RULE_DESCRIPTIONS.length);
    expect(PUBLIC_STATS.rules).toBeGreaterThan(0);
  });

  it("derives category and pillar counts from description maps", () => {
    expect(PUBLIC_STATS.categories).toBe(
      Object.keys(CATEGORY_DESCRIPTIONS).length,
    );
    expect(PUBLIC_STATS.pillars).toBe(
      Object.keys(PILLAR_DESCRIPTIONS).length,
    );
    expect(PUBLIC_STATS.categories).toBeGreaterThan(0);
    expect(PUBLIC_STATS.pillars).toBeGreaterThan(0);
  });

  it("exposes template vars for content injection", () => {
    const vars = publicStatsVars();
    expect(vars.RULE_COUNT).toBe(String(PUBLIC_STATS.rules));
    expect(vars.CATEGORY_COUNT).toBe(String(PUBLIC_STATS.categories));
    expect(vars.PILLAR_COUNT).toBe(String(PUBLIC_STATS.pillars));
    expect(vars.LAST_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("injectDynamicFacts resolves placeholders and passes unknown ones through", () => {
    const out = injectDynamicFacts(
      "{{RULE_COUNT}} rules / {{CATEGORY_COUNT}} categories / {{UNKNOWN_KEY}}",
    );
    expect(out).toBe(
      `${PUBLIC_STATS.rules} rules / ${PUBLIC_STATS.categories} categories / {{UNKNOWN_KEY}}`,
    );
  });
});

describe("no stale hardcoded totals on public surfaces", () => {
  const offenders: string[] = [];
  for (const dir of SCANNED_DIRS) {
    for (const file of walk(join(SRC_ROOT, dir))) {
      const rel = relative(SRC_ROOT, file);
      if (EXEMPT_PATHS.some((re) => re.test(rel))) continue;
      const src = readFileSync(file, "utf-8");
      for (const { name, re } of BANNED_PATTERNS) {
        if (re.test(src)) {
          offenders.push(`${rel} — ${name}: ${src.match(re)?.[0]}`);
        }
      }
    }
  }

  it("has no banned count literals outside PUBLIC_STATS", () => {
    expect(offenders).toEqual([]);
  });
});
