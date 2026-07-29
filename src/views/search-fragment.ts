import { html } from "hono/html";
import type { DirectoryEntry } from "@agentgate-hedera/passport";
import { AgentRow, type AgentWithActive } from "./agents-fragment";

/** Search query classification result. */
export type SearchQueryType = "did" | "tokenId" | "name";

export interface ParsedSearchQuery {
  type: SearchQueryType;
  value: string;
}

/**
 * Parse a search query string and classify it as DID, tokenId, or name.
 * (SLICE-4-3, hackathon-flow.md:62)
 *
 * Heuristics:
 * - `did:hcs:...` → DID lookup
 * - `\d+\.\d+\.\d+` (Hedera entity ID shape) → tokenId lookup
 * - Otherwise → name substring match against directory entries
 */
export function parseSearchQuery(q: string): ParsedSearchQuery {
  const trimmed = q.trim();

  if (trimmed.startsWith("did:hcs:")) {
    return { type: "did", value: trimmed };
  }

  // Hedera entity ID: N.N.N (e.g. 0.0.1234567)
  if (/^\d+\.\d+\.\d+$/.test(trimmed)) {
    return { type: "tokenId", value: trimmed };
  }

  return { type: "name", value: trimmed };
}

/**
 * Render the search form fragment with optional skills filter.
 * (SLICE-4-3, hackathon-flow.md:132)
 *
 * @param allSkills  Unique skills collected from all agents' IPFS metadata
 */
export function SearchForm({ allSkills = [] }: { allSkills?: string[] } = {}) {
  return html`<form hx-get="/ui/search" hx-target="#results" class="mb-6">
      <div class="flex gap-2">
        <input
          type="text"
          name="q"
          placeholder="Search by DID, tokenId, or agent name…"
          class="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
        />
        <button
          type="submit"
          class="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400"
        >
          Search
        </button>
      </div>
      ${allSkills.length > 0
      ? html`<details class="mt-3 rounded-lg border border-slate-700 bg-slate-800 p-3">
              <summary class="cursor-pointer text-sm text-slate-300 select-none">
                Filter by skills (${allSkills.length})
              </summary>
              <div class="mt-3 flex flex-wrap gap-2 max-h-48 overflow-y-auto">
                ${allSkills.map(
        (skill) =>
          html`<label
                        class="flex items-center gap-1 rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 cursor-pointer hover:bg-slate-600"
                      >
                        <input type="checkbox" name="skills" value="${skill}" class="accent-indigo-500" />
                        ${skill}
                      </label>`,
      )}
              </div>
              <div class="mt-2 flex gap-2">
                <button
                  type="button"
                  onclick="document.querySelectorAll('input[name=skills]').forEach(c => c.checked = true)"
                  class="text-xs text-slate-400 hover:text-slate-200"
                >Select all</button>
                <button
                  type="button"
                  onclick="document.querySelectorAll('input[name=skills]').forEach(c => c.checked = false)"
                  class="text-xs text-slate-400 hover:text-slate-200"
                >Clear</button>
              </div>
            </details>`
      : null
    }
    </form>
    <div id="results"></div>`;
}

/**
 * Render search results fragment.
 * (SLICE-4-3, hackathon-flow.md:132)
 */
export function SearchResults({
  query,
  agents,
  allSkills = [],
}: {
  query: string;
  agents: AgentWithActive[];
  allSkills?: string[];
}) {
  if (!query.trim() && allSkills.length === 0) {
    return SearchForm({ allSkills });
  }

  if (agents.length === 0) {
    return html`<div
      class="rounded-lg border border-slate-800 bg-slate-900 p-4 text-center text-slate-300"
    >
      <p>No results found for "${query}".</p>
    </div>`;
  }

  return html`<div class="space-y-3">${agents.map((agent) => AgentRow({ agent }))}</div>`;
}
