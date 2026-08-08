export interface RuleResult {
  rule_id: string;
  status: string;
  category?: string;
  name?: string;
  fix?: {
    eligible: boolean;
    type: string;
    note?: string;
  };
}

const CATEGORY_LABELS: Record<string, string> = {
  discovery: "Discovery",
  documentation: "Documentation",
  actionability: "Actionability",
  machine_readable: "Machine Readable",
  verification: "Verification",
  content_negotiation: "Content Negotiation",
  payments: "Payments",
  bazaar: "Bazaar",
  openapi: "OpenAPI",
  skills: "Skills",
  agents_txt: "Agents.txt",
  webmcp: "WebMCP",
  identity: "Identity",
  bot_auth: "Bot Auth",
  infrastructure: "Infrastructure",
};

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

export function formatPretty(
  results: RuleResult[],
  opts?: { score?: number },
): string {
  const header = opts?.score !== undefined
    ? `Agent Readiness Score: ${opts.score}/100\n`
    : "";

  const byCategory = new Map<string, RuleResult[]>();
  for (const r of results) {
    const cat = r.category ?? "other";
    const list = byCategory.get(cat) ?? [];
    list.push(r);
    byCategory.set(cat, list);
  }

  const sections: string[] = [];
  for (const [cat, items] of byCategory) {
    const label = CATEGORY_LABELS[cat] ?? cat;
    const lines = items.map((r) => {
      const icon = r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : r.status.toUpperCase();
      const name = r.name ?? r.rule_id;
      return `  [${icon}] ${r.rule_id}: ${name}`;
    });
    sections.push(`${label}:\n${lines.join("\n")}`);
  }

  return `${header}\n${sections.join("\n\n")}`;
}

export function generateReportUrl(baseUrl: string, scanId: string): string {
  return `${baseUrl}/report?scan=${scanId}`;
}
