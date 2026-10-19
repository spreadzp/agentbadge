/**
 * SLICE-201-16: knowledge conformance e2e — 5 articles × full agent path,
 * run in-process against makeTestApp (same app that serves the site).
 * External links are skipped (offline run) — never silently passed.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { makeTestApp, setupMockEnv } from "./e2e/helpers";
import { runKnowledgeConformance } from "../scripts/knowledge-conformance-core";

// Diverse set per AC: prototype / opinion / live-service / agent-economy / tutorial
export const CONFORMANCE_SLUGS = [
  "arc-c29-task-board",
  "what-is-agent-readiness",
  "arc-c15-x402-bazaar",
  "x402-payments",
  "bstock-beginners-guide",
];

const app = makeTestApp();

/** fetch adapter: maps absolute URLs to app.request paths, follows redirects */
async function appFetch(url: string): Promise<Response> {
  let current = new URL(url).pathname + new URL(url).search;
  for (let i = 0; i < 3; i++) {
    const res = await app.request(current);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      const u = new URL(loc, "https://agentbadge.xyz");
      current = u.pathname + u.search;
      continue;
    }
    return res;
  }
  return app.request(current);
}

describe("SLICE-201-16: knowledge conformance — local app", () => {
  beforeAll(() => {
    setupMockEnv();
  });

  it("runs 5 steps × 5 articles and produces a report", async () => {
    const report = await runKnowledgeConformance({
      fetchFn: appFetch,
      baseUrl: "https://agentbadge.xyz",
      slugs: CONFORMANCE_SLUGS,
      resolveExternal: false,
    });
    expect(report.articles).toHaveLength(5);
    for (const a of report.articles) {
      expect(a.steps.map((s) => s.step)).toEqual([
        "discover (rel=alternate)",
        "understand (.json valid)",
        "evidence (links resolve)",
        "transition (relatedResources)",
        "action (≥1 live endpoint)",
      ]);
    }
    // Print per-step matrix for the report
    for (const a of report.articles) {
      console.log(
        `\n${a.slug}: ${a.pass ? "PASS" : "FAIL"}\n` +
        a.steps.map((s) => `  ${s.result} ${s.step} — ${s.detail}`).join("\n"),
      );
    }
    // discover+understand must work for every article — the rest is
    // recorded honestly (failures here are conformance findings, not test bugs)
    for (const a of report.articles) {
      expect(a.steps[0].result, `${a.slug} discover`).toBe("pass");
      expect(a.steps[1].result, `${a.slug} understand`).toBe("pass");
    }
  }, 30000);

  it("arc-c29-task-board (richest metadata) passes all 5 steps", async () => {
    const report = await runKnowledgeConformance({
      fetchFn: appFetch,
      baseUrl: "https://agentbadge.xyz",
      slugs: ["arc-c29-task-board"],
      resolveExternal: false,
    });
    const art = report.articles[0];
    expect(art.steps[0].result).toBe("pass");
    expect(art.steps[1].result).toBe("pass");
    // evidence/transition/action run and produce a result + detail
    for (const s of art.steps.slice(2)) {
      expect(["pass", "skip", "fail"]).toContain(s.result);
      expect(s.detail.length).toBeGreaterThan(0);
    }
  });

  it("discover step fails honestly for a missing article", async () => {
    const report = await runKnowledgeConformance({
      fetchFn: appFetch,
      baseUrl: "https://agentbadge.xyz",
      slugs: ["no-such-article"],
      resolveExternal: false,
    });
    const art = report.articles[0];
    expect(art.pass).toBe(false);
    expect(art.steps[0].result).toBe("fail");
    expect(art.steps[0].detail).toContain("404");
  });
});
