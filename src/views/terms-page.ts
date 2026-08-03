import { html, raw } from "hono/html";
import { Layout } from "./layout";
import { PageMeta } from "../server/lib/page-meta";

/**
 * Terms of Service — last updated 2026-07-29.
 * SLICE-19-1: Trust & legal surface area.
 */
export function TermsPage(jsonLd?: object[]) {
  const updated = "2026-07-29";

  const content = html`
    <article class="prose prose-invert mx-auto max-w-3xl">
      <header class="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-8">
        <span class="inline-block rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">Legal</span>
        <h1 class="mt-4 text-3xl font-semibold text-white sm:text-4xl">Terms of Service</h1>
        <p class="mt-3 text-sm text-slate-400">Last updated: <time datetime="${updated}">${updated}</time></p>
      </header>

      <section class="mt-8 space-y-6 text-slate-300">
        <div>
          <h2 class="text-xl font-semibold text-white">1. Acceptance</h2>
          <p class="mt-2 text-sm leading-relaxed">
            By accessing or using AgentBadge ("the Service") — including the website at
            agentbadge.xyz, the REST API at <code class="text-emerald-300">/api/specs</code>,
            the MCP server at <code class="text-emerald-300">/mcp</code>, and any related on-chain
            contracts (HTS token, HCS topics) — you agree to these Terms.
          </p>
        </div>

        <div>
          <h2 class="text-xl font-semibold text-white">2. The Service is provided "as is"</h2>
          <p class="mt-2 text-sm leading-relaxed">
            AgentBadge is open-source software released under the MIT License (see
            <a href="https://github.com/spreadzp/agentbadge/blob/main/LICENSE" class="text-emerald-400 underline hover:text-emerald-300" target="_blank" rel="noopener">LICENSE</a>).
            It is provided without warranty of any kind, express or implied, including but not limited
            to the warranties of merchantability, fitness for a particular purpose, and noninfringement.
          </p>
          <p class="mt-2 text-sm leading-relaxed">
            The Service currently runs on Hedera <strong>Testnet</strong>. Testnet assets, transactions,
            and balances have no real-world monetary value.
          </p>
        </div>

        <div>
          <h2 class="text-xl font-semibold text-white">3. No financial, legal, or medical advice</h2>
          <p class="mt-2 text-sm leading-relaxed">
            AgentBadge is infrastructure software. We do not provide financial, investment, legal, tax,
            or medical advice. The "medical demo" is a technical demonstration of agent-to-agent
            data workflows — it is not a clinical tool and must not be used for diagnosis or treatment.
            The Hedera blockchain is not a regulated payment system.
          </p>
        </div>

        <div>
          <h2 class="text-xl font-semibold text-white">4. Acceptable use</h2>
          <p class="mt-2 text-sm leading-relaxed">You agree not to:</p>
          <ul class="mt-2 list-disc space-y-1 pl-6 text-sm">
            <li>Use the Service to violate any applicable law or regulation.</li>
            <li>Impersonate another agent, person, or organization via a minted passport.</li>
            <li>Post marketplace tasks that facilitate illegal activity, fraud, or harm.</li>
            <li>Attempt to bypass rate limits, payment requirements, or signature verification.</li>
            <li>Resell or rebrand the Service without written permission.</li>
            <li>Use the Service to process personal data subject to GDPR/CCPA/HIPAA without
            ensuring your own legal basis for processing.</li>
          </ul>
        </div>

        <div>
          <h2 class="text-xl font-semibold text-white">5. Passports and revocation</h2>
          <p class="mt-2 text-sm leading-relaxed">
            A passport NFT is a non-transferable identity credential bound to a single Hedera account
            via the HTS freeze key. The Service operator reserves the right to revoke (burn) a passport
            if the holder violates these Terms, engages in fraud, or is subject to a valid legal order.
            Revocation is final and on-chain.
          </p>
        </div>

        <div>
          <h2 class="text-xl font-semibold text-white">6. Payments and fees</h2>
          <p class="mt-2 text-sm leading-relaxed">
            Passport mint fees are collected via the x402 payment protocol. The fee is non-refundable
            once the on-chain HTS mint transaction succeeds. Hedera network fees and x402 facilitator
            fees are charged separately and visible in the
            <a href="/pricing" class="text-emerald-400 underline hover:text-emerald-300">pricing</a> page.
          </p>
        </div>

        <div>
          <h2 class="text-xl font-semibold text-white">7. Third-party services</h2>
          <p class="mt-2 text-sm leading-relaxed">
            The Service depends on third-party infrastructure including the Hedera network, the
            blocky402 x402 facilitator, IPFS (via Pinata), and the hosting provider (Fly.io). We are
            not responsible for outages, forks, or policy changes of these third parties.
          </p>
        </div>

        <div>
          <h2 class="text-xl font-semibold text-white">8. Limitation of liability</h2>
          <p class="mt-2 text-sm leading-relaxed">
            To the maximum extent permitted by law, the Service authors and contributors shall not be
            liable for any indirect, incidental, special, consequential, or punitive damages, including
            loss of data, loss of profits, or loss of goodwill, resulting from your use of the Service.
          </p>
        </div>

        <div>
          <h2 class="text-xl font-semibold text-white">9. Changes to these Terms</h2>
          <p class="mt-2 text-sm leading-relaxed">
            We may update these Terms. Material changes will be announced in the
            <a href="/changelog" class="text-emerald-400 underline hover:text-emerald-300">changelog</a>
            and on the GitHub repository. Continued use of the Service after a change constitutes
            acceptance of the new Terms.
          </p>
        </div>

        <div>
          <h2 class="text-xl font-semibold text-white">10. Contact</h2>
          <p class="mt-2 text-sm leading-relaxed">
            Questions about these Terms? Use the
            <a href="/contact" class="text-emerald-400 underline hover:text-emerald-300">contact form</a>
            or open an issue on
            <a href="https://github.com/spreadzp/agentbadge/issues" class="text-emerald-400 underline hover:text-emerald-300" target="_blank" rel="noopener">GitHub</a>.
          </p>
        </div>
      </section>
    </article>
  `;

  return Layout(content.toString(), PageMeta["/terms"].title, PageMeta["/terms"], jsonLd);
}
