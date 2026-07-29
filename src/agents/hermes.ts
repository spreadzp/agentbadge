/**
 * Hermes demo agent — core orchestration logic.
 *
 * Reference: SLICE-4-4, hackathon-flow.md:239-352 (demo script)
 *
 * Flow:
 *   1. Sign wallet-ownership message
 *   2. POST /mcp/tools/request_passport → get DID, tokenId, serial
 *   3. Build AgentCard with returned DID
 *   4. POST /mcp/tools/register_agent → register in HCS directory
 *   5. Print summary
 */

import type { Tier, Capability } from "@agentgate-hedera/hedera-core";
import { signWalletOwnership } from "./wallet";
import { buildAgentCard, serveAgentCard } from "./agent-card";

/** CLI arguments parsed from command line. */
export interface HermesArgs {
  register: boolean;
  interactive: boolean;
  name: string;
  tier: Tier;
}

/** Result of request_passport MCP tool call. */
export interface PassportResult {
  tokenId: string;
  serialNumber: number;
  did: string;
  tier: string;
  hashScanLink: string;
}

/** MCP tool call response envelope. */
export interface McpToolResponse {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
}

/** Tier → capabilities mapping (hackathon-flow.md §6). */
export function tierToCapabilities(tier: Tier): Capability[] {
  const base: Capability[] = ["api_call", "payment"];
  switch (tier) {
    case "bronze":
      return base;
    case "silver":
      return [...base, "data_provide"];
    case "gold":
      return [...base, "data_provide", "data_consume"];
    case "platinum":
      return [...base, "data_provide", "data_consume", "orchestration"];
  }
}

/** Parse CLI arguments: --register --name X --tier Y */
export function parseCliArgs(argv: string[]): HermesArgs {
  const register = argv.includes("--register");
  const interactive = argv.includes("--interactive") || argv.includes("-i");
  const nameIdx = argv.indexOf("--name");
  const tierIdx = argv.indexOf("--tier");

  if (nameIdx === -1 || !argv[nameIdx + 1]) {
    throw new Error("--name is required (e.g. --name TradingBot)");
  }
  if (tierIdx === -1 || !argv[tierIdx + 1]) {
    throw new Error("--tier is required (e.g. --tier silver)");
  }

  const name = argv[nameIdx + 1];
  const tier = argv[tierIdx + 1] as Tier;
  const validTiers: Tier[] = ["bronze", "silver", "gold", "platinum"];
  if (!validTiers.includes(tier)) {
    throw new Error(`Invalid tier: "${tier}". Must be one of: ${validTiers.join(", ")}`);
  }

  return { register, interactive, name, tier };
}

/** Call an MCP tool via HTTP transport. */
export async function callMcpTool(
  serverUrl: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpToolResponse> {
  const res = await fetch(`${serverUrl}/mcp/tools/${toolName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  return (await res.json()) as McpToolResponse;
}

/** Extract JSON data from MCP tool response. */
export function extractMcpResult(response: McpToolResponse): unknown {
  if (response.isError) {
    throw new Error(response.content?.[0]?.text ?? "Unknown MCP error");
  }
  const text = response.content?.[0]?.text;
  if (!text) throw new Error("Empty MCP response");
  return JSON.parse(text);
}

/** Print a demo-style narration step. */
function narrate(step: string, message: string): void {
  console.log(`\n  ┌─ ${step} ─────────────────────`);
  console.log(`  │ ${message}`);
  console.log(`  └─────────────────────────────────`);
}

/**
 * Run the Hermes registration flow.
 *
 * 1. Sign wallet ownership
 * 2. Request passport via MCP HTTP
 * 3. Build + serve AgentCard
 * 4. Register agent via MCP HTTP
 */
export async function runHermes(args: HermesArgs): Promise<PassportResult> {
  const accountId = process.env.HERMES_ACCOUNT_ID;
  const privateKey = process.env.HERMES_PRIVATE_KEY;
  const serverUrl = process.env.MCP_SERVER_URL ?? "http://localhost:4021";
  const agentPort = Number(process.env.HERMES_PORT ?? 4030);
  const endpoint = process.env.HERMES_ENDPOINT ?? `http://localhost:${agentPort}`;

  if (!accountId || !privateKey) {
    throw new Error("HERMES_ACCOUNT_ID and HERMES_PRIVATE_KEY must be set in .env");
  }

  const capabilities = tierToCapabilities(args.tier);

  // Step 1: Sign wallet ownership
  narrate("Step 1", `Signing wallet ownership for ${accountId}...`);
  const signature = await signWalletOwnership(accountId, privateKey);
  console.log(`  Signature: ${signature.slice(0, 20)}...`);

  // Step 2: Request passport
  narrate("Step 2", `Requesting ${args.tier} passport for "${args.name}"...`);
  const passportResp = await callMcpTool(serverUrl, "request_passport", {
    accountId,
    signature,
    tier: args.tier,
    name: args.name,
    capabilities,
    endpoint,
  });

  const passport = extractMcpResult(passportResp) as PassportResult;
  console.log(`  DID: ${passport.did}`);
  console.log(`  Token: ${passport.tokenId}  Serial: ${passport.serialNumber}`);
  console.log(`  HashScan: ${passport.hashScanLink}`);

  // Step 3: Build + serve AgentCard
  narrate("Step 3", "Building AgentCard manifest...");
  const card = buildAgentCard({
    name: args.name,
    did: passport.did,
    passportTokenId: passport.tokenId,
    passportSerial: passport.serialNumber,
    capabilities,
    tier: args.tier,
    endpoint,
  });

  serveAgentCard(card, agentPort);
  console.log(`  AgentCard served at http://localhost:${agentPort}/.well-known/agent-card.json`);

  // Step 4: Register agent
  narrate("Step 4", `Registering "${args.name}" in HCS directory...`);
  const registerResp = await callMcpTool(serverUrl, "register_agent", {
    did: passport.did,
    tokenId: passport.tokenId,
    serial: passport.serialNumber,
    accountId,
    name: args.name,
    capabilities,
    endpoint,
    tier: args.tier,
  });

  const regResult = extractMcpResult(registerResp) as { registered: boolean };
  console.log(`  Registered: ${regResult.registered}`);

  // Summary
  console.log("\n  ═══════════════════════════════════════════");
  console.log(`  ✅ Hermes agent "${args.name}" is live!`);
  console.log(`  DID:       ${passport.did}`);
  console.log(`  Tier:      ${args.tier}`);
  console.log(`  Endpoint:  ${endpoint}`);
  console.log(`  HashScan:  ${passport.hashScanLink}`);
  console.log(`  AgentCard: http://localhost:${agentPort}/.well-known/agent-card.json`);
  console.log("  ═══════════════════════════════════════════\n");

  return passport;
}
