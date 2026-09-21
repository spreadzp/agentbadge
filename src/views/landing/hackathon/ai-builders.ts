// EPIC-140 (SLICE-140-19): ai-builders hackathon page — assembled from sections.
import { html, raw } from "hono/html";
import { demoSection, auditSectionAnchor, sectionWrapper, type HackathonDemoConfig } from "./shared";
import { Hero, ArchitectureDiagram } from "./ai-builders-hero";

export interface AIBuildersPageOpts {
  registryAddress?: string;
  badgeAddress?: string;
}

const AI_BUILDERS_CFG: HackathonDemoConfig = {
  executingLabel: "Workflow executing… recording on TrustRegistry (may take up to 1 min)",
  notEnabledMsg: "Onchain integration not enabled on this deployment",
  provisioningMsg: "Workflow or provisioning issue — check API keys / workflow IDs",
  auditUnavailableMsg: "Onchain integration not enabled — audit trail unavailable",
};

export function AIBuildersHackathonPage(opts?: AIBuildersPageOpts) {
  return html`${Hero()}
    ${ArchitectureDiagram()}
    ${HowItWorks()}
    ${demoSection(AI_BUILDERS_CFG)}
    ${auditSectionAnchor(AI_BUILDERS_CFG)}
    ${StackSection()}
    ${ApiSection(opts)}
    ${FooterCta()}`;
}

function HowItWorks() {
  const steps = [
    { num: "1", title: "Scan", desc: "40-rule agent-readiness scan (SSRF-guarded, free dry-run)" },
    { num: "2", title: "Confirm", desc: "Dry-run preview shows exactly what lands onchain (functionArgs), then confirm" },
    { num: "3", title: "Record", desc: "Workflow executes: TrustRegistry.recordScan onchain, tx on Basescan" },
    { num: "4", title: "Verify", desc: "Audit trail (live SSE) + verify MCP tool; agents pay via x402 (USDC)" },
  ];

  return sectionWrapper("howitworks", "", html`
    <h2 class="text-2xl font-bold text-white">How it works</h2>
    <div class="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      ${raw(steps.map((s) => html`
        <div class="rounded-xl border border-slate-700/40 bg-slate-900/50 p-6">
          <div class="flex items-center gap-3">
            <span class="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">${s.num}</span>
            <h3 class="text-lg font-semibold text-white">${s.title}</h3>
          </div>
          <p class="mt-3 text-sm text-slate-400">${s.desc}</p>
        </div>
      `).join(""))}
    </div>
  `);
}

function StackSection() {
  const chips = [
    { label: "Base Sepolia", desc: "84532, Basescan" },
    { label: "TrustRegistry / TrustBadge", desc: "Solidity 0.8.30, OZ 5.1" },
    { label: "x402 v2", desc: "EIP-3009 USDC, facilitator" },
    { label: "MCP tools", desc: "6 tools: scan, badge, passport, verify, score, search" },
    { label: "SSE", desc: "live audit stream" },
    { label: "Hono + hono/html", desc: "server-rendered, zero client framework" },
    { label: "Agent Readiness Scanner", desc: "40+ deterministic rules, CLI + API" },
  ];

  return sectionWrapper("stack", "", html`
    <h2 class="text-2xl font-bold text-white">Stack</h2>
    <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      ${raw(chips.map((c) => html`
        <div class="rounded-lg border border-slate-700/40 bg-slate-900/50 p-4">
          <div class="text-sm font-mono font-semibold text-indigo-300">${c.label}</div>
          <div class="mt-1 text-xs text-slate-400">${c.desc}</div>
        </div>
      `).join(""))}
    </div>
  `);
}

function ApiSection(opts?: AIBuildersPageOpts) {
  const basescanBase = "https://sepolia.basescan.org";
  const registryLink = opts?.registryAddress
    ? html`<a href="${basescanBase}/address/${opts.registryAddress}" target="_blank" rel="noopener" class="text-emerald-400 hover:text-emerald-300 underline font-mono text-xs">${opts.registryAddress}</a>`
    : html`<span class="text-xs text-slate-500">—</span>`;
  const badgeLink = opts?.badgeAddress
    ? html`<a href="${basescanBase}/address/${opts.badgeAddress}" target="_blank" rel="noopener" class="text-emerald-400 hover:text-emerald-300 underline font-mono text-xs">${opts.badgeAddress}</a>`
    : html`<span class="text-xs text-slate-500">—</span>`;

  return sectionWrapper("api", "", html`
    <h2 class="text-2xl font-bold text-white">API Surface</h2>
    <p class="mt-2 text-slate-400">Every public endpoint and MCP tool.</p>

    <div class="mt-8 overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-slate-700 text-left text-xs text-slate-400">
            <th class="pb-3 pr-4 font-medium">Surface</th>
            <th class="pb-3 pr-4 font-medium">Endpoint / Tool</th>
            <th class="pb-3 pr-4 font-medium">Auth</th>
            <th class="pb-3 font-medium">Returns</th>
          </tr>
        </thead>
        <tbody class="text-slate-300">
          <tr class="border-b border-slate-800">
            <td class="py-3 pr-4">Scan (free)</td>
            <td class="py-3 pr-4 font-mono text-xs text-indigo-300">POST /api/keeperhub/scan</td>
            <td class="py-3 pr-4 text-xs text-slate-400">—</td>
            <td class="py-3 text-xs">dry-run preview or onchain tx</td>
          </tr>
          <tr class="border-b border-slate-800">
            <td class="py-3 pr-4">Scan (premium)</td>
            <td class="py-3 pr-4 font-mono text-xs text-emerald-300">POST /api/keeperhub/scan/premium</td>
            <td class="py-3 pr-4 text-xs text-slate-400">x402 · $0.01</td>
            <td class="py-3 text-xs">onchain tx (paid via USDC)</td>
          </tr>
          <tr class="border-b border-slate-800">
            <td class="py-3 pr-4">Audit API</td>
            <td class="py-3 pr-4 font-mono text-xs text-indigo-300">GET /api/keeperhub/audit</td>
            <td class="py-3 pr-4 text-xs text-slate-400">—</td>
            <td class="py-3 text-xs">events + onchain + Basescan links</td>
          </tr>
          <tr class="border-b border-slate-800">
            <td class="py-3 pr-4">Live stream</td>
            <td class="py-3 pr-4 font-mono text-xs text-indigo-300">GET /api/keeperhub/audit/stream</td>
            <td class="py-3 pr-4 text-xs text-slate-400">—</td>
            <td class="py-3 text-xs">event: audit frames (SSE)</td>
          </tr>
          <tr class="border-b border-slate-800">
            <td class="py-3 pr-4">MCP tools</td>
            <td class="py-3 pr-4 font-mono text-xs text-indigo-300">scan · badge · passport · verify · score · search</td>
            <td class="py-3 pr-4 text-xs text-slate-400">MCP session</td>
            <td class="py-3 text-xs">via AgentBadge MCP server</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="mt-6 flex flex-wrap gap-6 text-xs text-slate-400">
      <a href="https://github.com/agentbadge/agentbadge" target="_blank" rel="noopener" class="hover:text-slate-200">GitHub repo ↗</a>
      <span>Contracts on Basescan:</span>
      <span>TrustRegistry: ${registryLink}</span>
      <span>TrustBadge: ${badgeLink}</span>
    </div>
  `);
}

function FooterCta() {
  return html`<section class="border-t border-slate-700/50 bg-slate-950">
    <div class="mx-auto max-w-4xl px-6 py-16 text-center sm:px-8 lg:px-12">
      <h2 class="text-2xl font-bold text-white">Run the demo above</h2>
      <p class="mt-3 text-slate-400">A permanent onchain record is 30 seconds away.</p>
      <div class="mt-6 flex justify-center gap-4">
        <a href="#demo" class="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition">Try the demo →</a>
        <a href="#audit" class="rounded-lg border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-200 hover:border-slate-400 transition">Live audit trail →</a>
      </div>
      <p class="mt-8 text-xs text-slate-500">
        Support: <a href="mailto:support@agentbadge.xyz" class="text-slate-400 hover:text-slate-200">support@agentbadge.xyz</a>
      </p>
    </div>
  </section>`;
}
