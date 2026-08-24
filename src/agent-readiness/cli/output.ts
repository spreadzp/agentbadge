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
  seo_aeo: "SEO / AEO",
  accessibility: "Accessibility",
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

export function formatMarkdownOutput(
  results: RuleResult[],
  opts?: { score?: number; grade?: string; fixHints?: boolean; reportUrl?: string },
): string {
  const lines: string[] = [];
  lines.push("# Agent Readiness Report");
  if (opts?.score !== undefined) {
    const gradeStr = opts.grade ? ` (${opts.grade})` : "";
    lines.push(`\n**Score:** ${opts.score}/100${gradeStr}`);
  }
  if (opts?.reportUrl) {
    lines.push(`\n**Web Report:** ${opts.reportUrl}`);
  }
  lines.push("\n## Results\n");
  lines.push("| Rule | Status | Category | Name |");
  lines.push("|------|--------|----------|------|");
  for (const r of results) {
    const icon = r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : r.status.toUpperCase();
    lines.push(`| ${r.rule_id} | ${icon} | ${r.category ?? "-"} | ${r.name ?? r.rule_id} |`);
  }
  if (opts?.fixHints) {
    const failing = results.filter((r) => r.status === "fail" && r.fix?.eligible);
    if (failing.length > 0) {
      lines.push("\n## Fix Suggestions\n");
      for (const r of failing) {
        lines.push(`- **${r.rule_id}**: ${r.fix?.note ?? "No specific fix note."}`);
      }
    }
  }
  return lines.join("\n");
}

export function generateReportUrl(baseUrl: string, scanId: string): string {
  return `${baseUrl}/report?scan=${scanId}`;
}
