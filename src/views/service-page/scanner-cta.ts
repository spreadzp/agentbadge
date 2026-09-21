// EPIC-140 (SLICE-140-20): scanner CTA (button + scan form + report script).
import { html, raw } from "hono/html";
import { SCANNER_SCRIPT_CORE } from "./scanner-script-core";
import { SCANNER_SCRIPT_REPORT } from "./scanner-script-report";

export function ScannerCta(ctaLabel: string) {
  return html`<button id="scanner-cta-btn" type="button" class="snake-border inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900/50 px-8 py-4 text-base font-semibold text-slate-300 transition-colors hover:border-emerald-500 hover:text-emerald-400" onclick="document.getElementById('scan-form-wrapper').classList.remove('hidden'); document.getElementById('scanner-cta-btn').classList.add('hidden'); document.getElementById('total-scan-url').focus();">
            ${ctaLabel}
            <svg class="ml-2 h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <div id="scan-form-wrapper" class="hidden fade-in-up mt-2">
            <form id="total-scan-form" class="flex flex-col gap-3 sm:flex-row">
              <input
                id="total-scan-url"
                type="url"
                placeholder="https://example.com"
                required
                class="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <button
                id="total-scan-submit"
                type="submit"
                class="snake-border inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900/50 px-6 py-3 text-sm font-semibold text-slate-300 transition-colors hover:border-emerald-500 hover:text-emerald-400"
              >
                Start Full Scan
              </button>
            </form>
            <button
              type="button"
              class="mt-2 text-xs text-slate-500 hover:text-slate-300"
              onclick="document.getElementById('scan-form-wrapper').classList.add('hidden'); document.getElementById('scanner-cta-btn').classList.remove('hidden');"
            >
              Cancel
            </button>
            <div id="total-scan-result" class="mt-6 hidden"></div>
          </div>
          <script>${raw(SCANNER_SCRIPT_CORE)}${raw(SCANNER_SCRIPT_REPORT)}          </script>`;
}
