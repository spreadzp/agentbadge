/**
 * SLICE-102-9: Trust Viewer — HTML page rendering a TrustSnapshot.
 */

import { html } from "hono/html";
import { LandingLayout } from "./landing/layout";
import type { TrustSnapshot } from "../agent-readiness/trust/trust-schema";
import type { VerificationResult } from "../agent-readiness/trust/snapshot-verifier";
import { BASE_URL } from "../server/lib/page-meta";

export function TrustViewer(
  snapshot: TrustSnapshot,
  verificationResult?: VerificationResult,
): ReturnType<typeof html> {
  const domain = snapshot.domain;
  const isVerified = verificationResult?.valid ?? false;
  const isExpired = verificationResult != null && !verificationResult.valid;

  return LandingLayout(
    renderTrustContent(snapshot, isVerified, isExpired, verificationResult),
    `Trust Snapshot: ${domain}`,
    {
      title: `Trust Snapshot: ${domain}`,
      description: `AgentBadge trust verification for ${domain}`,
      path: `/trust/${domain}`,
    },
  );
}

export function TrustViewerNotFound(domain: string): ReturnType<typeof html> {
  return LandingLayout(
    renderNotFoundContent(domain),
    `Trust: ${domain} — Not Verified`,
    {
      title: `Trust: ${domain} — Not Verified`,
      description: `${domain} is not verified yet. Start domain ownership verification.`,
      path: `/trust/${domain}`,
    },
  );
}

export function TrustViewerError(domain: string, errorMsg: string): ReturnType<typeof html> {
  return LandingLayout(
    renderErrorContent(domain, errorMsg),
    `Trust: ${domain} — Error`,
    {
      title: `Trust: ${domain} — Error`,
      description: `Error loading trust snapshot for ${domain}`,
      path: `/trust/${domain}`,
    },
  );
}

function renderTrustContent(
  snapshot: TrustSnapshot,
  isVerified: boolean,
  isExpired: boolean,
  verificationResult?: VerificationResult,
): string {
  const domain = snapshot.domain;
  const badgeClass = isVerified ? "bg-green-100 text-green-800 border-green-300" : isExpired ? "bg-red-100 text-red-800 border-red-300" : "bg-yellow-100 text-yellow-800 border-yellow-300";
  const badgeText = isVerified ? "Verified" : isExpired ? "Verification Failed" : "Unverified";
  const sections: string[] = [];

  // Header
  sections.push(`
    <div class="mx-auto max-w-4xl px-4 py-8">
      <div class="flex items-center gap-4 mb-6">
        <h1 class="text-3xl font-bold">${domain}</h1>
        <span class="inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${badgeClass}">
          ${badgeText}
        </span>
      </div>
  `);

  // Verification checks
  if (verificationResult) {
    sections.push(`
      <div class="mb-6 rounded-lg border border-gray-200 p-4">
        <h2 class="text-lg font-semibold mb-3">Verification Checks</h2>
        <ul class="space-y-1">
          ${verificationResult.checks.map((check) => `
            <li class="flex items-center gap-2">
              <span class="${check.passed ? "text-green-600" : "text-red-600"}">${check.passed ? "✓" : "✗"}</span>
              <span class="font-medium">${check.name}</span>
              ${check.detail ? `<span class="text-gray-500 text-sm">— ${check.detail}</span>` : ""}
            </li>
          `).join("")}
        </ul>
      </div>
    `);
  }

  // Score summary
  sections.push(`
    <div class="mb-6 rounded-lg border border-gray-200 p-4">
      <h2 class="text-lg font-semibold mb-3">Score Summary</h2>
      <div class="flex items-center gap-6">
        <div class="text-4xl font-bold">${snapshot.score_summary.total}</div>
        <div>
          <div class="text-lg font-medium">Grade: ${snapshot.score_summary.grade}</div>
          <div class="text-sm text-gray-600">
            ${snapshot.score_summary.verified_rules}/${snapshot.score_summary.total_rules} rules verified
          </div>
          <div class="text-sm text-gray-600">
            Gaps: ${snapshot.score_summary.gaps} · Conflicts: ${snapshot.score_summary.conflicts}
          </div>
        </div>
      </div>
    </div>
  `);

  // Domain ownership
  if (snapshot.domain_ownership) {
    const ownership = snapshot.domain_ownership;
    const method = ownership.method === "dns_txt" ? "DNS TXT Record" : "Well-Known File";
    sections.push(`
      <div class="mb-6 rounded-lg border border-gray-200 p-4">
        <h2 class="text-lg font-semibold mb-3">Domain Ownership</h2>
        <dl class="grid grid-cols-2 gap-2 text-sm">
          <dt class="font-medium text-gray-600">Method</dt>
          <dd>${method}</dd>
          <dt class="font-medium text-gray-600">Verified At</dt>
          <dd>${ownership.verified_at ?? "N/A"}</dd>
        </dl>
      </div>
    `);
  }

  // On-chain attestation
  if (snapshot.on_chain) {
    const onChain = snapshot.on_chain;
    const explorerLink = onChain.chain === "hedera"
      ? `https://hashscan.io/testnet/transaction/${onChain.tx_hash}`
      : `https://sepolia.basescan.org/tx/${onChain.tx_hash}`;
    sections.push(`
      <div class="mb-6 rounded-lg border border-gray-200 p-4">
        <h2 class="text-lg font-semibold mb-3">On-Chain Attestation</h2>
        <dl class="grid grid-cols-2 gap-2 text-sm">
          <dt class="font-medium text-gray-600">Chain</dt>
          <dd>${onChain.chain ?? "N/A"}</dd>
          <dt class="font-medium text-gray-600">Contract</dt>
          <dd class="font-mono text-xs">${onChain.contract_address ?? "N/A"}</dd>
          <dt class="font-medium text-gray-600">Token ID</dt>
          <dd>${onChain.token_id ?? "N/A"}</dd>
          <dt class="font-medium text-gray-600">Tx Hash</dt>
          <dd><a href="${explorerLink}" target="_blank" rel="noopener" class="text-blue-600 hover:underline font-mono text-xs">${onChain.tx_hash ?? "N/A"}</a></dd>
          <dt class="font-medium text-gray-600">Attested At</dt>
          <dd>${onChain.attested_at ?? "N/A"}</dd>
        </dl>
      </div>
    `);
  } else {
    sections.push(`
      <div class="mb-6 rounded-lg border border-gray-200 p-4">
        <h2 class="text-lg font-semibold mb-3">On-Chain Attestation</h2>
        <p class="text-gray-500">Not yet attested on-chain.</p>
      </div>
    `);
  }

  // Integrity
  sections.push(`
    <div class="mb-6 rounded-lg border border-gray-200 p-4">
      <h2 class="text-lg font-semibold mb-3">Integrity</h2>
      <dl class="grid grid-cols-2 gap-2 text-sm">
        <dt class="font-medium text-gray-600">Snapshot Hash</dt>
        <dd class="font-mono text-xs">${snapshot.integrity.snapshot_hash}</dd>
        <dt class="font-medium text-gray-600">Algorithm</dt>
        <dd>${snapshot.integrity.signature_algorithm}</dd>
        <dt class="font-medium text-gray-600">Key ID</dt>
        <dd>${snapshot.integrity.key_id ?? "N/A"}</dd>
      </dl>
    </div>
  `);

  // Links
  sections.push(`
    <div class="flex gap-4 mt-6">
      <a href="/profile/${domain}" class="text-blue-600 hover:underline">View Profile</a>
      <a href="/api/trust/${domain}" class="text-blue-600 hover:underline">Download JSON</a>
      <a href="/api/trust/${domain}?format=markdown" class="text-blue-600 hover:underline">View Markdown</a>
    </div>
  `);

  sections.push("</div>");
  return sections.join("\n");
}

function renderNotFoundContent(domain: string): string {
  return `
    <div class="mx-auto max-w-4xl px-4 py-8">
      <div class="flex items-center gap-4 mb-6">
        <h1 class="text-3xl font-bold">${domain}</h1>
        <span class="inline-flex items-center rounded-full border border-red-300 bg-red-100 text-red-800 px-3 py-1 text-sm font-medium">
          Not Verified
        </span>
      </div>
      <div class="rounded-lg border border-gray-200 p-6 mb-6">
        <h2 class="text-lg font-semibold mb-3">This domain has not been verified yet</h2>
        <p class="text-gray-600 mb-4">To establish trust, verify domain ownership by completing a DNS TXT challenge or placing a well-known file.</p>
        <ol class="list-decimal list-inside space-y-2 text-sm text-gray-700">
          <li>Generate a challenge token: <code class="bg-gray-100 px-1 rounded">curl https://${BASE_URL}/api/trust/${domain}/challenge</code></li>
          <li>Add the DNS TXT record or place the well-known file on your server.</li>
          <li>Verify ownership: <code class="bg-gray-100 px-1 rounded">curl -X POST https://${BASE_URL}/api/trust/${domain}/verify-ownership -d '{"{"}token":"<token>{"}"}'</code></li>
        </ol>
      </div>
      <a href="/api/trust/${domain}/challenge" class="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
        Generate Challenge
      </a>
    </div>
  `;
}

function renderErrorContent(domain: string, errorMsg: string): string {
  return `
    <div class="mx-auto max-w-4xl px-4 py-8">
      <div class="flex items-center gap-4 mb-6">
        <h1 class="text-3xl font-bold">${domain}</h1>
        <span class="inline-flex items-center rounded-full border border-yellow-300 bg-yellow-100 text-yellow-800 px-3 py-1 text-sm font-medium">
          Error
        </span>
      </div>
      <div class="rounded-lg border border-gray-200 p-6">
        <h2 class="text-lg font-semibold mb-3">Error loading trust snapshot</h2>
        <p class="text-gray-600 text-sm font-mono">${errorMsg}</p>
      </div>
    </div>
  `;
}
