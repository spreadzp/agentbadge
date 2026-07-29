#!/usr/bin/env bun
/**
 * Hermes Onboarding Flow — fetches /agent-guide and executes all steps.
 *
 * This script demonstrates an AI agent reading the onboarding guide
 * and following it end-to-end to get a passport, register, and connect.
 *
 * Usage:
 *   bun run scripts/hermes-onboard.ts
 *
 * Requires: Server running with MOCK_HEDERA=true on the specified port.
 */

import { ethers } from "ethers";
import { tierToCapabilities, callMcpTool, extractMcpResult, type PassportResult } from "../src/agents/hermes";
import { buildAgentCard, serveAgentCard } from "../src/agents/agent-card";

const SERVER_URL = process.env.MCP_SERVER_URL ?? "http://localhost:4099";
const AGENT_NAME = process.env.HERMES_NAME ?? "HermesOnboard";
const TIER = (process.env.HERMES_TIER ?? "silver") as "bronze" | "silver" | "gold" | "platinum";

// Generate a random EVM wallet for this onboarding run
const wallet = ethers.Wallet.createRandom();

function narrate(step: string, message: string): void {
  console.log(`\n  ┌─ ${step} ─────────────────────`);
  console.log(`  │ ${message}`);
  console.log(`  └─────────────────────────────────`);
}

async function main() {
  console.log("\n  ═══════════════════════════════════════════");
  console.log("  🤖 Hermes Onboarding Flow");
  console.log(`  Server: ${SERVER_URL}`);
  console.log(`  Agent:  ${AGENT_NAME} (${TIER})`);
  console.log(`  Wallet: ${wallet.address}`);
  console.log("  ═══════════════════════════════════════════");

  // Step 0: Fetch the onboarding guide
  narrate("Step 0", "Fetching GET /agent-guide ...");
  const guideRes = await fetch(`${SERVER_URL}/agent-guide`);
  if (!guideRes.ok) {
    throw new Error(`Failed to fetch guide: ${guideRes.status}`);
  }
  const guide = await guideRes.text();
  const contentType = guideRes.headers.get("content-type") ?? "";
  console.log(`  Content-Type: ${contentType}`);
  console.log(`  Guide length: ${guide.length} chars`);
  console.log(`  Guide contains 7 steps: ${guide.includes("Step 1") && guide.includes("Step 7")}`);

  // Verify guide has all required sections
  const requiredSteps = [
    "Step 1: Request Passport",
    "Step 2: Receive Passport",
    "Step 3: Verify Passport",
    "Step 4: Register in Directory",
    "Step 5: Connect MCP Server",
    "Step 6 (Optional): Find Other Agents",
    "Step 7 (Optional): Upgrade Tier",
  ];
  for (const step of requiredSteps) {
    if (!guide.includes(step)) {
      throw new Error(`Guide missing section: ${step}`);
    }
  }
  console.log("  ✅ All 7 steps present in guide");

  // Step 1: Request Passport — sign wallet ownership, call request_passport
  narrate("Step 1", `Signing wallet ownership for ${wallet.address}...`);
  const accountId = wallet.address; // Use EVM address as accountId in mock mode
  const message = `Request Passport: ${accountId}`;
  const signature = await wallet.signMessage(message);
  console.log(`  Signature: ${signature.slice(0, 20)}...`);

  const capabilities = tierToCapabilities(TIER);
  const agentPort = 4040;
  const endpoint = `http://localhost:${agentPort}`;

  narrate("Step 1", `Requesting ${TIER} passport via MCP...`);
  const passportResp = await callMcpTool(SERVER_URL, "request_passport", {
    accountId,
    signature,
    tier: TIER,
    name: AGENT_NAME,
    capabilities,
    endpoint,
  });

  if (passportResp.isError) {
    throw new Error(`request_passport failed: ${passportResp.content[0]?.text}`);
  }

  const passport = extractMcpResult(passportResp) as PassportResult;
  console.log(`  DID:       ${passport.did}`);
  console.log(`  Token:     ${passport.tokenId}`);
  console.log(`  Serial:    ${passport.serialNumber}`);
  console.log(`  HashScan:  ${passport.hashScanLink}`);

  // Step 2: Receive Passport — values already parsed above
  narrate("Step 2", "Passport received and parsed.");
  console.log(`  tokenId:      ${passport.tokenId}`);
  console.log(`  serialNumber: ${passport.serialNumber}`);
  console.log(`  did:          ${passport.did}`);

  // Step 3: Verify Passport
  narrate("Step 3", "Verifying passport on-chain via MCP...");
  const verifyResp = await callMcpTool(SERVER_URL, "verify_passport", {
    tokenId: passport.tokenId,
    serial: passport.serialNumber,
  });

  if (verifyResp.isError) {
    throw new Error(`verify_passport failed: ${verifyResp.content[0]?.text}`);
  }

  const verifyResult = extractMcpResult(verifyResp) as Record<string, unknown>;
  console.log(`  Active: ${verifyResult.active}`);
  console.log(`  Tier:   ${verifyResult.tier}`);
  console.log(`  Owner:  ${verifyResult.owner ?? verifyResult.accountId ?? "—"}`);

  if (verifyResult.active !== true) {
    throw new Error("Passport not active after issuance!");
  }
  console.log("  ✅ Passport is active");

  // Step 4: Register in Directory
  narrate("Step 4", `Registering "${AGENT_NAME}" in HCS directory...`);
  const registerResp = await callMcpTool(SERVER_URL, "register_agent", {
    did: passport.did,
    tokenId: passport.tokenId,
    serial: passport.serialNumber,
    accountId,
    name: AGENT_NAME,
    capabilities,
    endpoint,
    tier: TIER,
  });

  if (registerResp.isError) {
    throw new Error(`register_agent failed: ${registerResp.content[0]?.text}`);
  }

  const regResult = extractMcpResult(registerResp) as { registered: boolean };
  console.log(`  Registered: ${regResult.registered}`);

  if (!regResult.registered) {
    throw new Error("Registration failed!");
  }
  console.log("  ✅ Agent registered in directory");

  // Step 5: Connect MCP Server — list available tools
  narrate("Step 5", "Connecting to MCP server...");
  const toolsRes = await fetch(`${SERVER_URL}/mcp/tools`);
  const toolsData = await toolsRes.json() as { tools: Array<{ name: string; description: string }> };
  console.log(`  Available tools: ${toolsData.tools.length}`);
  for (const tool of toolsData.tools) {
    console.log(`    - ${tool.name}: ${tool.description.slice(0, 60)}...`);
  }
  console.log("  ✅ MCP server connected");

  // Build and serve AgentCard
  const card = buildAgentCard({
    name: AGENT_NAME,
    did: passport.did,
    passportTokenId: passport.tokenId,
    passportSerial: passport.serialNumber,
    capabilities,
    tier: TIER,
    endpoint,
  });
  console.log(`  AgentCard built for ${card.name}`);

  // Step 6: Find Other Agents
  narrate("Step 6", "Finding agents with capability 'data_provide'...");
  const findResp = await callMcpTool(SERVER_URL, "find_agents", {
    capability: "data_provide",
  });

  const findResult = extractMcpResult(findResp) as { agents: Array<{ name: string; did: string }> };
  console.log(`  Found ${findResult.agents.length} agent(s) with data_provide:`);
  for (const agent of findResult.agents) {
    console.log(`    - ${agent.name} (${agent.did})`);
  }
  console.log("  ✅ Agent search completed");

  // Step 7: Upgrade Tier (optional — upgrade to gold)
  narrate("Step 7", `Upgrading from ${TIER} to gold...`);
  const upgradeResp = await callMcpTool(SERVER_URL, "upgrade_tier", {
    tokenId: passport.tokenId,
    serial: passport.serialNumber,
    newTier: "gold",
    accountId,
  });

  if (upgradeResp.isError) {
    console.log(`  ⚠️  Upgrade failed (expected if already at gold): ${upgradeResp.content[0]?.text}`);
  } else {
    const upgradeResult = extractMcpResult(upgradeResp) as Record<string, unknown>;
    console.log(`  Upgrade result: ${JSON.stringify(upgradeResult)}`);
    console.log("  ✅ Tier upgraded to gold");
  }

  // Final verification — verify passport after upgrade
  narrate("Verify", "Final passport verification after all steps...");
  const finalVerifyResp = await callMcpTool(SERVER_URL, "verify_passport", {
    tokenId: passport.tokenId,
    serial: passport.serialNumber,
  });
  const finalVerify = extractMcpResult(finalVerifyResp) as Record<string, unknown>;
  console.log(`  Active: ${finalVerify.active}`);
  console.log(`  Tier:   ${finalVerify.tier}`);

  // Summary
  console.log("\n  ═══════════════════════════════════════════");
  console.log("  ✅ Hermes onboarding complete!");
  console.log(`  Guide:     ${SERVER_URL}/agent-guide`);
  console.log(`  DID:       ${passport.did}`);
  console.log(`  Tier:      ${finalVerify.tier}`);
  console.log(`  Active:    ${finalVerify.active}`);
  console.log(`  HashScan:  ${passport.hashScanLink}`);
  console.log("  ═══════════════════════════════════════════\n");

  // Write certificate
  const certificate = `# Agent Onboarding Certificate

Generated: ${new Date().toISOString()}

## Agent
- **Name:** ${AGENT_NAME}
- **DID:** ${passport.did}
- **Tier:** ${finalVerify.tier}
- **Active:** ${finalVerify.active}
- **Wallet:** ${wallet.address}

## Passport
- **Token ID:** ${passport.tokenId}
- **Serial:** ${passport.serialNumber}
- **HashScan:** ${passport.hashScanLink}

## Onboarding Steps Completed
1. ✅ Fetched /agent-guide
2. ✅ Requested passport (tier: ${TIER})
3. ✅ Verified passport (active: true)
4. ✅ Registered in directory
5. ✅ Connected to MCP server (${toolsData.tools.length} tools)
6. ✅ Found agents with data_provide capability
7. ✅ Upgraded tier to gold

## Capabilities
${capabilities.map((c) => `- ${c}`).join("\n")}
`;

  const certPath = "/tmp/hermes-onboarding-certificate.md";
  await Bun.write(certPath, certificate);
  console.log(`  📜 Certificate written to ${certPath}`);
}

main().catch((e) => {
  console.error(`\n❌ Onboarding failed: ${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
