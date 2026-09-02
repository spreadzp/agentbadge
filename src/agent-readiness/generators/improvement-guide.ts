export interface ScanCheck {
  id: string;
  name: string;
  status: string;
  category?: string;
  hint?: string;
  fixExample?: string;
}

export interface ScanResultForGuide {
  score: number;
  checks: ScanCheck[];
}

const CATEGORY_WEIGHTS: Record<string, number> = {
  discovery: 15,
  documentation: 15,
  machine_readable: 10,
  actionability: 10,
  content_negotiation: 10,
  openapi: 10,
  payments: 10,
  verification: 5,
  bazaar: 5,
  skills: 5,
  agents_txt: 5,
  webmcp: 5,
  identity: 5,
  bot_auth: 5,
  infrastructure: 5,
  seo_aeo: 5,
  accessibility: 4,
};

export function generateImprovementGuide(scanResult: ScanResultForGuide): string {
  const failing = scanResult.checks.filter(
    (c) => c.status === "fail" || c.status === "GAP" || c.status === "gap",
  );

  const sorted = [...failing].sort((a, b) => {
    const wa = CATEGORY_WEIGHTS[a.category ?? ""] ?? 0;
    const wb = CATEGORY_WEIGHTS[b.category ?? ""] ?? 0;
    if (wb !== wa) return wb - wa;
    return a.id.localeCompare(b.id);
  });

  const byCategory = new Map<string, ScanCheck[]>();
  for (const c of sorted) {
    const cat = c.category ?? "other";
    const list = byCategory.get(cat) ?? [];
    list.push(c);
    byCategory.set(cat, list);
  }

  const lines: string[] = [];
  lines.push("# Improvement Guide");
  lines.push(`\nCurrent score: ${scanResult.score}/100`);
  lines.push(`Failing checks: ${failing.length}`);
  lines.push("");

  for (const [cat, items] of byCategory) {
    lines.push(`## ${cat}`);
    lines.push("");
    for (const c of items) {
      lines.push(`### ${c.id}: ${c.name}`);
      if (c.hint) lines.push(`- **Hint:** ${c.hint}`);
      if (c.fixExample) lines.push(`- **Fix:** \`${c.fixExample}\``);
      lines.push("");
    }
  }

  return lines.join("\n");
}
