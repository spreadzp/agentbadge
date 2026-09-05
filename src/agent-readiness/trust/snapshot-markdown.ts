/**
 * SLICE-102-7: Markdown renderer for Trust Snapshot.
 *
 * Renders a human-readable markdown representation of a TrustSnapshot.
 */

import type { TrustSnapshot } from "./trust-schema";

/**
 * Render a TrustSnapshot as human-readable markdown.
 */
export function renderSnapshotMarkdown(snapshot: TrustSnapshot): string {
  const lines: string[] = [];

  lines.push(`# Trust Snapshot: ${snapshot.domain}`);
  lines.push("");
  lines.push(`**Snapshot Version:** ${snapshot.snapshot_version}`);
  lines.push(`**Spec Version:** ${snapshot.spec_version}`);
  lines.push(`**Generated At:** ${snapshot.generated_at}`);
  lines.push("");

  // Profile reference
  lines.push("## Profile Reference");
  lines.push("");
  lines.push(`- **Version:** ${snapshot.profile_ref.profile_version}`);
  lines.push(`- **Hash:** \`${snapshot.profile_ref.profile_hash}\``);
  lines.push(`- **Endpoint:** ${snapshot.profile_ref.endpoint}`);
  lines.push("");

  // Evidence root
  lines.push("## Evidence Root");
  lines.push("");
  lines.push(`- **Assertions:** ${snapshot.evidence_root.assertion_count}`);
  lines.push(`- **Merkle Root:** \`${snapshot.evidence_root.merkle_root}\``);
  lines.push(`- **Computed At:** ${snapshot.evidence_root.computed_at}`);
  if (snapshot.evidence_root.evidence_hashes.length > 0) {
    lines.push("- **Evidence Hashes:**");
    for (const hash of snapshot.evidence_root.evidence_hashes) {
      lines.push(`  - \`${hash}\``);
    }
  }
  lines.push("");

  // Score summary
  lines.push("## Score Summary");
  lines.push("");
  lines.push(`- **Total Score:** ${snapshot.score_summary.total}`);
  lines.push(`- **Grade:** ${snapshot.score_summary.grade}`);
  lines.push(`- **Verified Rules:** ${snapshot.score_summary.verified_rules}/${snapshot.score_summary.total_rules}`);
  lines.push(`- **Gaps:** ${snapshot.score_summary.gaps}`);
  lines.push(`- **Conflicts:** ${snapshot.score_summary.conflicts}`);
  lines.push("");

  // Domain ownership
  lines.push("## Domain Ownership");
  lines.push("");
  lines.push(`- **Method:** ${snapshot.domain_ownership.method}`);
  lines.push(`- **Verified:** ${snapshot.domain_ownership.verified ? "Yes" : "No"}`);
  if (snapshot.domain_ownership.verified_at) {
    lines.push(`- **Verified At:** ${snapshot.domain_ownership.verified_at}`);
  }
  lines.push(`- **Challenge Token:** \`${snapshot.domain_ownership.challenge_token}\``);
  lines.push(`- **Proof:** \`${snapshot.domain_ownership.proof}\``);
  lines.push("");

  // Integrity
  lines.push("## Integrity");
  lines.push("");
  lines.push(`- **Snapshot Hash:** \`${snapshot.integrity.snapshot_hash}\``);
  lines.push(`- **Algorithm:** ${snapshot.integrity.signature_algorithm}`);
  lines.push(`- **Public Key:** \`${snapshot.integrity.public_key}\``);
  lines.push(`- **Key ID:** ${snapshot.integrity.key_id}`);
  lines.push("");

  // On-chain attestation
  if (snapshot.on_chain) {
    lines.push("## On-Chain Attestation");
    lines.push("");
    lines.push(`- **Chain:** ${snapshot.on_chain.chain} (ID: ${snapshot.on_chain.chain_id})`);
    lines.push(`- **Contract:** \`${snapshot.on_chain.contract_address}\``);
    lines.push(`- **Token ID:** ${snapshot.on_chain.token_id}`);
    lines.push(`- **Attested At:** ${snapshot.on_chain.attested_at}`);
    lines.push(`- **Attested By:** \`${snapshot.on_chain.attested_by}\``);
    lines.push(`- **Tx Hash:** \`${snapshot.on_chain.tx_hash}\``);
    lines.push(`- **Revoked:** ${snapshot.on_chain.revoked ? "Yes" : "No"}`);
    lines.push("");
  } else {
    lines.push("## On-Chain Attestation");
    lines.push("");
    lines.push("*Not yet attested on-chain.*");
    lines.push("");
  }

  // Verification status
  lines.push("## Verification");
  lines.push("");
  lines.push("To verify this snapshot:");
  lines.push("1. Recompute the hash from the snapshot data (excluding signature and on_chain)");
  lines.push("2. Verify the Ed25519 signature against the AgentBadge public key");
  lines.push("3. Check on-chain attestation status");
  lines.push("4. Verify freshness (generated within the last 30 days)");
  lines.push("");

  return lines.join("\n");
}
