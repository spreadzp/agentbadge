export interface RuleResult {
  rule_id: string;
  status: string;
  fix?: {
    eligible: boolean;
    type: string;
    note?: string;
  };
}

export function shouldFailCi(results: RuleResult[]): boolean {
  return results.some((r) => r.status === "fail");
}

export function shouldFailThreshold(score: number, threshold: number): boolean {
  return score < threshold;
}

export function formatJsonOutput(results: RuleResult[]): string {
  return JSON.stringify({ results }, null, 2);
}

export function formatFixOutput(results: RuleResult[]): string {
  const failing = results.filter((r) => r.status === "fail" && r.fix?.eligible);
  if (failing.length === 0) {
    return "No fixable rules failing.";
  }
  const lines = failing.map((r) => {
    const note = r.fix?.note ?? "No specific fix note available.";
    return `${r.rule_id}: ${note} [fix type: ${r.fix?.type ?? "unknown"}]`;
  });
  return `Fix suggestions:\n${lines.join("\n")}`;
}
