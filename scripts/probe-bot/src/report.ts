/**
 * Report → docs/LOGS/Analisis/probe-runs/probe-report-<ts>.md
 * (D-234-38-Q10). Junior-friendly format like Analisis/2111.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunSummary } from "./types";

const HERE = dirname(fileURLToPath(import.meta.url));
// hackathon/server/scripts/probe-bot/src → hedera/docs/LOGS/Analisis/probe-runs
export const REPORTS_DIR = join(HERE, "..", "..", "..", "..", "..", "docs", "LOGS", "Analisis", "probe-runs");

export function renderMarkdown(s: RunSummary): string {
  const fails = s.results.filter(r => r.verdict === "fail");
  const suspects = s.results.filter(r => r.verdict === "suspect" || r.verdict === "inconclusive");

  const row = (r: typeof s.results[number]) =>
    `| ${r.endpoint} | ${r.scenario} | ${r.status ?? "ERR"} | ${r.verdict} | ${r.requestId ?? "—"} | ${r.note.replace(/\|/g, "\\|").slice(0, 120)} |`;

  const matrix = new Map<string, Map<string, string>>();
  for (const r of s.results) {
    if (!matrix.has(r.endpoint)) matrix.set(r.endpoint, new Map());
    const cell = r.status != null ? String(r.status) : r.verdict === "inconclusive" ? "?" : "ERR";
    matrix.get(r.endpoint)!.set(r.scenario, cell);
  }
  const scenarios = [...new Set(s.results.map(r => r.scenario))].sort();
  const matrixTable = [
    `| endpoint | ${scenarios.join(" | ")} |`,
    `|---|${scenarios.map(() => "---").join("|")}|`,
    ...[...matrix.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ep, cells]) =>
      `| ${ep} | ${scenarios.map(sc => cells.get(sc) ?? "·").join(" | ")} |`),
  ].join("\n");

  return `# probe-report ${s.runId}

- **target:** ${s.target} · **locus:** ${s.locus} · **layer:** ${s.layer}
- **window:** ${s.started} → ${s.ended ?? "?"}
- **counts:** ${Object.entries(s.counts).map(([k, v]) => `${k}=${v}`).join(" · ")}
${s.dryRun ? "- **DRY-RUN** — ни одного запроса не отправлено\n" : ""}
Собственный трафик различим по UA \`AgentBadge-ProbeBot/0.1\` и
\`x-probe-case\` header (= case_key в probe-state.db).
DB-сверка: \`payload->>'requestId'\` = X-Request-Id из ответа.

## New suspects (fail / suspect / inconclusive)

${fails.length + suspects.length === 0 ? "_нет — все кейсы в контракте_" : ""}
${fails.length ? `### FAIL (контракт нарушен — 5xx/утечки/неожиданные 2xx)

| endpoint | scenario | status | verdict | requestId | note |
|---|---|---|---|---|---|
${fails.map(row).join("\n")}` : ""}
${suspects.length ? `### SUSPECT / INCONCLUSIVE

| endpoint | scenario | status | verdict | requestId | note |
|---|---|---|---|---|---|
${suspects.map(row).join("\n")}` : ""}

## Матрица endpoint × scenario → status

${matrixTable}
`;
}

export function writeReport(s: RunSummary, dir = REPORTS_DIR): string {
  mkdirSync(dir, { recursive: true });
  const ts = s.started.replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const path = join(dir, `probe-report-${ts}-${s.runId}.md`);
  writeFileSync(path, renderMarkdown(s));
  s.reportPath = path;
  return path;
}
