/**
 * SLICE-201-16 (EPIC-201, трек B — финал): knowledge conformance e2e.
 * Walks the full agent path for 5 diverse articles:
 *   discover (rel=alternate) → understand (.json valid) → evidence (links
 *   resolve) → transition (relatedResources) → action (≥1 live endpoint).
 *
 * Modes:
 *   --local            in-process makeTestApp run (no server, no external
 *                      network — external links reported as skipped-external)
 *   --endpoint <url>   live run against a deployment (default
 *                      CONF_ENDPOINT/E2E_TARGET_URL/http://localhost:4021);
 *                      external links fetched for real
 *
 * Output:
 *   docs/EPICS/201-agent-economy-interface/conformance-knowledge-report.md
 * Exit code: 0 if every article passes, 1 otherwise.
 *
 * Usage:
 *   bun scripts/knowledge-conformance.mts --local
 *   bun scripts/knowledge-conformance.mts --endpoint https://agentbadge.xyz
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runKnowledgeConformance, renderReportMarkdown } from "./knowledge-conformance-core";

const ARGS = process.argv.slice(2);
const LOCAL = ARGS.includes("--local") || !ARGS.includes("--endpoint");
const ENDPOINT =
  ARGS[ARGS.indexOf("--endpoint") + 1] ??
  process.env.CONF_ENDPOINT ??
  process.env.E2E_TARGET_URL ??
  "http://localhost:4021";

const SLUGS = [
  "arc-c29-task-board",
  "what-is-agent-readiness",
  "arc-c15-x402-bazaar",
  "x402-payments",
  "bstock-beginners-guide",
];

async function main() {
  let fetchFn: (url: string) => Promise<Response>;
  let baseUrl: string;
  let resolveExternal = true;

  if (LOCAL) {
    const { makeTestApp, setupMockEnv } = await import("../tests/e2e/helpers");
    setupMockEnv();
    const app = makeTestApp();
    baseUrl = "https://agentbadge.xyz";
    resolveExternal = false;
    fetchFn = async (url: string) => {
      let current = new URL(url).pathname + new URL(url).search;
      for (let i = 0; i < 3; i++) {
        const res = await app.request(current);
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get("location");
          if (!loc) return res;
          const u = new URL(loc, baseUrl);
          current = u.pathname + u.search;
          continue;
        }
        return res;
      }
      return app.request(current);
    };
  } else {
    baseUrl = ENDPOINT.replace(/\/+$/, "");
    fetchFn = (url) => fetch(url);
  }

  console.log(
    `knowledge-conformance: ${LOCAL ? "in-process app" : `endpoint ${baseUrl}`}, ${SLUGS.length} articles…`,
  );
  const report = await runKnowledgeConformance({
    fetchFn,
    baseUrl,
    slugs: SLUGS,
    resolveExternal,
  });
  const md = renderReportMarkdown(report);
  const out = resolve(
    import.meta.dir,
    "../../../docs/EPICS/201-agent-economy-interface/conformance-knowledge-report.md",
  );
  writeFileSync(out, md);
  console.log(md);
  console.log(`\n→ ${out}`);
  process.exit(report.totalPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
