// EPIC-191 (SLICE-191-19): FX Delta Agent hackathon page — keeperhub-grade layout.
import { html, raw } from "hono/html";
import { sectionWrapper } from "./shared";
import { Hero, ArchitectureDiagram } from "./fxdelta-hero";

const SETTLE_TX =
  "0x7f292710b92b0684b272872d9829899c3a5dcf83819df98908b1bd391355b6b2";
const BLOCKSCOUT_TX = `https://celo.blockscout.com/tx/${SETTLE_TX}`;
const BUYER = "0x4a2f11B5FC4A9799B94Cc236C2D3d9d2EE4E6Bb0";
const SELLER = "0x0F711f822EF1Ba1736F62CAAbb51F5502758186e";
const USDC = "0xcebA9300f2b948710d2653dD7B07f33A8B32118C";

export function FxDeltaHackathonPage() {
  return html`${Hero()}
    ${ArchitectureDiagram()}
    ${HowItWorks()}
    ${Demo()}
    ${MainnetProof()}
    ${ApiSurface()}
    ${Stack()}
    ${FooterCta()}`;
}

function HowItWorks() {
  const steps = [
    { num: "1", title: "Request", desc: "The agent calls the premium endpoint and gets HTTP 402 with the price, assets (USDC/USDT), and payTo on Celo mainnet." },
    { num: "2", title: "Sign", desc: "The agent signs a USDC payment permit (EIP-3009). The buyer spends no gas." },
    { num: "3", title: "Settle", desc: "The seller submits transferWithAuthorization on Celo mainnet with an ERC-8021 attribution tag in calldata." },
    { num: "4", title: "Receive", desc: "After the receipt confirms, the API returns per-corridor deltas and buy / sell / watch signals. Large gaps push Telegram alerts." },
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

function Demo() {
  const demoScript = raw(`
    <script>
      (function() {
        var btn = document.getElementById("fx-probe");
        var out = document.getElementById("fx-demo-out");
        btn.addEventListener("click", async function() {
          out.hidden = false;
          out.innerHTML = '<p class="text-sm text-slate-400">Calling /api/fx-delta/premium and /api/fx-delta/health…</p>';
          try {
            var results = [];
            var prem = await fetch("/api/fx-delta/premium");
            var premBody = await prem.json().catch(function() { return null; });
            results.push('<div class="rounded-lg border border-amber-800/40 bg-amber-950/20 p-4">'
              + '<p class="text-sm font-semibold text-amber-300">GET /api/fx-delta/premium → HTTP ' + prem.status + '</p>'
              + '<pre class="mt-2 text-xs text-slate-300 overflow-x-auto">' + (premBody ? JSON.stringify(premBody, null, 2).slice(0, 1600) : "(no body)") + '</pre></div>');
            var health = await fetch("/api/fx-delta/health");
            var healthBody = await health.json().catch(function() { return null; });
            results.push('<div class="rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-4">'
              + '<p class="text-sm font-semibold text-emerald-300">GET /api/fx-delta/health → HTTP ' + health.status + '</p>'
              + '<pre class="mt-2 text-xs text-slate-300 overflow-x-auto">' + (healthBody ? JSON.stringify(healthBody, null, 2).slice(0, 1200) : "(no body)") + '</pre></div>');
            out.innerHTML = results.join("");
          } catch (err) {
            out.innerHTML = '<div class="rounded-lg border border-red-800/50 bg-red-950/30 p-4"><p class="text-sm text-red-300">' + err.message + "</p></div>";
          }
        });
      })();
    </script>
  `);

  return html`<section id="demo" class="mx-auto max-w-4xl px-6 py-16 sm:px-8 lg:px-12">
    <h2 class="text-2xl font-bold text-white">Try it live</h2>
    <p class="mt-2 text-slate-400">The premium endpoint answers with payment requirements on Celo mainnet. Health shows the running engine — both calls are free.</p>

    <pre class="mt-6 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-xs text-emerald-300"><code>curl -i https://agentbadge.xyz/api/fx-delta/premium
# → 402 Payment Required · eip155:42220 · USDC/USDT · 5000 units · payTo ${SELLER.slice(0, 10)}…</code></pre>

    <div class="mt-4">
      <button type="button" id="fx-probe"
        class="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition">
        Probe the live API →
      </button>
    </div>
    <div id="fx-demo-out" hidden class="mt-6 space-y-4"></div>

    <div class="mt-10 border-t border-slate-800 pt-6">
      <p class="text-sm text-slate-400">
        A paid call needs an EIP-3009 signature — see the
        <a href="https://github.com/agentbadge/agentbadge" target="_blank" rel="noopener" class="text-emerald-400 hover:text-emerald-300 underline">README-HACKATHON.md</a>
        for the full reproduction script.
      </p>
    </div>
    ${demoScript}
  </section>`;
}

function MainnetProof() {
  const rows = [
    { label: "Settle transaction", value: html`<a href="${BLOCKSCOUT_TX}" target="_blank" rel="noopener" class="font-mono text-xs text-emerald-400 hover:text-emerald-300 underline">${SETTLE_TX.slice(0, 14)}…${SETTLE_TX.slice(-6)} ↗</a>` },
    { label: "Network", value: html`<span class="font-mono text-xs text-slate-300">Celo mainnet · eip155:42220</span>` },
    { label: "Asset", value: html`<a href="https://celo.blockscout.com/address/${USDC}" target="_blank" rel="noopener" class="font-mono text-xs text-slate-300 hover:text-emerald-300">USDC ${USDC.slice(0, 10)}…${USDC.slice(-6)} ↗</a>` },
    { label: "Buyer (buymain)", value: html`<a href="https://celo.blockscout.com/address/${BUYER}" target="_blank" rel="noopener" class="font-mono text-xs text-slate-300 hover:text-emerald-300">${BUYER.slice(0, 10)}…${BUYER.slice(-6)} ↗</a>` },
    { label: "Seller / payTo / gas payer", value: html`<a href="https://celo.blockscout.com/address/${SELLER}" target="_blank" rel="noopener" class="font-mono text-xs text-slate-300 hover:text-emerald-300">${SELLER.slice(0, 10)}…${SELLER.slice(-6)} ↗</a>` },
    { label: "Amount", value: html`<span class="font-mono text-xs text-slate-300">0.005 USDC · block 80576414 · status success</span>` },
    { label: "ERC-8021 tag", value: html`<span class="font-mono text-xs text-amber-300">celo_24acc530146f</span><span class="text-xs text-slate-500"> — inside tx calldata</span>` },
    { label: "Buyer balance", value: html`<span class="font-mono text-xs text-slate-300">4.840 → 4.835 USDC · 0 CELO spent</span>` },
    { label: "Seller balance", value: html`<span class="font-mono text-xs text-slate-300">0 → 0.005 USDC · gas ~0.021 CELO</span>` },
  ];

  return sectionWrapper("proof", "", html`
    <h2 class="text-2xl font-bold text-white">Mainnet proof</h2>
    <p class="mt-2 text-slate-400">One verified payment, end to end. Click through to Blockscout.</p>
    <div class="mt-8 overflow-x-auto rounded-xl border border-slate-700/40 bg-slate-900/50">
      <table class="w-full text-sm">
        <tbody class="divide-y divide-slate-800">
          ${raw(rows.map((r) => html`
            <tr>
              <td class="py-3 px-4 text-xs font-medium uppercase text-slate-500 w-48">${r.label}</td>
              <td class="py-3 px-4">${r.value}</td>
            </tr>
          `).join(""))}
        </tbody>
      </table>
    </div>
    <p class="mt-4 text-xs text-slate-500">
      Earlier testnet dry-runs of the same rail exist — the submission proof is the mainnet tx above.
    </p>
  `);
}

function ApiSurface() {
  const endpoints = [
    { method: "GET", path: "/api/fx-delta/health", auth: "free", desc: "Engine status, corridor count, data sources" },
    { method: "GET", path: "/api/fx-delta/corridors", auth: "free", desc: "List of currency corridors" },
    { method: "GET", path: "/api/fx-delta/snapshot", auth: "free · 1/min", desc: "Latest deltas snapshot (free-tier rate limit)" },
    { method: "GET", path: "/api/fx-delta/premium", auth: "x402 · $0.005", desc: "Full deltas + buy/sell/watch signals" },
    { method: "GET", path: "/api/fx-delta/stream", auth: "free", desc: "SSE live stream of deltas" },
    { method: "GET", path: "/api/fx-delta/:corridor", auth: "free", desc: "Deltas for one corridor" },
    { method: "GET", path: "/api/fx-delta/verify/:id", auth: "free", desc: "Verdict hash check (needs an anchored record; 404 until anchoring is enabled)" },
    { method: "MCP", path: "/mcp/fxdelta", auth: "freemium + x402", desc: "get_delta · list_corridors · get_quote · get_events · get_digest" },
  ];

  return sectionWrapper("api", "", html`
    <h2 class="text-2xl font-bold text-white">API surface</h2>
    <p class="mt-2 text-slate-400">Every public endpoint and the MCP namespace.</p>
    <div class="mt-8 overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead class="text-xs uppercase text-slate-500">
          <tr><th class="py-2 pr-4">Method</th><th class="py-2 pr-4">Path</th><th class="py-2 pr-4">Access</th><th class="py-2">Description</th></tr>
        </thead>
        <tbody class="divide-y divide-slate-800">
          ${raw(endpoints.map((e) => html`
            <tr>
              <td class="py-2 pr-4 font-mono text-emerald-300">${e.method}</td>
              <td class="py-2 pr-4 font-mono text-xs text-slate-200">${e.path}</td>
              <td class="py-2 pr-4 text-xs text-slate-400">${e.auth}</td>
              <td class="py-2 text-xs text-slate-400">${e.desc}</td>
            </tr>
          `).join(""))}
        </tbody>
      </table>
    </div>
  `);
}

function Stack() {
  const chips = [
    { label: "Celo mainnet 42220", desc: "settlement chain, USDC/USDT" },
    { label: "x402 self-settle", desc: "EIP-3009 permits, seller pays gas" },
    { label: "ERC-8021", desc: "attribution tag in calldata" },
    { label: "Mento FPMM / Uniswap", desc: "onchain price sources" },
    { label: "er-api · Frankfurter · PTAX", desc: "official FX reference cascade" },
    { label: "MCP /mcp/fxdelta", desc: "5 tools, freemium + SSE" },
    { label: "Telegram", desc: "delta alerts (optional)" },
    { label: "Arc anchoring", desc: "verdict hash anchor (optional)" },
    { label: "Hono + hono/html", desc: "server-rendered, zero client framework" },
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
      <h2 class="text-2xl font-bold text-white">One call = one verifiable mainnet payment</h2>
      <p class="mt-3 text-slate-400">Plug in your agent, sign a permit, and verify the settle on Blockscout.</p>
      <div class="mt-6 flex justify-center gap-4">
        <a href="#demo" class="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition">Probe the API →</a>
        <a href="${BLOCKSCOUT_TX}" target="_blank" rel="noopener" class="rounded-lg border border-emerald-600/60 px-6 py-3 text-sm font-semibold text-emerald-300 hover:border-emerald-400 transition">Payment proof ↗</a>
      </div>
      <p class="mt-8 text-xs text-slate-500">
        Support: <a href="mailto:support@agentbadge.xyz" class="text-slate-400 hover:text-slate-200">support@agentbadge.xyz</a>
      </p>
    </div>
  </section>`;
}
