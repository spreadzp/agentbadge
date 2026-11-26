import { describe, it, expect, beforeAll } from "vitest";

process.env.MOCK_HEDERA = "true";
const { createApp } = await import("../src/server/index");
const { listTools } = await import("@agentbadge/mcp");
const { PUBLIC_STATS } = await import("../src/server/lib/public-stats");

// SLICE-259-22: cross-surface consistency gate.
// One source of truth per number: PUBLIC_STATS (rules/tools),
// live anon tools/list (curated set), live webmcp.json.
// Any numeric claim next to a known label must equal the
// live value — hardcoded drift fails this test.
//
// Companion gates (run together via `bun run check:consistency`):
// index-md-freshness-259 — banned regex on conneg outputs;
// legacy-wording-259     — Hedera/HTS/HCS marking;
// canonical-articles-259 — sitemap↔canonical↔Link:;
// robots-url-matrix-259  — advertised URLs × robots;
// agent-workflows-259    — workflow contract ↔ routing;
// sitemaps-lastmod-259   — honest lastmod;
// agent-errors-259       — error-shape contract.

const app = createApp();

let anonToolCount = -1;
const texts = new Map<string, string>();

beforeAll(async () => {
  const res = await app.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const j = (await res.json()) as { result?: { tools?: unknown[] } };
  anonToolCount = j.result?.tools?.length ?? -1;

  for (const p of ["/", "/passport", "/about", "/pricing", "/index.md", "/llms.txt", "/agents.txt"]) {
    texts.set(p, await (await app.request(p)).text());
  }
});

interface ClaimPattern {
  name: string;
  /** global regex — capture group 1 is the claimed number */
  re: RegExp;
  /** accepted live values for this claim */
  expected: () => number[];
}

/**
 * Direct claim patterns — a digit is a claim only when it directly
 * precedes the unit ("76 tools") or sits in a stat tile next to the
 * label (">76</div><div>MCP Tools"). Prose windows are too noisy:
 * "159 checks across 25 categories" puts an unrelated count nearby.
 */
const CLAIM_PATTERNS: ClaimPattern[] = [
  {
    name: "mcp-tools",
    re: /(?<![\w.:-])(\d+)\s+(?:curated\s+)?(?:MCP\s+)?tools\b/gi,
    expected: () => [PUBLIC_STATS.mcpTools, PUBLIC_STATS.webmcpTools, anonToolCount],
  },
  {
    name: "checks",
    re: /(?<![\w.:-])(\d+)\s+(?:deterministic\s+)?(?:agent-readiness\s+)?checks\b/gi,
    expected: () => [PUBLIC_STATS.rules],
  },
  {
    name: "tools-tile",
    re: />(\d+)<\/div>\s*<div[^>]*>\s*MCP Tools/gi,
    expected: () => [PUBLIC_STATS.mcpTools],
  },
  {
    name: "checks-tile",
    re: />(\d+)<\/div>\s*<div[^>]*>\s*Readiness Checks/gi,
    expected: () => [PUBLIC_STATS.rules],
  },
];

function claimsFor(text: string, pattern: ClaimPattern): { value: number; at: number }[] {
  const out: { value: number; at: number }[] = [];
  for (const m of text.matchAll(pattern.re)) {
    out.push({ value: Number(m[1]), at: m.index ?? 0 });
  }
  return out;
}

describe("SLICE-259-22: cross-surface consistency", () => {
  it("anon tools/list count == llms.txt curated claim", () => {
    expect(anonToolCount).toBeGreaterThan(0);
    const llms = texts.get("/llms.txt")!;
    const m = llms.match(/(\d+)\s+(?:unique\s+)?curated tools/);
    expect(m, "llms.txt must declare '<N> curated tools'").toBeTruthy();
    expect(Number(m![1])).toBe(anonToolCount);
  });

  it("PUBLIC_STATS.mcpTools == live listTools().length", () => {
    expect(PUBLIC_STATS.mcpTools).toBe(listTools().length);
    expect(PUBLIC_STATS.mcpTools).toBeGreaterThan(0);
  });

  it("tool-count claims on current-facing pages equal live counts", () => {
    const pattern = CLAIM_PATTERNS.find((p) => p.name === "mcp-tools")!;
    const tile = CLAIM_PATTERNS.find((p) => p.name === "tools-tile")!;
    for (const [path, text] of texts) {
      if (path === "/llms.txt") continue; // namespace splits — separate rules below
      for (const c of [...claimsFor(text, pattern), ...claimsFor(text, tile)]) {
        expect(
          pattern.expected(),
          `${path} claims ${c.value} tools @${c.at} — live: mcp=${PUBLIC_STATS.mcpTools}, webmcp=${PUBLIC_STATS.webmcpTools}, anon=${anonToolCount}`,
        ).toContain(c.value);
      }
    }
  });

  it("rules/checks claims equal PUBLIC_STATS.rules", () => {
    const pattern = CLAIM_PATTERNS.find((p) => p.name === "checks")!;
    const tile = CLAIM_PATTERNS.find((p) => p.name === "checks-tile")!;
    for (const [path, text] of texts) {
      for (const c of [...claimsFor(text, pattern), ...claimsFor(text, tile)]) {
        expect(
          c.value,
          `${path} claims ${c.value} checks @${c.at} — live rules=${PUBLIC_STATS.rules}`,
        ).toBe(PUBLIC_STATS.rules);
      }
    }
  });

  it("llms.txt headline claims live rules + curated counts", () => {
    const llms = texts.get("/llms.txt")!;
    const checks = llms.match(/(\d+)\s+deterministic agent-readiness checks/);
    expect(checks, "llms.txt must declare the rules count").toBeTruthy();
    expect(Number(checks![1])).toBe(PUBLIC_STATS.rules);
  });

  it("webmcp.json tool count == PUBLIC_STATS.webmcpTools == llms.txt claim", async () => {
    const res = await app.request("/.well-known/webmcp.json");
    expect(res.status).toBe(200);
    const w = (await res.json()) as { tools?: unknown[] };
    expect(w.tools?.length).toBe(PUBLIC_STATS.webmcpTools);
    const llms = texts.get("/llms.txt")!;
    const m = llms.match(/(\d+)\s+keyless tools/);
    expect(m, "llms.txt must declare the webmcp count").toBeTruthy();
    expect(Number(m![1])).toBe(PUBLIC_STATS.webmcpTools);
  });

  it("agent-card declared endpoints all resolve (none 404)", { timeout: 20000 }, async () => {
    const res = await app.request("/.well-known/agent-card.json");
    expect(res.status).toBe(200);
    const card = (await res.json()) as Record<string, unknown>;

    // Collect every declared path/URL on the same origin.
    const urls = new Set<string>();
    const walk = (v: unknown) => {
      if (typeof v === "string") {
        if (v.startsWith("/") && !v.startsWith("//")) urls.add(v);
        else if (v.startsWith("https://agentbadge.xyz/")) urls.add(new URL(v).pathname);
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(card);

    const missing: string[] = [];
    for (const u of urls) {
      if (u.includes("{")) continue; // URL template (e.g. /did/{did})
      let r = await app.request(u);
      if (r.status === 404) {
        // May be POST-only — GET 404 on those is a routing fact.
        r = await app.request(u, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
      }
      if (r.status === 404) missing.push(u);
    }
    expect(missing, `agent-card advertises dead endpoints: ${missing.join(", ")}`).toEqual([]);
  });

  it("claim extractor catches artificial divergence (meta-test)", () => {
    // The gate must fail on a hardcoded drift — prove the detector works.
    const fake = `<div>38</div><div>MCP Tools</div> and 99 curated tools on Arc and 73 deterministic checks`;
    for (const pattern of CLAIM_PATTERNS) {
      const found = claimsFor(fake, pattern).map((c) => c.value);
      for (const v of found) {
        expect(pattern.expected(), `${pattern.name} claim ${v} is drift`).not.toContain(v);
      }
    }
    // Sanity: it did find the planted numbers.
    const tools = CLAIM_PATTERNS.find((p) => p.name === "mcp-tools")!;
    const tile = CLAIM_PATTERNS.find((p) => p.name === "tools-tile")!;
    const checks = CLAIM_PATTERNS.find((p) => p.name === "checks")!;
    expect(claimsFor(fake, tools).map((c) => c.value)).toContain(99);
    expect(claimsFor(fake, tile).map((c) => c.value)).toContain(38);
    expect(claimsFor(fake, checks).map((c) => c.value)).toContain(73);
  });
});
