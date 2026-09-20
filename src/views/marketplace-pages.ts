/**
 * Marketplace UI views (EPIC-138, SLICE-138-5).
 *
 * /market/services        — catalog grid + search/category filter
 * /market/services/:id    — service detail + buy link
 * /market/buy/:serviceId  — standalone checkout (D7 embeddable buyUrl)
 * /market/sell            — business onboarding (passport + service forms)
 * /market/passes          — buyer's passes
 *
 * Note: GET /market itself is a 301 → /services/marketplace (SLICE-131-2
 * SEO fix) — catalog lives at /market/services.
 */

import { html, raw } from "hono/html";
import { Layout } from "./layout";
import type { PageMeta } from "../server/lib/page-meta";
import type { CatalogService } from "../server/lib/marketplace";

const CARD =
  "rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 hover:border-emerald-500/40 transition-colors";
const INPUT =
  "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none";
const BTN =
  "rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors disabled:opacity-50";
const LABEL = "block text-xs font-medium text-slate-400 mb-1";

function esc(s: string | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function serviceCard(svc: CatalogService): string {
  return `
  <a href="/market/services/${esc(svc.serviceId)}" class="${CARD} block">
    <div class="flex items-start justify-between gap-2">
      <h3 class="text-lg font-semibold text-slate-100">${esc(svc.name)}</h3>
      ${svc.category ? `<span class="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-emerald-400">${esc(svc.category)}</span>` : ""}
    </div>
    <p class="mt-2 text-sm text-slate-400 line-clamp-2">${esc(svc.description)}</p>
    <div class="mt-4 flex items-center justify-between text-sm">
      <span class="font-semibold text-emerald-400">$${esc(svc.priceUsd)} USDC</span>
      <span class="text-slate-500">${svc.durationDays}d pass</span>
    </div>
  </a>`;
}

// ─── Catalog ───────────────────────────────────────────────────
export function marketCatalogPage(
  services: CatalogService[],
  filter: { category?: string; q?: string },
): string {
  const categories = [
    ...new Set(services.map((s) => s.category).filter(Boolean)),
  ] as string[];
  const body = html`
    <main class="mx-auto max-w-6xl px-4 py-12">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-3xl font-bold">Service Marketplace</h1>
          <p class="mt-2 text-slate-400">
            Pay-per-access APIs and MCP services. Buy a pass with USDC —
            soulbound NFT on Arc, verifiable on-chain.
          </p>
        </div>
        <a href="/market/sell" class="${BTN}">Sell your service</a>
      </div>

      <form method="get" action="/market/services" class="mt-8 flex flex-wrap gap-3">
        <input name="q" value="${esc(filter.q)}" placeholder="Search services…" class="${INPUT} max-w-xs" />
        <select name="category" class="${INPUT} max-w-[180px]">
          <option value="">All categories</option>
          ${raw(
            categories
              .map(
                (cat) =>
                  `<option value="${esc(cat)}" ${cat === filter.category ? "selected" : ""}>${esc(cat)}</option>`,
              )
              .join(""),
          )}
        </select>
        <button type="submit" class="${BTN}">Filter</button>
      </form>

      <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        ${services.length === 0
          ? raw(`<p class="col-span-full text-slate-500">No services yet. <a href="/market/sell" class="text-emerald-400 underline">Be the first seller</a>.</p>`)
          : raw(services.map(serviceCard).join(""))}
      </div>

      <p class="mt-10 text-xs text-slate-500">
        Machine-readable catalog: <code class="text-slate-400">GET /api/market/services</code>
      </p>
    </main>`;
  const meta: PageMeta = {
    title: "Service Marketplace",
    description:
      "Buy access passes for agent-ready APIs and MCP services. USDC payments, soulbound NFT passes on Arc.",
    path: "/market/services",
  };
  return Layout(body as unknown as string, undefined, meta, [
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "AgentBadge Service Marketplace",
      itemListElement: services.map((s, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "Service",
          name: s.name,
          description: s.description,
          url: `https://agentbadge.xyz/market/services/${s.serviceId}`,
          offers: {
            "@type": "Offer",
            price: s.priceUsd,
            priceCurrency: "USD",
          },
        },
      })),
    },
  ]).toString();
}

// ─── Service detail ────────────────────────────────────────────
export function marketServicePage(svc: CatalogService): string {
  const body = html`
    <main class="mx-auto max-w-3xl px-4 py-12">
      <a href="/market/services" class="text-sm text-slate-500 hover:text-slate-300">← All services</a>
      <div class="mt-4 ${CARD}">
        <div class="flex items-start justify-between gap-3">
          <h1 class="text-2xl font-bold">${esc(svc.name)}</h1>
          ${svc.category ? `<span class="rounded-full bg-slate-800 px-3 py-1 text-xs text-emerald-400">${esc(svc.category)}</span>` : ""}
        </div>
        <p class="mt-4 text-slate-300">${esc(svc.description)}</p>
        <dl class="mt-6 grid grid-cols-2 gap-4 text-sm">
          <div><dt class="${LABEL}">Price</dt><dd class="text-lg font-semibold text-emerald-400">$${esc(svc.priceUsd)} USDC</dd></div>
          <div><dt class="${LABEL}">Pass duration</dt><dd class="text-lg text-slate-200">${svc.durationDays} days</dd></div>
          ${svc.endpointUrl ? `<div class="col-span-2"><dt class="${LABEL}">Endpoint</dt><dd><code class="text-slate-300">${esc(svc.endpointUrl)}</code></dd></div>` : ""}
          ${svc.docsUrl ? `<div class="col-span-2"><dt class="${LABEL}">Docs</dt><dd><a href="${esc(svc.docsUrl)}" class="text-emerald-400 underline" rel="noopener">${esc(svc.docsUrl)}</a></dd></div>` : ""}
        </dl>
        <div class="mt-8 flex items-center gap-3">
          <a href="/market/buy/${esc(svc.serviceId)}" class="${BTN}">Buy Pass — $${esc(svc.priceUsd)}</a>
          <span class="text-xs text-slate-500">Soulbound NFT on Arc · renews via same link</span>
        </div>
      </div>
      <p class="mt-6 text-xs text-slate-500">
        Agents: <code>POST /api/market/buy/${esc(svc.serviceId)}</code> (x402) ·
        serviceId <code>${esc(svc.serviceId)}</code>
      </p>
    </main>`;
  const meta: PageMeta = {
    title: svc.name,
    description: svc.description || `${svc.name} — $${svc.priceUsd} USDC pass`,
    path: `/market/services/${svc.serviceId}`,
  };
  return Layout(body as unknown as string, undefined, meta, [
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: svc.name,
      description: svc.description,
      url: `https://agentbadge.xyz/market/services/${svc.serviceId}`,
      ...(svc.docsUrl ? { sameAs: svc.docsUrl } : {}),
      offers: {
        "@type": "Offer",
        price: svc.priceUsd,
        priceCurrency: "USD",
        url: `https://agentbadge.xyz/market/buy/${svc.serviceId}`,
      },
    },
  ]).toString();
}

// ─── Shared checkout JS (x402 EIP-3009 flow) ───────────────────
const X402_JS = `
async function x402Fetch(url, opts) {
  opts = opts || {};
  opts.headers = Object.assign({}, opts.headers);
  let res = await fetch(url, opts);
  if (res.status !== 402) return res;
  const req = await res.json();
  const acc = (req.accepts || [])[0];
  if (!acc) throw new Error("402 without payment requirements");
  if (!window.ethereum) throw new Error("No wallet — connect MetaMask or use the agent flow below");
  const [from] = await ethereum.request({ method: "eth_requestAccounts" });
  const chainId = parseInt(acc.network.split(":")[1]);
  const hexChain = "0x" + chainId.toString(16);
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChain }] });
  } catch (e) {
    if (e.code === 4902) throw new Error("Add chain " + acc.network + " to your wallet");
    throw e;
  }
  const now = Math.floor(Date.now() / 1000);
  const nonce = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, "0")).join("");
  const authorization = {
    from: from,
    to: acc.payTo,
    value: String(acc.amount),
    validAfter: "0",
    validBefore: String(now + (acc.maxTimeoutSeconds || 300)),
    nonce: nonce
  };
  const domain = {
    name: (acc.extra && acc.extra.name) || "USDC",
    version: (acc.extra && acc.extra.version) || "2",
    chainId: chainId,
    verifyingContract: acc.asset
  };
  const typedData = {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" }, { name: "version", type: "string" },
        { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }
      ],
      TransferWithAuthorization: [
        { name: "from", type: "address" }, { name: "to", type: "address" },
        { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }
      ]
    },
    primaryType: "TransferWithAuthorization",
    domain: domain,
    message: authorization
  };
  const signature = await ethereum.request({
    method: "eth_signTypedData_v4",
    params: [from, JSON.stringify(typedData)]
  });
  const payload = {
    x402Version: 2,
    scheme: acc.scheme || "exact",
    network: acc.network,
    payload: { signature: signature, authorization: authorization }
  };
  const encoded = btoa(JSON.stringify(payload));
  opts.headers["PAYMENT-SIGNATURE"] = encoded;
  opts.headers["X-PAYMENT"] = encoded;
  return fetch(url, opts);
}

async function signAccessChallenge(wallet, method, path) {
  const ts = Math.floor(Date.now() / 1000);
  const msg = ["agentbadge-access:v1", "wallet:" + wallet.toLowerCase(),
    "method:" + method.toUpperCase(), "path:" + path, "timestamp:" + ts].join("\\n");
  const sig = await ethereum.request({
    method: "personal_sign",
    params: ["0x" + Array.from(new TextEncoder().encode(msg)).map(b => b.toString(16).padStart(2, "0")).join(""), wallet]
  });
  return { "x-wallet": wallet, "x-sig": sig, "x-timestamp": String(ts) };
}
`;

// ─── Standalone checkout (D7 embeddable buyUrl) ────────────────
export function marketCheckoutPage(svc: CatalogService): string {
  const body = html`
    <main class="mx-auto max-w-lg px-4 py-12">
      <div class="${CARD}">
        <h1 class="text-xl font-bold">${esc(svc.name)}</h1>
        <p class="mt-2 text-sm text-slate-400">${esc(svc.description)}</p>
        <div class="mt-4 flex items-baseline gap-2">
          <span class="text-3xl font-bold text-emerald-400">$${esc(svc.priceUsd)}</span>
          <span class="text-sm text-slate-500">USDC · ${svc.durationDays}-day pass</span>
        </div>
        <button id="buy-btn" class="${BTN} mt-6 w-full">Connect wallet &amp; buy</button>
        <p id="buy-status" class="mt-3 text-center text-sm text-slate-400"></p>
        <div id="buy-result" class="mt-4 hidden rounded-lg border border-emerald-700/50 bg-emerald-950/30 p-4 text-sm"></div>
      </div>
      <details class="mt-6 text-sm text-slate-500">
        <summary class="cursor-pointer hover:text-slate-300">Agent flow (no browser wallet)</summary>
        <pre class="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-300"># x402 client handles the 402 → pay → retry loop
curl -X POST https://agentbadge.xyz/api/market/buy/${esc(svc.serviceId)} \\
  -H "PAYMENT-SIGNATURE: &lt;x402v2-payload&gt;"
# then check your pass:
curl https://agentbadge.xyz/api/market/passes/&lt;your-wallet&gt;</pre>
      </details>
    </main>
    <script>${raw(X402_JS)}
      const btn = document.getElementById("buy-btn");
      const status = document.getElementById("buy-status");
      const result = document.getElementById("buy-result");
      btn.onclick = async () => {
        btn.disabled = true;
        status.textContent = "Requesting payment requirements…";
        try {
          const res = await x402Fetch("/api/market/buy/${esc(svc.serviceId)}", { method: "POST" });
          if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            throw new Error(e.error || e.message || "HTTP " + res.status);
          }
          status.textContent = "Payment settled — minting your pass…";
          const [wallet] = await ethereum.request({ method: "eth_accounts" });
          // Pass mints in afterSettle — poll briefly.
          for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const p = await fetch("/api/market/passes/" + wallet).then(r => r.json());
            const pass = (p.passes || []).find(x => x.serviceId === "${esc(svc.serviceId)}");
            if (pass) {
              status.textContent = "";
              result.classList.remove("hidden");
              result.innerHTML = "✅ Pass active until <b>" +
                new Date(pass.expiresAt * 1000).toLocaleDateString() + "</b><br>" +
                "<span class='text-slate-400'>tokenId " + pass.tokenId + " · soulbound on Arc</span>";
              return;
            }
          }
          status.textContent = "Paid — pass minting in progress, check /market/passes shortly.";
        } catch (e) {
          status.textContent = "Error: " + (e.message || e);
          btn.disabled = false;
        }
      };
    </script>`;
  const meta: PageMeta = {
    title: `Buy ${svc.name}`,
    description: `Buy a ${svc.durationDays}-day access pass for ${svc.name} — $${svc.priceUsd} USDC.`,
    path: `/market/buy/${svc.serviceId}`,
  };
  return Layout(body as unknown as string, undefined, meta).toString();
}

// ─── Business onboarding ───────────────────────────────────────
export function marketSellPage(): string {
  const body = html`
    <main class="mx-auto max-w-3xl px-4 py-12">
      <h1 class="text-3xl font-bold">Sell on the Marketplace</h1>
      <p class="mt-2 text-slate-400">
        Two steps: mint a Business Passport (yearly), then register services.
        Buyers pay you directly — 90% to you, 10% platform fee, on-chain split.
      </p>

      <section class="mt-8 ${CARD}">
        <h2 class="text-lg font-semibold">1 · Business Passport</h2>
        <p class="mt-1 text-sm text-slate-500">One passport per wallet. Metadata is pinned to IPFS.</p>
        <form id="passport-form" class="mt-4 grid gap-3">
          <div><label class="${LABEL}">Business name *</label><input name="name" required maxlength="100" class="${INPUT}" /></div>
          <div><label class="${LABEL}">Endpoint URL (https) *</label><input name="endpointUrl" required type="url" placeholder="https://api.example.com" class="${INPUT}" /></div>
          <div><label class="${LABEL}">Category *</label><input name="category" required maxlength="50" placeholder="data, ai, search…" class="${INPUT}" /></div>
          <div><label class="${LABEL}">Description * (≤500 chars)</label><textarea name="description" required maxlength="500" rows="2" class="${INPUT}"></textarea></div>
          <div><label class="${LABEL}">Docs URL (https) *</label><input name="docsUrl" required type="url" class="${INPUT}" /></div>
          <button type="submit" class="${BTN}">Mint Passport</button>
          <p id="passport-status" class="text-sm text-slate-400"></p>
        </form>
      </section>

      <section class="mt-6 ${CARD}">
        <h2 class="text-lg font-semibold">2 · Register a service</h2>
        <form id="service-form" class="mt-4 grid gap-3">
          <div><label class="${LABEL}">Passport token ID *</label><input name="passportTokenId" required pattern="\\d+" class="${INPUT}" /></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="${LABEL}">Sub-ID * (a-z0-9-)</label><input name="subId" required pattern="[a-z0-9][a-z0-9-]{0,30}" placeholder="api" class="${INPUT}" /></div>
            <div><label class="${LABEL}">Name *</label><input name="name" required maxlength="100" class="${INPUT}" /></div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="${LABEL}">Price USD * (≥1)</label><input name="priceUsd" required placeholder="5.00" class="${INPUT}" /></div>
            <div><label class="${LABEL}">Duration days * (1-365)</label><input name="durationDays" required type="number" min="1" max="365" value="30" class="${INPUT}" /></div>
          </div>
          <div><label class="${LABEL}">Description (≤500)</label><textarea name="description" maxlength="500" rows="2" class="${INPUT}"></textarea></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="${LABEL}">Category</label><input name="category" maxlength="50" class="${INPUT}" /></div>
            <div><label class="${LABEL}">Docs URL</label><input name="docsUrl" type="url" class="${INPUT}" /></div>
          </div>
          <div><label class="${LABEL}">Endpoint URL</label><input name="endpointUrl" type="url" class="${INPUT}" /></div>
          <button type="submit" class="${BTN}">Register Service</button>
          <p id="service-status" class="text-sm text-slate-400"></p>
          <div id="service-result" class="hidden rounded-lg border border-emerald-700/50 bg-emerald-950/30 p-4 text-sm"></div>
        </form>
      </section>

      <p class="mt-6 text-xs text-slate-500">
        Agents: <code>POST /api/market/passport</code> + <code>POST /api/market/services</code>
        with X-Wallet/X-Sig/X-Timestamp headers.
      </p>
    </main>
    <script>${raw(X402_JS)}
      async function connectWallet() {
        if (!window.ethereum) throw new Error("No browser wallet — use the API flow");
        const [w] = await ethereum.request({ method: "eth_requestAccounts" });
        return w;
      }
      function formData(form) {
        const o = {};
        new FormData(form).forEach((v, k) => { if (v !== "") o[k] = v; });
        return o;
      }

      document.getElementById("passport-form").onsubmit = async (e) => {
        e.preventDefault();
        const st = document.getElementById("passport-status");
        st.textContent = "Connect wallet…";
        try {
          const wallet = await connectWallet();
          const path = "/api/market/passport";
          const sig = await signAccessChallenge(wallet, "POST", path);
          st.textContent = "Paying passport fee…";
          const res = await x402Fetch(path, {
            method: "POST",
            headers: Object.assign({ "content-type": "application/json" }, sig),
            body: JSON.stringify(formData(e.target)),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error?.message || json.error || "HTTP " + res.status);
          st.innerHTML = "✅ Passport #" + json.passportId + " minted — tx " +
            String(json.mintTx).slice(0, 18) + "…";
        } catch (err) { st.textContent = "Error: " + (err.message || err); }
      };

      document.getElementById("service-form").onsubmit = async (e) => {
        e.preventDefault();
        const st = document.getElementById("service-status");
        const out = document.getElementById("service-result");
        st.textContent = "Connect wallet…";
        try {
          const wallet = await connectWallet();
          const path = "/api/market/services";
          const sig = await signAccessChallenge(wallet, "POST", path);
          st.textContent = "Registering on-chain…";
          const res = await fetch(path, {
            method: "POST",
            headers: Object.assign({ "content-type": "application/json" }, sig),
            body: JSON.stringify(formData(e.target)),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error?.message || json.error || "HTTP " + res.status);
          st.textContent = "";
          out.classList.remove("hidden");
          out.innerHTML = "✅ Service live.<br>Buy link: <a class='text-emerald-400 underline' href='" +
            json.buyUrl + "'>" + json.buyUrl + "</a><br>" +
            "<span class='text-slate-400'>Embed: &lt;a href=\"" + json.buyUrl + "\"&gt;Buy access&lt;/a&gt;</span>";
        } catch (err) { st.textContent = "Error: " + (err.message || err); }
      };
    </script>`;
  const meta: PageMeta = {
    title: "Sell on the Marketplace",
    description:
      "Mint a Business Passport and list your API or MCP service. 90% of every sale goes to you — on-chain split, USDC.",
    path: "/market/sell",
  };
  return Layout(body as unknown as string, undefined, meta).toString();
}

// ─── Buyer passes ──────────────────────────────────────────────
export function marketPassesPage(): string {
  const body = html`
    <main class="mx-auto max-w-3xl px-4 py-12">
      <h1 class="text-3xl font-bold">My Passes</h1>
      <p class="mt-2 text-slate-400">Service passes owned by a wallet (soulbound NFTs on Arc).</p>
      <div class="mt-6 flex gap-3">
        <input id="wallet-input" placeholder="0x… wallet address" class="${INPUT}" />
        <button id="wallet-connect" class="${BTN}">Connect</button>
        <button id="wallet-load" class="${BTN}">Load</button>
      </div>
      <div id="passes-list" class="mt-8 grid gap-4"></div>
    </main>
    <script>
      const input = document.getElementById("wallet-input");
      const list = document.getElementById("passes-list");
      document.getElementById("wallet-connect").onclick = async () => {
        if (!window.ethereum) return alert("No browser wallet");
        const [w] = await ethereum.request({ method: "eth_requestAccounts" });
        input.value = w;
        load();
      };
      document.getElementById("wallet-load").onclick = load;
      async function load() {
        const w = input.value.trim();
        if (!/^0x[0-9a-fA-F]{40}$/.test(w)) { list.innerHTML = "<p class='text-slate-500'>Enter a valid 0x address.</p>"; return; }
        list.innerHTML = "<p class='text-slate-500'>Loading…</p>";
        const res = await fetch("/api/market/passes/" + w);
        const json = await res.json();
        const passes = json.passes || [];
        if (!passes.length) { list.innerHTML = "<p class='text-slate-500'>No passes for this wallet.</p>"; return; }
        list.innerHTML = passes.map(p =>
          '<div class="${CARD}"><div class="flex justify-between">' +
          '<a class="font-semibold text-slate-100 hover:text-emerald-400" href="/market/services/' + p.serviceId + '">' +
          (p.service || p.serviceId.slice(0, 14) + "…") + "</a>" +
          (p.active
            ? '<span class="text-emerald-400 text-sm">active</span>'
            : '<span class="text-red-400 text-sm">expired</span>') +
          '</div><p class="mt-2 text-sm text-slate-400">tokenId ' + p.tokenId +
          " · expires " + new Date(p.expiresAt * 1000).toLocaleString() + "</p>" +
          '<a class="mt-3 inline-block text-sm text-emerald-400 underline" href="/market/buy/' + p.serviceId + '">Renew</a></div>'
        ).join("");
      }
    </script>`;
  const meta: PageMeta = {
    title: "My Passes",
    description: "View your marketplace service passes — soulbound NFTs on Arc.",
    path: "/market/passes",
  };
  return Layout(body as unknown as string, undefined, meta).toString();
}
