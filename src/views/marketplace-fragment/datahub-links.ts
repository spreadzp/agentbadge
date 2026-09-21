import { html } from "hono/html";

export function DataHubLinks(datasetUrn?: string): ReturnType<typeof html> | string {
  if (!datasetUrn) return "";

  const datahubUrl = process.env.DATAHUB_UI_URL ?? "http://localhost:9002";
  const encodedUrn = encodeURIComponent(datasetUrn);

  return html`<div class="rounded-lg border border-slate-700 bg-slate-900 p-4 space-y-2">
    <div class="flex items-center gap-2">
      <svg class="h-4 w-4 text-blue-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>
      <h3 class="text-sm font-semibold text-white">DataHub Catalog</h3>
    </div>
    <div class="text-xs text-slate-500">Dataset URN:</div>
    <div class="font-mono text-xs text-slate-300 break-all">${datasetUrn}</div>
    <div class="flex flex-wrap gap-2 pt-1">
      <a href="${datahubUrl}/dataset/${encodedUrn}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-blue-400 hover:bg-slate-700 transition-colors">
        <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
        View Dataset
      </a>
      <a href="${datahubUrl}/lineage/${encodedUrn}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-blue-400 hover:bg-slate-700 transition-colors">
        <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
        Lineage Graph
      </a>
      <a href="${datahubUrl}/glossary" target="_blank" rel="noopener" class="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-blue-400 hover:bg-slate-700 transition-colors">
        <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.029 4.988 7.529 4.231 5 4.231c-2.53 0-5.029.757-7 2.022v13c1.971-1.265 4.471-2.022 7-2.022 2.529 0 5.029.757 7 2.022V4.231c1.971-1.265 4.471-2.022 7-2.022 2.529 0 5.029.757 7 2.022v13c-1.971-1.265-4.471-2.022-7-2.022-2.529 0-5.029.757-7 2.022" /></svg>
        Glossary
      </a>
      <a href="${datahubUrl}/assertions" target="_blank" rel="noopener" class="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-blue-400 hover:bg-slate-700 transition-colors">
        <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        Assertions
      </a>
    </div>
  </div>`;
}
