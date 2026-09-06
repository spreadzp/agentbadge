/**
 * SLICE-102-8: CLI `trust` command.
 *
 * agentbadge trust --url <url> [--verify] [--json] [--markdown]
 * agentbadge trust --url <url> --attest --tier <tier> --account <id> --signature <sig>
 * agentbadge trust --url <url> --challenge
 * agentbadge trust --snapshot <file> [--verify] [--json]
 *
 * Exit codes: 0 = success, 1 = error, 2 = verification failed
 */

import { registerCommand, type CommandResult, type ParsedArgs, type ParsedFlags } from "../router";
import { verifySnapshot, type VerificationResult } from "../../trust/snapshot-verifier";
import { renderSnapshotMarkdown } from "../../trust/snapshot-markdown";
import {
  fetchTrustSnapshot,
  fetchTrustSnapshotMarkdown,
  attestTrustSnapshot,
  generateChallenge,
} from "../../trust/trust-api-client";
import type { TrustSnapshot } from "../../trust/trust-schema";
import * as fs from "fs";

const TRUST_FLAGS = [
  { name: "url", shortName: "u", type: "string" as const, description: "Target domain URL (e.g. api.example.com)" },
  { name: "snapshot", shortName: "s", type: "string" as const, description: "Path to local snapshot JSON file" },
  { name: "verify", shortName: "v", type: "boolean" as const, description: "Verify the snapshot" },
  { name: "attest", shortName: "a", type: "boolean" as const, description: "Trigger on-chain attestation" },
  { name: "challenge", shortName: "c", type: "boolean" as const, description: "Generate domain ownership challenge" },
  { name: "tier", shortName: "t", type: "string" as const, description: "Attestation tier: bronze|silver|gold|platinum" },
  { name: "account", shortName: "A", type: "string" as const, description: "Account ID for attestation" },
  { name: "signature", shortName: "S", type: "string" as const, description: "Wallet signature for attestation" },
  { name: "json", shortName: "j", type: "boolean" as const, description: "Output as JSON" },
  { name: "markdown", shortName: "m", type: "boolean" as const, description: "Output snapshot as markdown" },
  { name: "api-url", type: "string" as const, description: "AgentBadge API URL (default: https://agentbadge.xyz)" },
  { name: "public-key", shortName: "k", type: "string" as const, description: "AgentBadge signing public key (base64) for offline verification" },
];

export function registerTrustCommand(): void {
  registerCommand({
    name: "trust",
    description: "Fetch, verify, and attest trust snapshots\n\nExit codes: 0=success, 1=error, 2=verification failed",
    args: [],
    flags: TRUST_FLAGS,
    handler: trustHandler,
  });
}

async function trustHandler(_args: ParsedArgs, flags: ParsedFlags): Promise<CommandResult> {
  const url = typeof flags.url === "string" ? flags.url : undefined;
  const snapshotPath = typeof flags.snapshot === "string" ? flags.snapshot : undefined;
  const verify = flags.verify === true;
  const attest = flags.attest === true;
  const challenge = flags.challenge === true;
  const asJson = flags.json === true;
  const asMarkdown = flags.markdown === true;
  const apiUrl = typeof flags["api-url"] === "string" ? flags["api-url"] : undefined;
  const publicKey = typeof flags["public-key"] === "string" ? flags["public-key"] : undefined;

  if (!url && !snapshotPath) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Error: either --url or --snapshot is required.\nUsage: agentbadge trust --url <url> [--verify] [--json] [--markdown]\n       agentbadge trust --snapshot <file> [--verify] [--json]\n       agentbadge trust --url <url> --attest --tier <tier> --account <id> --signature <sig>\n       agentbadge trust --url <url> --challenge",
    };
  }

  // --challenge mode
  if (challenge && url) {
    try {
      const result = await generateChallenge(url, apiUrl);
      if (asJson) {
        return { exitCode: 0, stdout: JSON.stringify(result, null, 2), stderr: "" };
      }
      return {
        exitCode: 0,
        stdout: `Challenge generated for ${url}\n  Token: ${result.token}\n  DNS:   ${result.dns_record}\n  URL:   ${result.well_known_url}\n  Expires: ${result.expires_at}`,
        stderr: "",
      };
    } catch (err) {
      return { exitCode: 1, stdout: "", stderr: `Error: ${(err as Error).message}` };
    }
  }

  // --attest mode
  if (attest && url) {
    const tier = typeof flags.tier === "string" ? flags.tier : undefined;
    const account = typeof flags.account === "string" ? flags.account : undefined;
    const signature = typeof flags.signature === "string" ? flags.signature : undefined;

    if (!tier || !account || !signature) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "Error: --attest requires --tier, --account, and --signature flags.",
      };
    }

    try {
      const snapshot = await attestTrustSnapshot(url, { accountId: account, signature, tier }, apiUrl);
      if (asJson) {
        return { exitCode: 0, stdout: JSON.stringify(snapshot, null, 2), stderr: "" };
      }
      return {
        exitCode: 0,
        stdout: `Attestation submitted for ${url}\n  Token ID: ${snapshot.on_chain?.token_id ?? "N/A"}\n  Chain: ${snapshot.on_chain?.chain ?? "N/A"}\n  Tx Hash: ${snapshot.on_chain?.tx_hash ?? "N/A"}\n  Attested At: ${snapshot.on_chain?.attested_at ?? "N/A"}`,
        stderr: "",
      };
    } catch (err) {
      return { exitCode: 1, stdout: "", stderr: `Error: ${(err as Error).message}` };
    }
  }

  // --snapshot <file> mode (local verification)
  if (snapshotPath) {
    let snapshot: TrustSnapshot;
    try {
      const raw = fs.readFileSync(snapshotPath, "utf-8");
      snapshot = JSON.parse(raw);
    } catch (err) {
      return { exitCode: 1, stdout: "", stderr: `Error reading snapshot file: ${(err as Error).message}` };
    }

    if (verify || !url) {
      const result = await verifySnapshot(snapshot, { skipOnChain: true, agentBadgePublicKey: publicKey });
      if (result.valid) {
        if (asJson) {
          return { exitCode: 0, stdout: JSON.stringify(result, null, 2), stderr: "" };
        }
        if (asMarkdown) {
          return { exitCode: 0, stdout: renderSnapshotMarkdown(snapshot), stderr: "" };
        }
        return { exitCode: 0, stdout: formatVerificationResult(result), stderr: "" };
      } else {
        if (asJson) {
          return { exitCode: 2, stdout: JSON.stringify(result, null, 2), stderr: "" };
        }
        return { exitCode: 2, stdout: "", stderr: `Verification failed: ${result.reason}` };
      }
    }

    // Just output the snapshot
    if (asMarkdown) {
      return { exitCode: 0, stdout: renderSnapshotMarkdown(snapshot), stderr: "" };
    }
    return { exitCode: 0, stdout: JSON.stringify(snapshot, null, 2), stderr: "" };
  }

  // --url mode (fetch from API)
  if (url) {
    try {
      if (asMarkdown) {
        const md = await fetchTrustSnapshotMarkdown(url, apiUrl);
        return { exitCode: 0, stdout: md, stderr: "" };
      }

      const snapshot = await fetchTrustSnapshot(url, apiUrl);

      if (verify) {
        const result = await verifySnapshot(snapshot, { skipOnChain: true, agentBadgePublicKey: publicKey });
        if (result.valid) {
          if (asJson) {
            return { exitCode: 0, stdout: JSON.stringify({ snapshot, verification: result }, null, 2), stderr: "" };
          }
          return { exitCode: 0, stdout: formatVerificationResult(result), stderr: "" };
        } else {
          if (asJson) {
            return { exitCode: 2, stdout: JSON.stringify({ snapshot, verification: result }, null, 2), stderr: "" };
          }
          return { exitCode: 2, stdout: "", stderr: `Verification failed: ${result.reason}` };
        }
      }

      if (asJson) {
        return { exitCode: 0, stdout: JSON.stringify(snapshot, null, 2), stderr: "" };
      }

      return {
        exitCode: 0,
        stdout: `Trust snapshot for ${url}\n  Version: ${snapshot.snapshot_version}\n  Domain: ${snapshot.domain}\n  Generated: ${snapshot.generated_at}\n  Hash: ${snapshot.integrity.snapshot_hash}\n  Score: ${snapshot.score_summary.total}/100 (${snapshot.score_summary.grade})\n  On-chain: ${snapshot.on_chain ? "Yes" : "No"}`,
        stderr: "",
      };
    } catch (err) {
      return { exitCode: 1, stdout: "", stderr: `Error: ${(err as Error).message}` };
    }
  }

  return { exitCode: 1, stdout: "", stderr: "Error: no action specified. Use --verify, --attest, --challenge, or --snapshot." };
}

function formatVerificationResult(result: VerificationResult): string {
  const lines: string[] = [];
  lines.push("Trust Snapshot Verification");
  lines.push("═".repeat(40));
  lines.push("");
  for (const check of result.checks) {
    const status = check.passed ? "✓" : "✗";
    lines.push(`  ${status} ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
  }
  lines.push("");
  lines.push(`Result: ${result.valid ? "VERIFIED" : "FAILED"}${result.reason ? ` — ${result.reason}` : ""}`);
  return lines.join("\n");
}
