/**
 * SLICE-37-1 + 37-9: CLI entry point
 * Registers all commands, handles --help/--version, dispatches.
 */

import { runCommand } from "./router";
import { handleHelp, handleVersion } from "./help";
import { registerScanCommand } from "./commands/scan";
import { registerVerifyCommand } from "./commands/verify-report";
import { registerFixCommand } from "./commands/fix";
import { registerBadgeCommand } from "./commands/badge";
import { registerGuideCommand } from "./commands/guide";

registerScanCommand();
registerVerifyCommand();
registerFixCommand();
registerBadgeCommand();
registerGuideCommand();

async function main() {
  const argv = process.argv.slice(2);

  // Global flags
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    const result = handleHelp(argv);
    if (result.stdout) process.stdout.write(result.stdout + "\n");
    if (result.stderr) process.stderr.write(result.stderr + "\n");
    process.exit(result.exitCode);
  }

  if (argv[0] === "--version" || argv[0] === "-v") {
    const result = handleVersion();
    process.stdout.write(result.stdout + "\n");
    process.exit(result.exitCode);
  }

  // Command-specific --help
  if (argv.length >= 2 && (argv[1] === "--help" || argv[1] === "-h")) {
    const result = handleHelp([argv[0]]);
    if (result.stdout) process.stdout.write(result.stdout + "\n");
    if (result.stderr) process.stderr.write(result.stderr + "\n");
    process.exit(result.exitCode);
  }

  const result = await runCommand(argv);
  if (result.stdout) process.stdout.write(result.stdout + "\n");
  if (result.stderr) process.stderr.write(result.stderr + "\n");
  process.exit(result.exitCode);
}

if (import.meta.main) {
  main();
}
