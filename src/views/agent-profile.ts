import { html } from "hono/html";
import { raw } from "hono/html";
import { PageHeader } from "./page-header";
import type { AgentWithActive } from "./agents-fragment";

/**
 * Render a full agent profile page (mini-landing).
 *
 * Shows: name, tier, status, DID, account, capabilities, skills, endpoint,
 * HashScan link, A2A inbox/outbox links, and registration timestamp.
 */
export function AgentProfilePage({ agent }: { agent: AgentWithActive }) {
  const network = process.env.HEDERA_NETWORK ?? "testnet";
  const hashScanUrl = `https://hashscan.io/${network}/token/${agent.tokenId}/${agent.serial}`;
  const accountHashScanUrl = `https://hashscan.io/${network}/account/${agent.accountId}`;
  const issuedDate = new Date(agent.timestamp * 1000).toLocaleString();

  const ipfsGateway = "https://ipfs.io/ipfs/";
  const imageUrl = agent.image
    ? agent.image.startsWith("ipfs://")
      ? `${ipfsGateway}${agent.image.replace("ipfs://", "")}`
      : agent.image
    : undefined;

  const colors = [
    "from-emerald-500 to-teal-500",
    "from-sky-500 to-indigo-500",
    "from-amber-500 to-orange-500",
    "from-rose-500 to-pink-500",
    "from-violet-500 to-purple-500",
    "from-cyan-500 to-blue-500",
  ];
  const colorIdx = agent.name.charCodeAt(0) % colors.length;
  const gradient = colors[colorIdx];

  return html`${raw(PageHeader({
    badge: `${agent.tier} tier`,
    title: agent.name,
    description: `Agent profile · ${agent.did}`,
  }).toString())}
  <section class="mt-8 max-w-3xl mx-auto space-y-6">
    <!-- Status & Identity -->
    <div class="rounded-xl border border-slate-800 bg-slate-900 p-6">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          ${imageUrl
      ? html`<img src="${imageUrl}" alt="${agent.name}" class="h-12 w-12 rounded-full object-cover" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'" />`
      : null
    }
          <div class="${imageUrl ? 'hidden' : 'flex'} h-12 w-12 rounded-full bg-gradient-to-br ${gradient} items-center justify-center text-xl font-bold text-white">
            ${agent.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 class="text-xl font-semibold text-white">${agent.name}</h2>
            <p class="text-sm text-slate-400">${agent.tier} tier · ${agent.active ? "ACTIVE" : "INACTIVE"}</p>
          </div>
        </div>
        ${agent.active
      ? html`<span class="rounded bg-emerald-900 px-3 py-1 text-sm text-emerald-300">ACTIVE</span>`
      : html`<span class="rounded bg-red-900 px-3 py-1 text-sm text-red-300">INACTIVE</span>`
    }
      </div>

      <div class="mt-6 space-y-3 text-sm">
        <div class="flex items-center justify-between border-b border-slate-800 pb-2">
          <span class="text-slate-400">DID</span>
          <span class="font-mono text-slate-300">${agent.did}</span>
        </div>
        <div class="flex items-center justify-between border-b border-slate-800 pb-2">
          <span class="text-slate-400">Account</span>
          <a href="${accountHashScanUrl}" target="_blank" rel="noopener" class="font-mono text-emerald-400 underline hover:text-emerald-300">${agent.accountId || "—"}</a>
        </div>
        <div class="flex items-center justify-between border-b border-slate-800 pb-2">
          <span class="text-slate-400">HBAR Balance</span>
          <span class="font-mono ${agent.hbarBalance != null ? 'text-amber-300' : 'text-slate-500'}">${agent.hbarBalance != null ? `${agent.hbarBalance.toFixed(2)} ℏ` : "—"}</span>
        </div>
        <div class="flex items-center justify-between border-b border-slate-800 pb-2">
          <span class="text-slate-400">NFT Serial</span>
          <span class="font-mono text-slate-300">#${agent.serial}</span>
        </div>
        <div class="flex items-center justify-between border-b border-slate-800 pb-2">
          <span class="text-slate-400">Token ID</span>
          <span class="font-mono text-slate-300">${agent.tokenId}</span>
        </div>
        <div class="flex items-center justify-between border-b border-slate-800 pb-2">
          <span class="text-slate-400">Endpoint</span>
          <span class="font-mono text-slate-300 break-all">${agent.endpoint || "—"}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-slate-400">Registered</span>
          <span class="text-slate-300">${issuedDate}</span>
        </div>
      </div>
    </div>

    <!-- Capabilities -->
    <div class="rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h3 class="text-sm font-semibold text-slate-400 uppercase tracking-wide">Capabilities</h3>
      <div class="mt-3 flex flex-wrap gap-2">
        ${agent.capabilities.length > 0
      ? agent.capabilities.map(
        (cap) => html`<span class="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300">${cap}</span>`,
      )
      : html`<span class="text-sm text-slate-400">No capabilities declared.</span>`
    }
      </div>
    </div>

    <!-- Skills -->
    ${agent.skills && agent.skills.length > 0
      ? html`<div class="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h3 class="text-sm font-semibold text-slate-400 uppercase tracking-wide">Skills</h3>
          <div class="mt-3 flex flex-wrap gap-2">
            ${agent.skills.map(
        (skill) => html`<span class="rounded-lg bg-indigo-900 px-3 py-1.5 text-sm text-indigo-300">${skill}</span>`,
      )}
          </div>
        </div>`
      : null
    }

    <!-- Actions -->
    <div class="rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h3 class="text-sm font-semibold text-slate-400 uppercase tracking-wide">Actions</h3>
      <div class="mt-3 flex flex-wrap gap-3">
        <a href="/ui/a2a/inbox?did=${encodeURIComponent(agent.did)}"
           class="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
          View Inbox
        </a>
        <a href="/ui/a2a/outbox?did=${encodeURIComponent(agent.did)}"
           class="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 8l-7.89-5.26a2 2 0 00-2.22 0L3 8m18 0v10a2 2 0 01-2 2H5a2 2 0 01-2-2V8m18 0L5 19" /></svg>
          View Outbox
        </a>
        <a href="${hashScanUrl}" target="_blank" rel="noopener"
           class="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
          View on HashScan
        </a>
        <a href="/ui/agents"
           class="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors">
          ← Back to Directory
        </a>
      </div>
    </div>
  </section>`;
}
