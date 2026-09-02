import { html, raw } from "hono/html";
import { Layout } from "./layout";
import { type PageMeta } from "../server/lib/page-meta";
import {
  RULE_DESCRIPTIONS,
  CATEGORY_DESCRIPTIONS,
  type RuleDescription,
} from "../agent-readiness/rule-descriptions";
import { CATEGORY_TO_PILLAR, PILLAR_LABELS } from "../agent-readiness/scoring/pillar-map";
import { articleLd, breadcrumbListLd, defaultCoreSchemas } from "../server/lib/json-ld";

const EFFORT_STYLES: Record<string, string> = {
  quick: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  moderate: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  complex: "text-rose-400 border-rose-500/30 bg-rose-500/10",
};

const EFFORT_LABELS: Record<string, string> = {
  quick: "Quick fix",
  moderate: "Moderate effort",
  complex: "Complex implementation",
};

export function getRuleDescription(ruleId: string): RuleDescription | undefined {
  return RULE_DESCRIPTIONS.find((r) => r.rule_id === ruleId);
}

export function RuleDetailPage(rule: RuleDescription) {
  const catDesc = CATEGORY_DESCRIPTIONS[rule.category];
  const effortStyle = EFFORT_STYLES[rule.effort_hint];
  const effortLabel = EFFORT_LABELS[rule.effort_hint];
  const pillar = CATEGORY_TO_PILLAR[rule.category];
  const pillarLabel = PILLAR_LABELS[pillar];

  const relatedRules = RULE_DESCRIPTIONS.filter(
    (r) => r.category === rule.category && r.rule_id !== rule.rule_id,
  ).slice(0, 5);

  const meta: PageMeta = {
    title: `${rule.rule_id}: ${rule.title}`,
    description: rule.short_description,
    path: `/rules/${rule.rule_id}`,
  };

  const schemas = [
    ...defaultCoreSchemas(),
    articleLd({
      title: `${rule.rule_id}: ${rule.title}`,
      description: rule.short_description,
      path: `/rules/${rule.rule_id}`,
      sections: [
        { title: "What it means", body: rule.short_description },
        { title: "Why it matters", body: rule.user_value },
        { title: "What's wrong", body: rule.wrong_example },
        { title: "What's right", body: rule.right_example },
      ],
    }),
    breadcrumbListLd([
      { name: "Home", path: "/" },
      { name: "Rules", path: "/rules" },
      { name: rule.rule_id, path: `/rules/${rule.rule_id}` },
    ]),
  ];

  const relatedHtml = relatedRules
    .map(
      (r) => html`<a
        href="/rules/${r.rule_id}"
        class="block rounded-lg border border-slate-800 bg-slate-900/50 p-3 hover:border-slate-600 hover:bg-slate-800/50 transition-colors"
      >
        <div class="flex items-center gap-2">
          <span class="text-lg">${r.icon}</span>
          <span class="text-sm text-slate-300">${r.title}</span>
        </div>
      </a>`,
    )
    .join("\n");

  const content = html`<div class="min-h-screen">
    <div class="mx-auto max-w-3xl px-4 py-16 md:py-20">
      <!-- Breadcrumbs -->
      <nav class="flex items-center gap-2 text-sm text-slate-500 mb-8" aria-label="Breadcrumb">
        <a href="/rules" class="hover:text-slate-300 transition-colors">Rules</a>
        <span>/</span>
        <a href="/rules#${rule.category}" class="hover:text-slate-300 transition-colors">${catDesc.title}</a>
        <span>/</span>
        <span class="text-slate-400">${rule.rule_id}</span>
      </nav>

      <!-- Header -->
      <div class="mb-8">
        <div class="flex items-center gap-3 mb-4">
          <span class="text-4xl">${rule.icon}</span>
          <div>
            <div class="text-xs font-mono uppercase tracking-widest text-emerald-400">${rule.rule_id}</div>
            <h1 class="text-3xl md:text-4xl font-bold tracking-tight mt-1">${rule.title}</h1>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <a
            href="/rules#${rule.category}"
            class="inline-flex items-center gap-1.5 text-sm border border-slate-700 rounded-full px-3 py-1 text-slate-300 hover:border-slate-500 transition-colors"
          >
            <span>${catDesc.icon}</span> ${catDesc.title}
          </a>
          <span class="inline-flex items-center gap-1.5 text-sm border border-indigo-500/30 bg-indigo-500/10 rounded-full px-3 py-1 text-indigo-300">
            Pillar: ${pillarLabel}
          </span>
          <span class="inline-flex items-center gap-1.5 text-sm border ${raw(effortStyle)} rounded-full px-3 py-1 font-mono uppercase tracking-wider">
            ${effortLabel}
          </span>
          <span class="inline-flex items-center gap-1.5 text-sm border border-slate-700 rounded-full px-3 py-1 text-slate-300">
            Est. cost: ${rule.estimated_cost}
          </span>
        </div>
      </div>

      <!-- Description -->
      <div class="space-y-8">
        <section>
          <h2 class="text-xl font-semibold mb-3">What it means</h2>
          <p class="text-slate-300 text-lg leading-relaxed">${rule.short_description}</p>
        </section>

        <section>
          <h2 class="text-xl font-semibold mb-3">Why it matters</h2>
          <p class="text-slate-300 text-lg leading-relaxed">${rule.user_value}</p>
        </section>

        <!-- Wrong vs Right -->
        <section class="grid gap-4 md:grid-cols-2">
          <div class="rounded-lg border border-rose-500/20 bg-rose-500/5 p-5">
            <div class="flex items-center gap-2 mb-3">
              <span class="text-rose-400 text-lg">✗</span>
              <h3 class="font-semibold text-rose-300">What's wrong</h3>
            </div>
            <p class="text-slate-400 text-sm leading-relaxed">${rule.wrong_example}</p>
          </div>
          <div class="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-5">
            <div class="flex items-center gap-2 mb-3">
              <span class="text-emerald-400 text-lg">✓</span>
              <h3 class="font-semibold text-emerald-300">What's right</h3>
            </div>
            <p class="text-slate-400 text-sm leading-relaxed">${rule.right_example}</p>
          </div>
        </section>

        <!-- CTA: Single-rule scanner -->
        <section class="border-t border-slate-800 pt-6">
          <h2 class="text-xl font-semibold mb-3">Check this rule on your site</h2>
          <p class="text-slate-400 text-sm mb-4">Enter your URL to check just this one rule (AB-001).</p>
          <div class="flex flex-col gap-3 sm:flex-row">
            <input
              id="scan-url-input"
              type="url"
              placeholder="https://example.com"
              class="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <button
              id="scan-rule-btn"
              type="button"
              class="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 font-medium text-slate-950 hover:bg-emerald-400 transition-colors whitespace-nowrap"
            >
              <span id="scan-btn-text">Check rule</span>
              <svg id="scan-btn-icon" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
          </div>
          <div id="scan-result" class="mt-4 hidden rounded-lg border p-4 text-sm"></div>
          ${raw(`<script>
            (function() {
              var btn = document.getElementById('scan-rule-btn');
              var input = document.getElementById('scan-url-input');
              var result = document.getElementById('scan-result');
              var btnText = document.getElementById('scan-btn-text');
              var btnIcon = document.getElementById('scan-btn-icon');
              var ruleId = ${JSON.stringify(rule.rule_id)};

              btn.addEventListener('click', async function() {
                var url = input.value.trim();
                if (!url) { input.focus(); return; }
                if (!url.match(/^https?:\\/\\//)) { url = 'https://' + url; }

                btn.disabled = true;
                btnText.textContent = 'Scanning...';
                btnIcon.classList.add('animate-spin');
                result.classList.remove('hidden');
                result.className = 'mt-4 rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm text-slate-400';
                result.textContent = 'Scanning ' + url + ' for rule ' + ruleId + '...';

                try {
                  var res = await fetch('/api/scan-rule', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: url, rule_id: ruleId })
                  });
                  var data = await res.json();

                  if (res.ok) {
                    var statusColor = data.status === 'VERIFIED' || data.status === 'INFERRED'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : data.status === 'NOT_APPLICABLE'
                        ? 'border-slate-600 bg-slate-800/50 text-slate-400'
                        : 'border-rose-500/30 bg-rose-500/10 text-rose-300';
                    result.className = 'mt-4 rounded-lg border p-4 text-sm ' + statusColor;
                    var icon = data.status === 'VERIFIED' || data.status === 'INFERRED' ? '\\u2713' : data.status === 'NOT_APPLICABLE' ? '\\u25CB' : '\\u2717';

                    var html = '<div class="flex items-center gap-3 mb-3">';
                    html += '<span class="text-2xl">' + icon + '</span>';
                    html += '<div>';
                    html += '<div class="font-mono uppercase tracking-wider text-sm font-semibold">' + data.status + '</div>';
                    if (typeof data.completeness_pct === 'number') {
                      html += '<div class="text-xs text-slate-400 mt-0.5">' + data.completeness_pct + '% complete</div>';
                    }
                    html += '</div></div>';

                    html += '<div class="text-slate-300 font-medium mb-1">' + (data.rule_name || ruleId) + '</div>';
                    html += '<div class="text-slate-500 text-xs mb-3">Scanned: ' + data.scanned_url + '</div>';

                    if (data.summary) {
                      html += '<div class="text-slate-300 mb-2">' + data.summary + '</div>';
                    }
                    if (data.hint) {
                      html += '<div class="mt-2 text-slate-400 text-xs"><strong>Fix:</strong> ' + data.hint + '</div>';
                    }

                    result.innerHTML = html;
                  } else {
                    result.className = 'mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300';
                    result.textContent = data.error || 'Scan failed';
                  }
                } catch (err) {
                  result.className = 'mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300';
                  result.textContent = 'Error: ' + err.message;
                } finally {
                  btn.disabled = false;
                  btnText.textContent = 'Check rule';
                  btnIcon.classList.remove('animate-spin');
                }
              });

              input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') btn.click();
              });
            })();
          </script>`)}
        </section>

        <!-- Related rules -->
        ${relatedRules.length > 0
      ? html`<section class="border-t border-slate-800 pt-6">
              <h2 class="text-lg font-semibold mb-4">Related rules in ${catDesc.title}</h2>
              <div class="grid gap-2 sm:grid-cols-2">
                ${raw(relatedHtml)}
              </div>
            </section>`
      : ""}
      </div>

      <!-- Back link -->
      <div class="mt-12 border-t border-slate-800 pt-6">
        <a href="/rules" class="text-sm text-slate-500 hover:text-slate-300 transition-colors">
          ← Back to all rules
        </a>
      </div>
    </div>
  </div>`;

  return Layout(content.toString(), meta.title, meta, schemas);
}
