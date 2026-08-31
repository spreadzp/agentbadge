/**
 * SLICE-37-9: --help & --version handlers
 */

import { getAllCommands } from "./router";

const VERSION = "0.3.0";

export function handleHelp(argv: string[]): { exitCode: number; stdout: string; stderr: string } {
  // Global help
  if (argv.length === 0 || (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h"))) {
    return {
      exitCode: 0,
      stdout: formatGlobalHelp(),
      stderr: "",
    };
  }

  // Command-specific help
  const commandName = argv[0];
  const commands = getAllCommands();
  const cmd = commands.find((c) => c.name === commandName);

  if (!cmd) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Unknown command: "${commandName}". Run 'agentbadge --help' for usage.`,
    };
  }

  return {
    exitCode: 0,
    stdout: formatCommandHelp(cmd),
    stderr: "",
  };
}

export function handleVersion(): { exitCode: number; stdout: string; stderr: string } {
  return {
    exitCode: 0,
    stdout: `agentbadge v${VERSION}`,
    stderr: "",
  };
}

function formatGlobalHelp(): string {
  const lines: string[] = [];
  lines.push("Usage: agentbadge <command> [options] <args>");
  lines.push("");
  lines.push("Commands:");
  lines.push("  scan <url>                Scan a URL for agent readiness");
  lines.push("  verify-report <path>      Verify report integrity and signature");
  lines.push("  fix <path>                Generate fix suggestions from a report");
  lines.push("  badge <path>              Render an SVG badge from a report");
  lines.push("");
  lines.push("Global Flags:");
  lines.push("  --help, -h                Show help");
  lines.push("  --version, -v             Show version");
  lines.push("");
  lines.push("Run 'agentbadge <command> --help' for command-specific help.");
  return lines.join("\n");
}

function formatCommandHelp(cmd: {
  name: string;
  description: string;
  args: Array<{ name: string; required?: boolean; description?: string }>;
  flags: Array<{ name: string; shortName?: string; type: string; description: string }>;
}): string {
  const lines: string[] = [];
  lines.push(`Usage: agentbadge ${cmd.name} ${cmd.args.map((a) => `<${a.name}>`).join(" ")} [options]`);
  lines.push("");
  lines.push(`  ${cmd.description}`);
  lines.push("");

  if (cmd.args.length > 0) {
    lines.push("Arguments:");
    for (const a of cmd.args) {
      const req = a.required ? " (required)" : "";
      const desc = a.description ? ` — ${a.description}` : "";
      lines.push(`  ${a.name}${req}${desc}`);
    }
    lines.push("");
  }

  if (cmd.flags.length > 0) {
    lines.push("Options:");
    for (const f of cmd.flags) {
      const short = f.shortName ? `-${f.shortName}, ` : "    ";
      lines.push(`  ${short}--${f.name}  ${f.description}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
