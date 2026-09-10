import { html, raw } from "hono/html";
import { LandingLayout } from "./landing/layout";
import type { KnowledgeProfile } from "../agent-readiness/profile/profile-schema";
import { BASE_URL } from "../server/lib/page-meta";

/**
 * SLICE-101-9: Profile Viewer — HTML page rendering a KnowledgeProfile.
 */

export function ProfileViewer(profile: KnowledgeProfile): ReturnType<typeof html> {
  const domain = profile.service.domain;

  return LandingLayout(
    renderProfileContent(profile),
    `Knowledge Profile: ${domain}`,
    {
      title: `Knowledge Profile: ${domain}`,
      description: `Agent readiness profile for ${domain}`,
      path: `/profile/${domain}`,
    },
  );
}

function renderProfileContent(profile: KnowledgeProfile): string {
  const domain = profile.service.domain;
  const sections: string[] = [];

  // Header
  sections.push(`
    <div class="mx-auto max-w-5xl px-4 py-8">
      <div class="flex items-center justify-between mb-8">
        <div>
          <h1 class="text-3xl font-bold text-white">Knowledge Profile</h1>
          <p class="text-slate-400 mt-1">${domain}</p>
        </div>
        <div class="flex gap-2">
          <a href="/api/profile/${domain}" class="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700">JSON</a>
          <a href="/api/profile/${domain}?format=yaml" class="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700">YAML</a>
          <a href="/api/profile/${domain}?format=markdown" class="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700">Markdown</a>
        </div>
      </div>
  `);

  // Readiness card
  sections.push(renderReadinessCard(profile));

  // Content section cards
  if (profile.capabilities) sections.push(renderSectionCard("Capabilities", profile.capabilities));
  if (profile.auth) sections.push(renderSectionCard("Auth", profile.auth));
  if (profile.pricing) sections.push(renderSectionCard("Pricing", profile.pricing));
  if (profile.limits) sections.push(renderSectionCard("Limits", profile.limits));
  if (profile.errors) sections.push(renderSectionCard("Errors", profile.errors));
  if (profile.policies) sections.push(renderSectionCard("Policies", profile.policies));

  // Freshness card
  sections.push(renderFreshnessCard(profile));

  // Evidence summary card
  sections.push(renderEvidenceCard(profile));

  sections.push("</div>");
  return sections.join("\n");
}

function renderReadinessCard(profile: KnowledgeProfile): string {
  const score = profile.readiness.score;
  const grade = profile.readiness.grade;
  const scoreColor = score >= 80 ? "text-green-400" : score >= 50 ? "text-yellow-400" : "text-red-400";

  const categoryRows = Object.entries(profile.readiness.categories)
    .map(([cat, val]) => `<tr class="border-b border-slate-800"><td class="py-2 px-3 text-slate-300">${cat}</td><td class="py-2 px-3 text-right ${scoreColor}">${val}</td></tr>`)
    .join("");

  return `
    <div class="rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 mb-6 shadow-2xl">
      <h2 class="text-xl font-semibold text-white mb-4">Readiness</h2>
      <div class="flex items-center gap-6 mb-4">
        <div class="text-5xl font-bold ${scoreColor}">${score}</div>
        <div>
          <div class="text-lg text-slate-300">Grade: <span class="font-bold ${scoreColor}">${grade}</span></div>
          <div class="text-sm text-slate-400">Verified: ${profile.readiness.verified_rules}/${profile.readiness.total_rules} rules</div>
          <div class="text-sm text-slate-400">Gaps: ${profile.readiness.gaps} · Conflicts: ${profile.readiness.conflicts}</div>
        </div>
      </div>
      ${categoryRows ? `<table class="w-full text-sm"><thead><tr class="text-slate-400 border-b border-slate-700"><th class="py-2 px-3 text-left">Category</th><th class="py-2 px-3 text-right">Score</th></tr></thead><tbody>${categoryRows}</tbody></table>` : ""}
    </div>
  `;
}

function renderSectionCard(title: string, section: any): string {
  const staleBadge = section.stale
    ? '<span class="rounded bg-red-900/50 px-2 py-0.5 text-xs text-red-300">⚠️ Stale</span>'
    : '<span class="rounded bg-green-900/50 px-2 py-0.5 text-xs text-green-300">Fresh</span>';

  const confidencePercent = Math.round(section.confidence * 100);

  const dataRows = Object.entries(section.data || {})
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        if (value.length === 0) return "";
        return `<div class="flex gap-2 py-1"><span class="text-slate-400 min-w-[140px]">${key}</span><span class="text-slate-200">${value.join(", ")}</span></div>`;
      }
      if (typeof value === "boolean") {
        return `<div class="flex gap-2 py-1"><span class="text-slate-400 min-w-[140px]">${key}</span><span class="text-slate-200">${value ? "✅ yes" : "❌ no"}</span></div>`;
      }
      return `<div class="flex gap-2 py-1"><span class="text-slate-400 min-w-[140px]">${key}</span><span class="text-slate-200">${value}</span></div>`;
    })
    .join("");

  const gaps = section.gaps && section.gaps.length > 0
    ? `<div class="mt-3 pt-3 border-t border-slate-800"><div class="text-sm text-slate-400 mb-1">Gaps:</div><ul class="text-sm text-yellow-300 list-disc list-inside">${section.gaps.map((g: string) => `<li>${g}</li>`).join("")}</ul></div>`
    : "";

  return `
    <div class="rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 mb-6 shadow-2xl">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-xl font-semibold text-white">${title}</h2>
        <div class="flex items-center gap-2">
          <span class="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">Confidence: ${confidencePercent}%</span>
          ${staleBadge}
        </div>
      </div>
      <div class="text-xs text-slate-500 mb-3">Source: ${section.source} · Verified: ${section.verified_at}</div>
      ${dataRows ? `<div class="text-sm">${dataRows}</div>` : '<div class="text-sm text-slate-500">No data</div>'}
      ${gaps}
    </div>
  `;
}

function renderFreshnessCard(profile: KnowledgeProfile): string {
  const staleList = profile.freshness.stale_sections.length > 0
    ? profile.freshness.stale_sections.map((s: string) => `<span class="rounded bg-red-900/50 px-2 py-0.5 text-xs text-red-300 mr-1">${s}</span>`).join("")
    : '<span class="text-green-300 text-sm">No stale sections</span>';

  return `
    <div class="rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 mb-6 shadow-2xl">
      <h2 class="text-xl font-semibold text-white mb-4">Freshness</h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <div><div class="text-slate-400">Generated at</div><div class="text-slate-200">${profile.freshness.profile_generated_at}</div></div>
        <div><div class="text-slate-400">Oldest evidence</div><div class="text-slate-200">${profile.freshness.oldest_evidence_days} days</div></div>
        <div><div class="text-slate-400">Next refresh</div><div class="text-slate-200">${profile.freshness.next_refresh ?? "—"}</div></div>
      </div>
      <div class="mt-3"><div class="text-slate-400 text-sm mb-1">Stale sections:</div>${staleList}</div>
    </div>
  `;
}

function renderEvidenceCard(profile: KnowledgeProfile): string {
  const statusRows = Object.entries(profile.evidence_summary.by_status)
    .map(([status, count]) => `<tr class="border-b border-slate-800"><td class="py-2 px-3 text-slate-300">${status}</td><td class="py-2 px-3 text-right text-slate-200">${count}</td></tr>`)
    .join("");

  const sourceRows = Object.entries(profile.evidence_summary.by_source_class)
    .map(([sc, count]) => `<tr class="border-b border-slate-800"><td class="py-2 px-3 text-slate-300">${sc}</td><td class="py-2 px-3 text-right text-slate-200">${count}</td></tr>`)
    .join("");

  const cr = profile.evidence_summary.confidence_range;

  return `
    <div class="rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 mb-6 shadow-2xl">
      <h2 class="text-xl font-semibold text-white mb-4">Evidence Summary</h2>
      <div class="text-sm text-slate-400 mb-3">Total assertions: <span class="text-slate-200 font-bold">${profile.evidence_summary.total_assertions}</span></div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div class="text-sm text-slate-400 mb-2">By Status</div>
          <table class="w-full text-sm"><tbody>${statusRows}</tbody></table>
        </div>
        <div>
          <div class="text-sm text-slate-400 mb-2">By Source Class</div>
          <table class="w-full text-sm"><tbody>${sourceRows}</tbody></table>
        </div>
      </div>
      <div class="mt-4 text-sm">
        <span class="text-slate-400">Confidence range:</span>
        <span class="text-slate-200">min=${cr.min}, max=${cr.max}, mean=${cr.mean.toFixed(3)}</span>
      </div>
    </div>
  `;
}
