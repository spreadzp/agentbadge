import { html, raw } from "hono/html";

/**
 * Shared Footer component — used by both Layout() and LandingLayout().
 * (SLICE-19-1: extracted from layout.ts for reuse)
 */
export function Footer(): ReturnType<typeof html> {
  return html`<footer class="border-t border-slate-800 bg-slate-900">
    <div class="flex flex-col items-center justify-between gap-4 px-4 py-6 sm:flex-row">
      <div class="flex items-center gap-2 text-sm text-slate-400">
        <picture><img src="/icons/logo-32.webp" srcset="/icons/logo-64.webp 2x" alt="" class="h-5 w-5 rounded" /></picture>
        <span>AgentBadge · On-chain identity for AI agents on Hedera</span>
      </div>
      <div class="flex flex-col text-sm text-slate-400 sm:flex-row sm:gap-4">
        <a href="/agent-guide" class="footer-pop inline-block min-h-6 py-1 hover:text-emerald-400">Agent Guide</a>
        <a href="/market-guide" class="footer-pop inline-block min-h-6 py-1 hover:text-emerald-400">Market Guide</a>
        <a href="/medical-guide" class="footer-pop inline-block min-h-6 py-1 hover:text-emerald-400">Medical Guide</a>
        <a href="/faq" class="footer-pop inline-block min-h-6 py-1 hover:text-emerald-400">FAQ</a>
        <a href="/use-cases" class="footer-pop inline-block min-h-6 py-1 hover:text-emerald-400">Use Cases</a>
        <a href="/about" class="footer-pop inline-block min-h-6 py-1 hover:text-emerald-400">About</a>
        <a href="/pricing" class="footer-pop inline-block min-h-6 py-1 hover:text-emerald-400">Pricing</a>
        <a href="/terms" class="footer-pop inline-block min-h-6 py-1 hover:text-emerald-400">Terms</a>
        <a href="/privacy" class="footer-pop inline-block min-h-6 py-1 hover:text-emerald-400">Privacy</a>
        <a href="/changelog" class="footer-pop inline-block min-h-6 py-1 hover:text-emerald-400">Changelog</a>
        <a href="/team" class="footer-pop inline-block min-h-6 py-1 hover:text-emerald-400">Team</a>
        <a href="/services" class="footer-pop inline-block min-h-6 py-1 hover:text-emerald-400">Services</a>
        <a href="/work-with-us" class="footer-pop inline-block min-h-6 py-1 hover:text-emerald-400">Work With Us</a>
        <a href="/ui/medical-demo" class="footer-pop inline-block min-h-6 py-1 hover:text-emerald-400">Medical Demo</a>
        <a href="https://hashscan.io/testnet" target="_blank" rel="noopener" class="footer-pop inline-block min-h-6 py-1 hover:text-emerald-400">HashScan</a>
      </div>
    </div>
    <div class="flex items-center justify-center gap-4 border-t border-slate-800 px-4 py-4">
      <a href="/contact" class="footer-pop inline-flex min-h-6 min-w-6 items-center justify-center p-1 text-slate-400 hover:text-emerald-400" aria-label="Discord">
        <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.872-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
      </a>
      <a href="/contact" class="footer-pop inline-flex min-h-6 min-w-6 items-center justify-center p-1 text-slate-400 hover:text-emerald-400" aria-label="Telegram">
        <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.531 6.998-3.02 3.332-1.387 4.025-1.627 4.476-1.635z" />
        </svg>
      </a>
      <a href="https://raw.githubusercontent.com/spreadzp/agentbadge/refs/heads/main/AGENT-REFERENCE.md" target="_blank" rel="noopener" class="footer-pop inline-flex min-h-6 min-w-6 items-center justify-center p-1 text-slate-400 hover:text-emerald-400" aria-label="GitHub">
        <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c 0-6.627-5.373-12-12-12" />
        </svg>
      </a>
    </div>
    <div class="border-t border-slate-800 py-4 text-center text-xs text-slate-400">
      © 2026 AgentBadge. MIT License. Built on Hedera.
    </div>
  </footer>`;
}
