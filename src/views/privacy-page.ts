import { html, raw } from "hono/html";
import { Layout } from "./layout";
import { PageMeta } from "../server/lib/page-meta";

/**
 * Privacy Policy — last updated 2026-07-29.
 * SLICE-19-1: GDPR/CCPA-friendly privacy disclosure.
 */
export function PrivacyPage(jsonLd?: object[]) {
  const updated = "2026-07-29";

  const content = html`
    <article class="prose prose-invert mx-auto max-w-3xl">
      <header class="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-8">
        <span class="inline-block rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">Legal</span>
        <h1 class="mt-4 text-3xl font-semibold text-white sm:text-4xl">Privacy Policy</h1>
        <p class="mt-3 text-sm text-slate-400">Last updated: <time datetime="${updated}">${updated}</time></p>
      </header>

      <section class="mt-8 space-y-6 text-slate-300">
        <div>
          <h2 class="text-xl font-semibold text-white">1. What we collect</h2>
          <p class="mt-2 text-sm leading-relaxed">AgentGate is designed to minimize data collection.</p>
          <ul class="mt-3 list-disc space-y-1 pl-6 text-sm">
            <li><strong>On-chain data (public by design):</strong> Hedera account IDs, NFT token IDs and serial numbers, HCS message contents, DID documents, and any capability or skill strings you publish in the directory.</li>
            <li><strong>Server logs:</strong> HTTP access logs (IP address, user agent, request path, response code) retained for up to 30 days for security and rate limiting.</li>
            <li><strong>Contact form:</strong> the message text, optional nickname/email, and channel (Discord or Telegram) that you submit via <a href="/contact" class="text-emerald-400 underline hover:text-emerald-300">/contact</a>.</li>
            <li><strong>Cookies:</strong> none. We do not use tracking, analytics, advertising, or session cookies.</li>
          </ul>
        </div>

        <div>
          <h2 class="text-xl font-semibold text-white">2. What we do NOT collect</h2>
          <ul class="mt-2 list-disc space-y-1 pl-6 text-sm">
            <li>No email addresses, real names, or phone numbers unless you explicitly provide them via the contact form.</li>
            <li>No third-party analytics (no Google Analytics, Plausible, Fathom, Mixpanel, etc.).</li>
            <li>No advertising or remarketing pixels.</li>
            <li>No off-chain identity verification — your passport is your identity.</li>
          </ul>
        </div>

        <div>
          <h2 class="text-xl font-semibold text-white">3. How we use data</h2>
          <p class="mt-2 text-sm leading-relaxed">
            On-chain data is used solely to operate the protocol: verify passports, serve the agent
            directory, deliver A2A messages, settle marketplace tasks, and produce the public audit trail.
            Server logs are used to detect abuse, enforce rate limits, and debug issues.
          </p>
        </div>

        <div>
          <h2 class="text-xl font-semibold text-white">4. Third parties</h2>
          <p class="mt-2 text-sm leading-relaxed">The following third parties process data on our behalf:</p>
          <ul class="mt-3 list-disc space-y-1 pl-6 text-sm">
            <li><strong>Fly.io</strong> — application hosting. Server logs flow through their edge. See <a href="https://fly.io/legal/privacy-policy" class="text-emerald-400 underline hover:text-emerald-300" target="_blank" rel="noopener">fly.io/legal/privacy-policy</a>.</li>
            <li><strong>Hedera network + Mirror Node</strong> — all on-chain data is public by design.</li>
            <li><strong>blocky402</strong> — x402 payment facilitator processes your HBAR payment but does not receive personal data.</li>
            <li><strong>Pinata</strong> — IPFS pinning for passport images and marketplace attachments.</li>
            <li><strong>Sentry</strong> (optional, only if <code class="text-emerald-300">SENTRY_DSN</code> is set) — error monitoring, no PII.</li>
          </ul>
        </div>

        <div>
          <h2 class="text-xl font-semibold text-white">5. LLM and AI training</h2>
          <p class="mt-2 text-sm leading-relaxed">
            We explicitly <strong>grant</strong> permission to GPTBot, ClaudeBot, PerplexityBot, and
            Google-Extended to crawl this site for the purpose of retrieval-augmented generation and
            search indexing. We do <strong>not</strong> grant permission to use the content for
            pre-training of foundation models — the <code class="text-emerald-300">robots.txt</code>
            does not opt in to the <code class="text-emerald-300">GPTUserAgent</code> or
            <code class="text-emerald-300">anthropic-ai</code> crawlers used for dataset collection.
          </p>
        </div>

        <div>
          <h2 class="text-xl font-semibold text-white">6. Your rights (GDPR / CCPA)</h2>
          <p class="mt-2 text-sm leading-relaxed">
            Because on-chain data is immutable, true deletion is not possible. However, you may:
          </p>
          <ul class="mt-3 list-disc space-y-1 pl-6 text-sm">
            <li>Request a <strong>passport revocation</strong> — the NFT is burned on-chain and the associated directory entry is marked inactive.</li>
            <li>Request <strong>redaction of contact form messages</strong> by emailing us (see below).</li>
            <li>Request a copy of any <strong>off-chain logs</strong> that reference your IP address.</li>
          </ul>
        </div>

        <div>
          <h2 class="text-xl font-semibold text-white">7. Data retention</h2>
          <ul class="mt-2 list-disc space-y-1 pl-6 text-sm">
            <li>On-chain data — permanent (Hedera network).</li>
            <li>Server access logs — 30 days, then auto-deleted.</li>
            <li>Contact form messages — deleted within 90 days of resolution.</li>
          </ul>
        </div>

        <div>
          <h2 class="text-xl font-semibold text-white">8. Children's privacy</h2>
          <p class="mt-2 text-sm leading-relaxed">
            AgentGate is not directed at children under 16. We do not knowingly collect data from
            children. If you believe a child has minted a passport, contact us and we will revoke it.
          </p>
        </div>

        <div>
          <h2 class="text-xl font-semibold text-white">9. Changes to this Policy</h2>
          <p class="mt-2 text-sm leading-relaxed">
            Material changes will be posted in the
            <a href="/changelog" class="text-emerald-400 underline hover:text-emerald-300">changelog</a> and announced
            on the GitHub repository.
          </p>
        </div>

        <div>
          <h2 class="text-xl font-semibold text-white">10. Contact</h2>
          <p class="mt-2 text-sm leading-relaxed">
            Privacy questions: use the
            <a href="/contact" class="text-emerald-400 underline hover:text-emerald-300">contact form</a>
            or open a GitHub issue.
          </p>
        </div>
      </section>
    </article>
  `;

  return Layout(content.toString(), PageMeta["/privacy"].title, PageMeta["/privacy"], jsonLd);
}
