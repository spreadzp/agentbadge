/**
 * Hermes interactive REPL — natural-language command dispatch.
 *
 * The user types text instructions in the terminal; Hermes parses them
 * and calls the appropriate MCP tool via HTTP transport.
 *
 * Supported commands:
 *   "find agents with <capability>"  → find_agents
 *   "verify my passport"             → verify_passport
 *   "show my passport"               → get_passport
 *   "list passports"                 → list_passports
 *   "upgrade to <tier>"              → upgrade_tier
 *   "audit trail"                    → get_audit_trail
 *   "catalog" / "tiers"              → get_tier_requirements
 *   "show my card"                   → print local AgentCard
 *   "write <filename>"               → save last result to Markdown file
 *   "help"                           → list commands
 *   "exit" / "quit"                  → stop
 *
 * Reference: SLICE-4-4, hackathon-flow.md:239-352 (demo script)
 */

import { callMcpTool, extractMcpResult, type PassportResult } from "./hermes";
import type { AgentCard } from "./agent-card";

/** State carried across REPL iterations. */
export interface ReplState {
  serverUrl: string;
  passport: PassportResult | null;
  card: AgentCard | null;
  agentName: string;
  accountId: string;
  lastResult: unknown;
}

/** Parsed command from natural-language input. */
export interface ParsedCommand {
  action: string;
  args: Record<string, unknown>;
}

/** Known capabilities for parsing. */
const CAPABILITIES = ["api_call", "payment", "data_provide", "data_consume", "orchestration"];

/** Parse natural-language input into a structured command. */
export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim().toLowerCase();

  if (trimmed === "help" || trimmed === "?") {
    return { action: "help", args: {} };
  }

  if (trimmed === "exit" || trimmed === "quit") {
    return { action: "exit", args: {} };
  }

  if (trimmed === "show my card" || trimmed === "agent card") {
    return { action: "show_card", args: {} };
  }

  if (trimmed === "catalog" || trimmed === "tiers" || trimmed === "pricing") {
    return { action: "get_tier_requirements", args: {} };
  }

  if (trimmed === "list passports" || trimmed === "all passports") {
    return { action: "list_passports", args: {} };
  }

  if (trimmed === "verify my passport" || trimmed === "verify passport") {
    return { action: "verify_passport", args: {} };
  }

  if (trimmed === "show my passport" || trimmed === "my passport") {
    return { action: "get_passport", args: {} };
  }

  if (trimmed === "audit trail" || trimmed === "audit") {
    return { action: "get_audit_trail", args: {} };
  }

  // find agents with <capability>
  const findMatch = trimmed.match(/^find\s+agents?\s+(?:with\s+)?(?:capability\s+)?([\w_]+)/);
  if (findMatch) {
    const cap = findMatch[1];
    if (CAPABILITIES.includes(cap)) {
      return { action: "find_agents", args: { capability: cap } };
    }
    return { action: "find_agents", args: {} };
  }

  // upgrade to <tier>
  const upgradeMatch = trimmed.match(/^upgrade\s+to\s+(\w+)/);
  if (upgradeMatch) {
    const tier = upgradeMatch[1];
    const validTiers = ["bronze", "silver", "gold", "platinum"];
    if (!validTiers.includes(tier)) {
      return {
        action: "error",
        args: { message: `Invalid tier: ${tier}. Use: ${validTiers.join(", ")}` },
      };
    }
    return { action: "upgrade_tier", args: { newTier: tier } };
  }

  // write <filename>
  const writeMatch = trimmed.match(/^write\s+([\w./-]+\.md)$/);
  if (writeMatch) {
    return { action: "write_file", args: { filename: writeMatch[1] } };
  }

  return { action: "unknown", args: { input: trimmed } };
}

/** Format any MCP result as Markdown text. */
export function formatResultAsMarkdown(action: string, result: unknown): string {
  if (result === null || result === undefined) {
    return "_No result_";
  }

  const json = JSON.stringify(result, null, 2);

  switch (action) {
    case "find_agents":
      return formatAgentsTable(result);
    case "get_tier_requirements":
      return formatCatalog(result);
    case "get_audit_trail":
      return formatAuditTrail(result);
    case "verify_passport":
    case "get_passport":
      return formatPassportInfo(result);
    case "list_passports":
      return formatPassportList(result);
    case "upgrade_tier":
      return `## Tier Upgrade\n\n\`\`\`json\n${json}\n\`\`\``;
    default:
      return `## Result\n\n\`\`\`json\n${json}\n\`\`\``;
  }
}

function formatAgentsTable(result: unknown): string {
  const agents = result as Array<Record<string, unknown>>;
  if (!Array.isArray(agents)) {
    return `## Agent Search\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
  }
  if (agents.length === 0) {
    return "## Agent Search\n\n_No agents found._";
  }
  const rows = agents
    .map(
      (a) =>
        `| ${a.name ?? "—"} | ${a.did ?? "—"} | ${(a.capabilities as string[])?.join(", ") ?? "—"} | ${a.status ?? "—"} |`,
    )
    .join("\n");
  return `## Agent Search\n\n| Name | DID | Capabilities | Status |\n|------|-----|--------------|--------|\n${rows}`;
}

function formatCatalog(result: unknown): string {
  const data = result as { tiers?: Array<Record<string, unknown>> };
  if (!data?.tiers) {
    return `## Tier Catalog\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
  }
  const rows = data.tiers
    .map(
      (t) =>
        `| ${t.tier ?? "—"} | ${t.priceHbar ?? "—"} HBAR | ${(t.capabilities as string[])?.join(", ") ?? "—"} |`,
    )
    .join("\n");
  return `## Tier Catalog\n\n| Tier | Price | Capabilities |\n|------|-------|--------------|\n${rows}`;
}

function formatAuditTrail(result: unknown): string {
  const data = result as { events?: Array<Record<string, unknown>> };
  if (!data?.events) {
    return `## Audit Trail\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
  }
  if (data.events.length === 0) {
    return "## Audit Trail\n\n_No events found._";
  }
  const rows = data.events
    .map(
      (e) =>
        `| ${e.type ?? "—"} | ${e.did ?? "—"} | ${e.timestamp ?? "—"} | ${e.tier ?? e.newTier ?? "—"} |`,
    )
    .join("\n");
  return `## Audit Trail\n\n| Type | DID | Timestamp | Tier |\n|------|-----|-----------|------|\n${rows}`;
}

function formatPassportInfo(result: unknown): string {
  const p = result as Record<string, unknown>;
  return `## Passport Info\n\n- **DID:** ${p.did ?? "—"}\n- **Tier:** ${p.tier ?? "—"}\n- **Owner:** ${p.accountId ?? "—"}\n- **Token:** ${p.tokenId ?? "—"}\n- **Serial:** ${p.serial ?? "—"}\n- **Capabilities:** ${(p.capabilities as string[])?.join(", ") ?? "—"}\n- **Endpoint:** ${p.endpoint ?? "—"}`;
}

function formatPassportList(result: unknown): string {
  const list = result as Array<Record<string, unknown>>;
  if (!Array.isArray(list)) {
    return `## All Passports\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
  }
  if (list.length === 0) {
    return "## All Passports\n\n_No passports issued yet._";
  }
  const rows = list
    .map((p) => `| ${p.did ?? "—"} | ${p.tier ?? "—"} | ${p.accountId ?? "—"} |`)
    .join("\n");
  return `## All Passports\n\n| DID | Tier | Owner |\n|-----|------|-------|\n${rows}`;
}

/** Write result to a Markdown file. */
export function writeToMarkdown(filename: string, content: string): void {
  const header = `<!-- Generated by Hermes Demo Agent — ${new Date().toISOString()} -->\n\n`;
  Bun.write(filename, header + content);
}

/** Execute a parsed command against the MCP server. */
export async function executeCommand(cmd: ParsedCommand, state: ReplState): Promise<string> {
  switch (cmd.action) {
    case "help":
      return helpText();

    case "exit":
      return "exit";

    case "show_card":
      if (!state.card) return "⚠️  No AgentCard yet. Run --register first.";
      return formatResultAsMarkdown("show_card", state.card);

    case "get_tier_requirements": {
      const resp = await callMcpTool(state.serverUrl, "get_tier_requirements", {});
      const result = extractMcpResult(resp);
      state.lastResult = result;
      return formatResultAsMarkdown(cmd.action, result);
    }

    case "list_passports": {
      const resp = await callMcpTool(state.serverUrl, "list_passports", {});
      const result = extractMcpResult(resp);
      state.lastResult = result;
      return formatResultAsMarkdown(cmd.action, result);
    }

    case "verify_passport": {
      if (!state.passport) return "⚠️  No passport yet. Run --register first.";
      const resp = await callMcpTool(state.serverUrl, "verify_passport", {
        tokenId: state.passport.tokenId,
        serial: state.passport.serialNumber,
      });
      const result = extractMcpResult(resp);
      state.lastResult = result;
      return formatResultAsMarkdown(cmd.action, result);
    }

    case "get_passport": {
      if (!state.passport) return "⚠️  No passport yet. Run --register first.";
      const resp = await callMcpTool(state.serverUrl, "get_passport", {
        tokenId: state.passport.tokenId,
        serial: state.passport.serialNumber,
      });
      const result = extractMcpResult(resp);
      state.lastResult = result;
      return formatResultAsMarkdown(cmd.action, result);
    }

    case "find_agents": {
      const resp = await callMcpTool(state.serverUrl, "find_agents", cmd.args);
      const result = extractMcpResult(resp);
      state.lastResult = result;
      return formatResultAsMarkdown(cmd.action, result);
    }

    case "get_audit_trail": {
      const resp = await callMcpTool(state.serverUrl, "get_audit_trail", {});
      const result = extractMcpResult(resp);
      state.lastResult = result;
      return formatResultAsMarkdown(cmd.action, result);
    }

    case "upgrade_tier": {
      if (!state.passport) return "⚠️  No passport yet. Run --register first.";
      const resp = await callMcpTool(state.serverUrl, "upgrade_tier", {
        tokenId: state.passport.tokenId,
        serial: state.passport.serialNumber,
        newTier: cmd.args.newTier,
      });
      const result = extractMcpResult(resp);
      state.lastResult = result;
      return formatResultAsMarkdown(cmd.action, result);
    }

    case "write_file": {
      const filename = cmd.args.filename as string;
      if (!state.lastResult) {
        return "⚠️  No previous result to write. Run a command first.";
      }
      const md = formatResultAsMarkdown("write", state.lastResult);
      writeToMarkdown(filename, md);
      return `✅ Written to ${filename}`;
    }

    case "error":
      return `❌ ${cmd.args.message}`;

    case "unknown":
      return `❓ Unknown command: "${cmd.args.input}". Type "help" for available commands.`;

    default:
      return `❓ Unknown action: ${cmd.action}`;
  }
}

function helpText(): string {
  return `## Hermes Commands

| Command | Description |
|---------|-------------|
| \`find agents with <capability>\` | Search HCS directory (e.g. data_provide) |
| \`verify my passport\` | Check passport on-chain status |
| \`show my passport\` | Get passport metadata |
| \`list passports\` | List all issued passports |
| \`upgrade to <tier>\` | Upgrade tier (bronze/silver/gold/platinum) |
| \`audit trail\` | Get HCS audit events |
| \`catalog\` / \`tiers\` | Show tier pricing & capabilities |
| \`show my card\` | Print local AgentCard |
| \`write results.md\` | Save last result to Markdown file |
| \`help\` | Show this help |
| \`exit\` / \`quit\` | Stop Hermes |`;
}

/**
 * Start the interactive REPL loop.
 *
 * Reads lines from stdin, parses commands, executes them,
 * and prints results as formatted Markdown.
 */
export async function startRepl(state: ReplState): Promise<void> {
  console.log("\n  ═══════════════════════════════════════════");
  console.log("  🤖 Hermes Interactive REPL");
  console.log("  Type 'help' for commands, 'exit' to quit.");
  console.log("  ═══════════════════════════════════════════\n");

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  // Read from stdin line by line
  const reader = (Bun.stdin as unknown as ReadableStream).getReader();

  let buffer = "";

  while (true) {
    process.stdout.write(encoder.encode("hermes> "));

    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Process complete lines
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);

      if (!line) continue;

      const cmd = parseCommand(line);
      const output = await executeCommand(cmd, state);

      if (output === "exit") {
        console.log("\n  👋 Hermes signing off...\n");
        return;
      }

      console.log("\n" + output + "\n");
    }
  }
}
