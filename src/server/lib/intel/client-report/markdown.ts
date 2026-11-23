// EPIC-262 (SLICE-262-11): client report → markdown. One source of
// truth for the client page: HTML view renders the same sections via
// `prose`; `.md` endpoint serves this verbatim. Signature line =
// integrity, not truth — same honesty as the operator surface.

import type { ClientReport } from "./types";

const arrow = (d: number | null, invertGood: boolean) => {
  if (d === null || d === 0) return "±0";
  const good = invertGood ? d < 0 : d > 0;
  return `${d > 0 ? "▲" : "▼"}${Math.abs(d)}${good ? "" : ""}`;
};

export function renderClientMarkdown(
  r: ClientReport,
  hostname: string | null,
): string {
  const c = r.canonical;
  const lines: string[] = [];
  lines.push(`# Agent Surface Report — ${hostname ?? r.siteId}`);
  lines.push(`_${r.period} · generated ${c.generatedAt}_`);
  lines.push("");
  lines.push(r.editorial.heroLine || "_Summary pending editorial review._");
  lines.push("");
  // two scores, deltas only when comparable
  const rd = r.delta?.readinessDelta ?? null;
  const xd = r.delta?.exposureDelta ?? null;
  lines.push(`| | Score | vs last period |`);
  lines.push(`|---|---|---|`);
  lines.push(`| **Agent readiness** (higher is better) | ${c.scores.readiness ?? "—"} | ${r.delta ? arrow(rd, false) : "first period"} |`);
  lines.push(`| **Surface exposure** (lower is better) | ${c.scores.exposure ?? "—"} | ${r.delta ? arrow(xd, true) : "first period"} |`);
  lines.push("");
  if (r.editorial.whatChanged) {
    lines.push("## What changed");
    lines.push("");
    lines.push(r.editorial.whatChanged);
    lines.push("");
  }
  if (r.delta) {
    const { newOpenRuleIds, closedRuleIds } = r.delta;
    if (newOpenRuleIds.length || closedRuleIds.length) {
      lines.push("### Finding delta");
      for (const id of closedRuleIds) lines.push(`- ✔ resolved: \`${id}\``);
      for (const id of newOpenRuleIds) lines.push(`- ⚠ new: \`${id}\``);
      lines.push("");
    }
  }
  lines.push("## Details");
  lines.push("");
  lines.push(`- ${c.findingCounts.fail} failing, ${c.findingCounts.warn} warnings, ${c.findingCounts.unknown} unknown, ${c.findingCounts.pass} passing checks`);
  lines.push(`- ${c.envelopeCount} evidence envelopes · provenance: ${Object.entries(c.provenance).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  lines.push(`- ruleset \`${c.ruleset.name}@${c.ruleset.version}\` · scan ${c.completeness}`);
  lines.push("");
  lines.push("## Integrity");
  lines.push("");
  lines.push(`- signed canonical report \`${c.reportId}\``);
  lines.push(`- ed25519 · key \`${c.keyId}\` · \`${c.contentHash}\``);
  lines.push(`- signature proves this report was not modified — evidence provenance shows how much is independently verified`);
  lines.push("");
  if (r.editorial.nextMonth) {
    lines.push("## Next month");
    lines.push("");
    lines.push(r.editorial.nextMonth);
    lines.push("");
  }
  lines.push("---");
  lines.push(`_Client report ${r.id} · status ${r.status}${r.sentAt ? ` · sent ${r.sentAt}` : ""}_`);
  return lines.join("\n");
}
