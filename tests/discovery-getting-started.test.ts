/**
 * SLICE-206-8 (EPIC-206): "Get started in 3 calls" onboarding pack.
 *
 * Contracts:
 * - llms.txt carries a top-of-file "Get started in 3 calls" section
 *   with copy-pasteable curl commands against REAL endpoints
 *   (register → discover services → paid call / board claim).
 * - /agent-guide/getting-started serves the EN Markdown tutorial.
 * - The tutorial's internal links point at surfaces that exist.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLlmsTxt,
  type DiscoverySources,
} from "../src/server/lib/agent-discovery";
import { agentKnowledgeRoutes } from "../src/server/routes/agent-knowledge";

const HERE = dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = join(HERE, "../src/server/agent-knowledge");

function mockSources(overrides: Partial<DiscoverySources> = {}): DiscoverySources {
  return {
    baseUrl: "https://agentbadge.xyz",
    authSection: "## DID Signature Authentication\n\n...challenge...\n",
    llmsCore:
      "# AgentBadge\n\n> Agent identity, discovery, and micropayments on Arc.\n",
    articles: [],
    faqEntries: [],
    tiers: [],
    appRoutes: [],
    skus: [],
    ...overrides,
  };
}

describe("llms.txt — Get started in 3 calls", () => {
  const txt = buildLlmsTxt(mockSources());

  it("contains the section header", () => {
    expect(txt).toContain("## Get started in 3 calls");
  });

  it("section sits before the auth section (top of file)", () => {
    const i = txt.indexOf("## Get started in 3 calls");
    const j = txt.indexOf("## DID Signature Authentication");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(-1);
    expect(i).toBeLessThan(j);
  });

  it("covers the register → discover → work funnel with real endpoints", () => {
    expect(txt).toContain("-X POST https://agentbadge.xyz/api/v1/agents/register");
    expect(txt).toContain("https://agentbadge.xyz/api/v1/services");
    expect(txt).toContain("/pricing.json");
    expect(txt).toContain("/api/eaas/verdict");
    expect(txt).toContain("/api/board/cards");
  });

  it("links to the full tutorial and corpus", () => {
    expect(txt).toContain("/agent-guide/getting-started");
    expect(txt).toContain("/llms-full.txt");
  });
});

describe("GET /agent-guide/getting-started", () => {
  it("returns 200 text/markdown", async () => {
    const res = await agentKnowledgeRoutes.request("/agent-guide/getting-started");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
  });

  it("tutorial covers register, keyed auth, x402, and board earn path", async () => {
    const res = await agentKnowledgeRoutes.request("/agent-guide/getting-started");
    const md = await res.text();
    expect(md).toContain("/api/v1/agents/register");
    expect(md).toContain("agb_");
    expect(md).toContain("x402");
    expect(md).toContain("/api/board/cards");
    expect(md).toContain("/pricing.json");
  });

  it("agent-knowledge .md files referenced by the tutorial exist on disk", () => {
    const expected = ["getting-started.md", "earnings.md", "post-task.md", "context.md"];
    for (const f of expected) {
      const stat = readFileSync(join(KNOWLEDGE_DIR, f), "utf-8");
      expect(stat.length).toBeGreaterThan(0);
    }
  });
});
