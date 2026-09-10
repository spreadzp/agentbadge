import type { KnowledgeProfile } from "../../profile/profile-schema";

/**
 * SLICE-101-7: Markdown Renderer.
 *
 * Pure function: renders a KnowledgeProfile as readable markdown.
 */

export function renderProfileMarkdown(profile: KnowledgeProfile): string {
  const lines: string[] = [];

  lines.push(`# Knowledge Profile: ${profile.service.name ?? profile.service.domain}`);
  lines.push("");
  lines.push(`- **Profile version**: ${profile.profile_version}`);
  lines.push(`- **Schema version**: ${profile.schema_version}`);
  lines.push(`- **Domain**: ${profile.service.domain}`);
  lines.push(`- **Base URL**: ${profile.service.base_url}`);
  if (profile.service.description) lines.push(`- **Description**: ${profile.service.description}`);
  lines.push(`- **Verified at**: ${profile.service.verified_at}`);
  if (profile.service.scan_id) lines.push(`- **Scan ID**: ${profile.service.scan_id}`);
  lines.push("");

  // Readiness
  lines.push("## Readiness");
  lines.push("");
  lines.push(`- **Score**: ${profile.readiness.score}/100`);
  lines.push(`- **Grade**: ${profile.readiness.grade}`);
  lines.push(`- **Verified rules**: ${profile.readiness.verified_rules}/${profile.readiness.total_rules}`);
  lines.push(`- **Gaps**: ${profile.readiness.gaps}`);
  lines.push(`- **Conflicts**: ${profile.readiness.conflicts}`);
  lines.push("");
  if (Object.keys(profile.readiness.categories).length > 0) {
    lines.push("| Category | Score |");
    lines.push("|----------|-------|");
    for (const [cat, score] of Object.entries(profile.readiness.categories)) {
      lines.push(`| ${cat} | ${score} |`);
    }
    lines.push("");
  }

  // Content sections
  const sections: [string, string, any][] = [
    ["Capabilities", "capabilities", profile.capabilities],
    ["Auth", "auth", profile.auth],
    ["Pricing", "pricing", profile.pricing],
    ["Limits", "limits", profile.limits],
    ["Errors", "errors", profile.errors],
    ["Policies", "policies", profile.policies],
  ];

  for (const [title, _key, section] of sections) {
    if (!section) continue;
    lines.push(`## ${title}`);
    lines.push("");
    renderSectionData(lines, section.data);
    renderSectionMeta(lines, section);
    lines.push("");
  }

  // Freshness
  lines.push("## Freshness");
  lines.push("");
  lines.push(`- **Profile generated at**: ${profile.freshness.profile_generated_at}`);
  lines.push(`- **Oldest evidence (days)**: ${profile.freshness.oldest_evidence_days}`);
  if (profile.freshness.stale_sections.length > 0) {
    lines.push(`- **Stale sections**: ${profile.freshness.stale_sections.join(", ")}`);
  } else {
    lines.push("- **Stale sections**: none");
  }
  if (profile.freshness.next_refresh) {
    lines.push(`- **Next refresh**: ${profile.freshness.next_refresh}`);
  }
  lines.push("");

  // Evidence summary
  lines.push("## Evidence Summary");
  lines.push("");
  lines.push(`- **Total assertions**: ${profile.evidence_summary.total_assertions}`);
  lines.push("");
  if (Object.keys(profile.evidence_summary.by_status).length > 0) {
    lines.push("### By Status");
    lines.push("");
    lines.push("| Status | Count |");
    lines.push("|--------|-------|");
    for (const [status, count] of Object.entries(profile.evidence_summary.by_status)) {
      lines.push(`| ${status} | ${count} |`);
    }
    lines.push("");
  }
  if (Object.keys(profile.evidence_summary.by_source_class).length > 0) {
    lines.push("### By Source Class");
    lines.push("");
    lines.push("| Source Class | Count |");
    lines.push("|-------------|-------|");
    for (const [sc, count] of Object.entries(profile.evidence_summary.by_source_class)) {
      lines.push(`| ${sc} | ${count} |`);
    }
    lines.push("");
  }
  lines.push(`- **Confidence range**: min=${profile.evidence_summary.confidence_range.min}, max=${profile.evidence_summary.confidence_range.max}, mean=${profile.evidence_summary.confidence_range.mean.toFixed(3)}`);
  lines.push("");

  return lines.join("\n");
}

function renderSectionMeta(lines: string[], section: any): void {
  lines.push(`- **Source**: ${section.source}`);
  lines.push(`- **Confidence**: ${section.confidence}`);
  lines.push(`- **Verified at**: ${section.verified_at}`);
  lines.push(`- **Stale**: ${section.stale ? "⚠️ YES" : "no"}`);
  if (section.gaps && section.gaps.length > 0) {
    lines.push(`- **Gaps**: ${section.gaps.join(", ")}`);
  }
}

function renderSectionData(lines: string[], data: any): void {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      if (typeof value[0] === "object") {
        lines.push(`- **${key}**:`);
        for (const item of value) {
          const parts = Object.entries(item).map(([k, v]) => `${k}=${v}`).join(", ");
          lines.push(`  - ${parts}`);
        }
      } else {
        lines.push(`- **${key}**: ${value.join(", ")}`);
      }
    } else if (typeof value === "boolean") {
      lines.push(`- **${key}**: ${value ? "yes" : "no"}`);
    } else {
      lines.push(`- **${key}**: ${value}`);
    }
  }
}
