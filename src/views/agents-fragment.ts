import { html } from "hono/html";
import type { DirectoryEntry } from "@agentgate-hedera/passport";

/** Agent entry with active status. */
export interface AgentWithActive extends DirectoryEntry {
  active: boolean;
  skills?: string[];
  hbarBalance?: number;
}

/**
 * Render a single agent row as an HTML fragment.
 * (SLICE-4-3, hackathon-flow.md:130-132)
 */
export function AgentRow({ agent }: { agent: AgentWithActive }) {
  const network = process.env.HEDERA_NETWORK ?? "testnet";
  const hashScanUrl = `https://hashscan.io/${network}/token/${agent.tokenId}/${agent.serial}`;

  const profileUrl = agent.accountId
    ? `/ui/agents/${agent.accountId}`
    : `/ui/agents/${agent.tokenId}/${agent.serial}`;

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
  const initial = agent.name.charAt(0).toUpperCase();

  return html`<div
    class="rounded-lg border border-slate-800 bg-slate-900 p-4 hover:border-slate-600 transition-colors"
  >
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        ${imageUrl
      ? html`<img src="${imageUrl}" alt="${agent.name}" class="h-10 w-10 rounded-full object-cover flex-shrink-0" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />`
      : null
    }
        <div class="${imageUrl ? 'hidden' : 'flex'} h-10 w-10 rounded-full bg-gradient-to-br ${gradient} items-center justify-center text-lg font-bold text-white flex-shrink-0">
          ${initial}
        </div>
        <div>
          <a href="${profileUrl}" class="text-lg font-semibold text-white hover:text-emerald-400 transition-colors">${agent.name}</a>
          <span class="text-slate-400 text-sm ml-2">${agent.tier}</span>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <div class="flex items-center gap-1">
          <a
            href="/ui/a2a/inbox?did=${encodeURIComponent(agent.did)}"
            title="Inbox — incoming messages"
            class="text-slate-500 hover:text-sky-400 transition-colors"
            aria-label="View inbox"
          >
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
          </a>
          <a
            href="/ui/a2a/outbox?did=${encodeURIComponent(agent.did)}"
            title="Outbox — sent messages"
            class="text-slate-500 hover:text-amber-400 transition-colors"
            aria-label="View outbox"
          >
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 8l-7.89-5.26a2 2 0 00-2.22 0L3 8m18 0v10a2 2 0 01-2 2H5a2 2 0 01-2-2V8m18 0L5 19" /></svg>
          </a>
          <a
            href="${hashScanUrl}"
            target="_blank"
            rel="noopener"
            title="View passport NFT on HashScan"
            class="text-slate-500 hover:text-emerald-400 transition-colors"
            aria-label="View on HashScan"
          >
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
          </a>
          <button
            type="button"
            title="Copy HashScan link"
            class="text-slate-500 hover:text-emerald-400 transition-colors cursor-pointer"
            aria-label="Copy HashScan link"
            onclick="navigator.clipboard.writeText('${hashScanUrl}').then(()=>{this.textContent='✓';setTimeout(()=>{this.textContent='⧉'},1500)})"
          >
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
          </button>
        </div>
        ${agent.active
      ? html`<span class="rounded bg-emerald-900 px-2 py-1 text-xs text-emerald-300"
              >ACTIVE</span
            >`
      : html`<span class="rounded bg-red-900 px-2 py-1 text-xs text-red-300">INACTIVE</span>`
    }
      </div>
    </div>
    <div class="mt-2 text-sm text-slate-300">
      <span class="font-mono">${agent.did}</span>
    </div>
    <div class="mt-1 text-sm text-slate-400">
      <span>Account: ${agent.accountId}</span>
    </div>
    <div class="mt-2 flex flex-wrap gap-1">
      ${agent.capabilities.map(
      (cap) =>
        html`<span class="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300"
            >${cap}</span
          >`,
    )}
    </div>
    ${agent.skills && agent.skills.length > 0
      ? html`<div class="mt-2">
            <span class="text-xs text-slate-500 mr-1">Skills:</span>
            <div class="flex flex-wrap gap-1 mt-1 max-h-24 overflow-y-auto">
              ${agent.skills.map(
        (skill) =>
          html`<span class="rounded bg-indigo-900 px-2 py-1 text-xs text-indigo-300"
                  >${skill}</span
                >`,
      )}
            </div>
          </div>`
      : null
    }
  </div>`;
}

/**
 * Render the agents directory fragment (no <html> wrapper).
 * (SLICE-4-3, hackathon-flow.md:130-132 — polls every 10s)
 *
 * @param agents  Agent entries with active status
 */
export function AgentsFragment({ agents }: { agents: AgentWithActive[] }) {
  if (agents.length === 0) {
    return html`<div
      class="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center text-slate-300"
    >
      <p>No agents registered yet.</p>
      <p class="text-sm mt-2 text-slate-400">Registered agents will appear here automatically.</p>
    </div>`;
  }

  const PAGE_SIZE = 4;
  const visible = agents.slice(0, PAGE_SIZE);
  const hidden = agents.slice(PAGE_SIZE);

  return html`<div class="space-y-3"
    >${visible.map((agent) => AgentRow({ agent }))}${hidden.map(
    (agent) =>
      html`<div class="hidden" data-paginated="true">${AgentRow({ agent })}</div>`,
  )}</div
  >${hidden.length > 0
      ? html`<button
        type="button"
        onclick="showMore(this, ${PAGE_SIZE})"
        class="mt-3 w-full rounded-lg border border-slate-700 bg-slate-800 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
      >
        Show more (<span class="show-more-remaining">${hidden.length}</span> remaining)
      </button>`
      : ""}`;
}
