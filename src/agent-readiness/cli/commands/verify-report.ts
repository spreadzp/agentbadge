/**
 * SLICE-37-4: `agentbadge verify-report` — Offline Verification Command
 * SLICE-37-5: Verify Output Formatter — Checkmarks & Detail
 */

import { readFile } from "node:fs/promises";
import {
  registerCommand,
  type ParsedArgs,
  type ParsedFlags,
} from "../router";
import { verifyReport, type VerifyResult, type VerifyCheck } from "../../integrity/verifier";
import { loadPublicKey } from "../../integrity/key-manager";

export function registerVerifyCommand(): void {
  registerCommand({
    name: "verify-report",
    description: "Verify the integrity and signature of an agent readiness report",
    args: [{ name: "report-path", required: true, description: "Path to the report JSON file" }],
    flags: [
      { name: "public-key", shortName: "k", type: "string", description: "Path to public key file (JSON)" },
      { name: "json", shortName: "j", type: "boolean", description: "Output verification result as JSON" },
    ],
    handler: verifyHandler,
  });
}

async function verifyHandler(args: ParsedArgs, flags: ParsedFlags) {
  const reportPath = args.positional[0];
  if (!reportPath) {
    return { exitCode: 1, stdout: "", stderr: "Missing required argument: report-path" };
  }

  const publicKeyPath = typeof flags["public-key"] === "string" ? flags["public-key"] : null;
  const jsonOutput = flags.json === true;

  try {
    const reportJson = await readFile(reportPath, "utf-8");

    if (!publicKeyPath) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "Error: --public-key flag is required. Provide path to the public key JSON file.",
      };
    }

    const pubKeyEntry = await loadPublicKey(publicKeyPath);
    const result = verifyReport(reportJson, pubKeyEntry.publicKey);

    if (jsonOutput) {
      return {
        exitCode: result.verified ? 0 : 1,
        stdout: JSON.stringify(result, null, 2),
        stderr: "",
      };
    }

    return {
      exitCode: result.verified ? 0 : 1,
      stdout: formatVerifyOutput(result, reportPath),
      stderr: result.verified ? "" : `Verification failed: ${(result as any).reason}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: "", stderr: `Error: ${msg}` };
  }
}

function formatVerifyOutput(result: VerifyResult, reportPath: string): string {
  const lines: string[] = [];
  lines.push("═".repeat(60));
  lines.push("  AgentBadge Report Verification");
  lines.push("═".repeat(60));
  lines.push(`  File: ${reportPath}`);
  lines.push("");

  lines.push("─".repeat(60));
  lines.push("  Checks");
  lines.push("─".repeat(60));

  for (const check of result.checks) {
    const mark = check.passed ? "✓" : "✗";
    lines.push(`  ${mark} ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
  }

  lines.push("");
  lines.push("─".repeat(60));

  if (result.verified) {
    lines.push("  Result: ✓ VERIFIED — Report integrity and signature are valid");
  } else {
    const reason = (result as any).reason as string;
    lines.push(`  Result: ✗ FAILED — ${reason}`);
  }

  lines.push("═".repeat(60));
  return lines.join("\n");
}
