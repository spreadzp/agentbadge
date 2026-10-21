// EPIC-202 (SLICE-202-8): Agent Allowance hackathon page — fxdelta-grade layout.
import { html, raw } from "hono/html";
import { sectionWrapper } from "./shared";
import { Hero, ArchitectureDiagram } from "./agentallowance-hero";

const EX = "https://explorer.arc.io";
const FACTORY = "0x5D1a014e1FFE3b777F0946C2dd75A7d3aecdacA4";
const VAULT = "0x2860258CAf3e21c65517233aBa1e876D16D4Ff52";
const USDC = "0x3600000000000000000000000000000000000000";
const AGENT = "0xcdd23d104AA4C10DE65F4DD0571eDfeC0458699d";
const VENDOR = "0x9a664574282b61d31f5A4f22DE63c8Ad248e95A5";
const CLAIM3_TX = "0x5a29b45d133338516ca88ad96017bc8ec79a8ef206b6d5767a74956f6c8509b5";
const REPO = "https://github.com/spreadzp/agent-budget-vault";

const addr = (a: string, link = true) =>
  link
    ? html`<a href="${EX}/address/${a}" target="_blank" rel="noopener" class="font-mono text-xs text-slate-300 hover:text-emerald-300">${a.slice(0, 10)}…${a.slice(-6)} ↗</a>`
    : html`<span class="font-mono text-xs text-slate-300">${a.slice(0, 10)}…${a.slice(-6)}</span>`;
const tx = (h: string) =>
  html`<a href="${EX}/tx/${h}" target="_blank" rel="noopener" class="font-mono text-xs text-emerald-400 hover:text-emerald-300 underline">${h.slice(0, 12)}…${h.slice(-6)} ↗</a>`;

export function AgentAllowanceHackathonPage() {
  return html`${Hero()}
    ${ArchitectureDiagram()}
    ${HowItWorks()}
    ${MainnetProof()}
    ${Contracts()}
    ${Stack()}
    ${FooterCta()}`;
}

function HowItWorks() {
  const steps = [
    { num: "1", title: "Create + fund", desc: "Owner calls createVault(agent, agentId) on the factory, then approve + deposit USDC — depositing starts linear vesting (Sablier-style rate = amount / duration)." },
    { num: "2", title: "Set policy", desc: "Owner allowlists payees and sets a per-transaction cap. From this point the contract — not trust — decides what the agent may spend." },
    { num: "3", title: "Agent claims", desc: "Agent calls claim(amount, payee). Guards check allowlist, cap, vested−claimed and the pause flag; vested USDC goes straight to the payee." },
    { num: "4", title: "Verify + control", desc: "Vendor scans its address to prove incoming payments; every write is on explorer.arc.io. Owner can top up, pause, or cancel — cancel returns all unvested funds." },
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

function MainnetProof() {
  const lifecycle = [
    { step: "approve 3 USDC", hash: "0xfb313a05825556aa0b4773a47fb1f2cc1587a20edb835e65d7f1909156e0b1aa" },
    { step: "deposit 3 USDC → vesting starts", hash: "0xaf0b2dd109690824f7d573df2563eb83b49fe2cb901952fccd4c1e98119d5a56" },
    { step: "addPayee (vendor)", hash: "0x92a234f6c6ad1152bf64911a5aa0a312eacf8beb49c89189a85c6b7833073787" },
    { step: "setPerTxCap 1 USDC", hash: "0xc927d0ac15518b31a05855ab2a8de7100123b90f562bb9bf0e760990f1194a54" },
    { step: "claim → vendor (+55 units)", hash: "0xab1286328863f5ec4dbb9b040587114fc3966b40506dfc2feb5a85a375d9013d" },
    { step: "claim → vendor (+30, via UI)", hash: "0x99a6418d86ac4cb8477a44402bd076bca45fa7d205b04244fce3734fa97d0c6e" },
    { step: "claim → vendor (+30, block 27082200)", hash: CLAIM3_TX },
  ];

  const facts = [
    { label: "Network", value: html`<span class="font-mono text-xs text-slate-300">Arc mainnet · chainId 5042</span>` },
    { label: "Vault (demo, agentId 2)", value: addr(VAULT) },
    { label: "Factory", value: addr(FACTORY) },
    { label: "USDC token", value: addr(USDC) },
    { label: "Agent", value: addr(AGENT) },
    { label: "Vendor / payee", value: addr(VENDOR) },
    { label: "Vendor balance delta", value: html`<span class="font-mono text-xs text-slate-300">99,020 → 99,135 units · +115 over 3 claims</span>` },
  ];

  return sectionWrapper("proof", "", html`
    <h2 class="text-2xl font-bold text-white">Mainnet proof</h2>
    <p class="mt-2 text-slate-400">The full vault lifecycle ran live on Arc mainnet on 2026-10-20/21 — every row links to explorer.arc.io.</p>

    <div class="mt-8 overflow-x-auto rounded-xl border border-slate-700/40 bg-slate-900/50">
      <table class="w-full text-sm">
        <thead class="text-xs uppercase text-slate-500">
          <tr><th class="py-2 px-4 text-left">Lifecycle step</th><th class="py-2 px-4 text-left">Transaction</th></tr>
        </thead>
        <tbody class="divide-y divide-slate-800">
          ${raw(lifecycle.map((r) => html`
            <tr>
              <td class="py-3 px-4 text-xs text-slate-300">${r.step}</td>
              <td class="py-3 px-4">${tx(r.hash)}</td>
            </tr>
          `).join(""))}
        </tbody>
      </table>
    </div>

    <div class="mt-8 overflow-x-auto rounded-xl border border-slate-700/40 bg-slate-900/50">
      <table class="w-full text-sm">
        <tbody class="divide-y divide-slate-800">
          ${raw(facts.map((r) => html`
            <tr>
              <td class="py-3 px-4 text-xs font-medium uppercase text-slate-500 w-48">${r.label}</td>
              <td class="py-3 px-4">${r.value}</td>
            </tr>
          `).join(""))}
        </tbody>
      </table>
    </div>

    <p class="mt-4 text-xs text-slate-500">
      The three-role demo UI (Owner / Agent / Vendor) reproduced this flow end to end — the +30 claim above was submitted from the Agent view itself. Slide-videos with EN/RU voiceover ship in the submission repo.
    </p>
  `);
}

function Contracts() {
  const guards = [
    { name: "Payee allowlist", desc: "claim() only pays addresses the owner added via addPayee — the agent cannot route to itself or arbitrary destinations." },
    { name: "Per-transaction cap", desc: "perTxCap bounds each single claim; a compromised agent key can never drain more than one capped payment." },
    { name: "Vested − claimed", desc: "Claims are bounded by linearly accrued balance — unvested funds are unreachable, even with a valid signature." },
    { name: "Pause / cancel", desc: "Owner pauses new claims instantly, or cancels: unvested USDC returns to the owner, the stream closes." },
  ];

  return sectionWrapper("contracts", "", html`
    <h2 class="text-2xl font-bold text-white">Onchain guardrails</h2>
    <p class="mt-2 text-slate-400">A funded key is not a budget — the policy lives in the contract.</p>
    <div class="mt-8 grid gap-6 sm:grid-cols-2">
      ${raw(guards.map((g) => html`
        <div class="rounded-xl border border-slate-700/40 bg-slate-900/50 p-6">
          <h3 class="text-lg font-semibold text-emerald-300">${g.name}</h3>
          <p class="mt-2 text-sm text-slate-400">${g.desc}</p>
        </div>
      `).join(""))}
    </div>
  `);
}

function Stack() {
  const chips = [
    { label: "Arc mainnet 5042", desc: "deployment + verification chain" },
    { label: "BudgetVault", desc: "solidity, sablier-style linear vesting" },
    { label: "Foundry 46/46", desc: "tests + adversarial review fixes" },
    { label: "ERC-8004 agentId", desc: "agent identity reference in vault" },
    { label: "vite + wagmi + viem", desc: "three-role demo frontend" },
    { label: "explorer.arc.io", desc: "auditability of every write" },
    { label: "USDC 0x3600…0000", desc: "arc native usdc asset" },
    { label: "Arc Studio", desc: "prototyping + review environment" },
    { label: "edge-tts + ffmpeg", desc: "EN/RU slide-video pipeline" },
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

function FooterCta() {
  return html`<section class="border-t border-slate-700/50 bg-slate-950">
    <div class="mx-auto max-w-4xl px-6 py-16 text-center sm:px-8 lg:px-12">
      <h2 class="text-2xl font-bold text-white">Budgets enforced in code — not in trust</h2>
      <p class="mt-3 text-slate-400">Fund a vault, set the policy, and let the agent spend only what vested — verify every claim on explorer.arc.io.</p>
      <div class="mt-6 flex flex-wrap justify-center gap-4">
        <a href="${REPO}" target="_blank" rel="noopener" class="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition">GitHub repo ↗</a>
        <a href="${EX}/tx/${CLAIM3_TX}" target="_blank" rel="noopener" class="rounded-lg border border-emerald-600/60 px-6 py-3 text-sm font-semibold text-emerald-300 hover:border-emerald-400 transition">Live claim proof ↗</a>
      </div>
      <p class="mt-8 text-xs text-slate-500">
        Support: <a href="mailto:support@agentbadge.xyz" class="text-slate-400 hover:text-slate-200">support@agentbadge.xyz</a>
      </p>
    </div>
  </section>`;
}
