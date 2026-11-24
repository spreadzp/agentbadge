// EPIC-262 (SLICE-262-34): canonical SARIF 2.1.0 mapping — the ONE
// place rule_id → SARIF ruleId/level lives (spec risk: no ad-hoc
// mapping inside the action). Results are the NEW-open findings —
// a CI gate signals regressions, still-open findings stay visible
// in the diff payload but don't re-alert every run.
import type { IntelReport } from "../report/schema";
import type { IntelReportDiff } from "./types";

const LEVEL: Record<string, string> = {
  fail: "error",
  warn: "warning",
  unknown: "note",
};

export function diffToSarif(
  diff: Pick<IntelReportDiff, "new_findings" | "head_ruleset" | "site_id">,
  head: Pick<IntelReport, "findings"> | null,
): Record<string, unknown> {
  const byRule = new Map(
    (head?.findings ?? []).map((f) => [f.rule_id, f] as const),
  );
  const rules = diff.new_findings
    .map((id) => byRule.get(id))
    .filter((f): f is NonNullable<typeof f> => f !== undefined)
    .map((f) => ({
      id: f.rule_id,
      name: f.name,
      shortDescription: { text: f.claim || f.name },
      properties: { surface: f.surface, severity: f.severity },
    }));
  return {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "agentbadge-intel",
            informationUri: "https://agentbadge.xyz",
            version: diff.head_ruleset?.version ?? "unknown",
            rules,
          },
        },
        results: diff.new_findings.map((ruleId) => {
          const f = byRule.get(ruleId);
          return {
            ruleId,
            level: LEVEL[f?.status ?? "fail"] ?? "error",
            message: {
              text: f
                ? `${f.name}: ${f.reason || f.claim}`
                : `new finding ${ruleId}`,
            },
            properties: {
              site_id: diff.site_id,
              severity: f?.severity ?? null,
              surface: f?.surface ?? null,
            },
          };
        }),
      },
    ],
  };
}
