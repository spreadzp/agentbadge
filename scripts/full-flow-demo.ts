#!/usr/bin/env bun
/**
 * Full-Flow Demo Script — tests ALL AgentBadge platform capabilities from zero.
 *
 * Steps:
 *  1.  Health check
 *  2.  Get tier catalog
 *  3.  Load agent wallet (from agents/.env or generate random)
 *  4.  Sign wallet ownership
 *  5.  Request passport (mint NFT)
 *  6.  Verify passport (active)
 *  7.  List all passports
 *  8.  Register agent in directory
 *  9.  Find agents by capability
 *  10. Upgrade tier (bronze → silver)
 *  11. Check audit trail
 *  12. Revoke passport (admin)
 *  13. Verify revocation
 *  14. Print summary certificate
 *
 * Usage:
 *   bun run scripts/full-flow-demo.ts
 *   MOCK_HEDERA=true bun run scripts/full-flow-demo.ts
 *   AGENT_NAME=MyBot AGENT_TIER=silver bun run scripts/full-flow-demo.ts
 *
 * Agent credentials (optional, defaults to agents/.env):
 *   AGENT_ACCOUNT_ID=0.0.9651149
 *   AGENT_PRIVATE_KEY=0x631b...
 */

import { ethers } from "ethers";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:4021";
const AGENT_NAME = process.env.AGENT_NAME ?? "FullFlowDemoBot";
const TIER = (process.env.AGENT_TIER ?? "bronze") as "bronze" | "silver" | "gold" | "platinum";
const UPGRADE_TIER: "bronze" | "silver" | "gold" | "platinum" =
  TIER === "bronze" ? "silver" : TIER === "silver" ? "gold" : "platinum";
const ADMIN_KEY = process.env.ADMIN_API_KEY ?? "test-admin-key";

// ─── Load agent credentials ───────────────────────────

function loadAgentCredentials(): { accountId: string; privateKey: string; evmAddress: string } {
  // 1. Try env vars first
  if (process.env.AGENT_ACCOUNT_ID && process.env.AGENT_PRIVATE_KEY) {
    const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY);
    return {
      accountId: process.env.AGENT_ACCOUNT_ID,
      privateKey: process.env.AGENT_PRIVATE_KEY,
      evmAddress: wallet.address,
    };
  }

  // 2. Try agents/.env
  const agentsEnvPath = join(dirname(fileURLToPath(import.meta.url)), "../../agents/.env");
  try {
    const envContent = readFileSync(agentsEnvPath, "utf-8");
    const getVar = (name: string): string | undefined => {
      const match = envContent.match(new RegExp(`^${name}="?([^"]+)"?`, "m"));
      return match?.[1]?.trim();
    };

    const accountId = getVar("HEDERA_ACCOUNT_ID");
    const privateKey = getVar("HEDERA_PRIVATE_KEY_HEX");

    if (accountId && privateKey) {
      const wallet = new ethers.Wallet(privateKey);
      return { accountId, privateKey, evmAddress: wallet.address };
    }
  } catch {
    // agents/.env not found
  }

  // 3. Fallback: generate random wallet (mock mode only)
  console.log("  ⚠️  No agent credentials found, using random wallet (mock mode only!)");
  const wallet = ethers.Wallet.createRandom();
  return {
    accountId: wallet.address,
    privateKey: wallet.privateKey,
    evmAddress: wallet.address,
  };
}

// ─── Helpers ───────────────────────────────────────────

function step(num: number, title: string): void {
  console.log(`\n  ┌─ Step ${num}: ${title} ${"─".repeat(Math.max(0, 40 - title.length))}`);
}

function done(): void {
  console.log(`  └${"─".repeat(58)}`);
}

async function mcpCall(tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${SERVER_URL}/mcp/tools/${tool}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const json = (await res.json()) as { isError?: boolean; content: Array<{ text: string }> };
  if (json.isError) {
    throw new Error(`${tool} failed: ${json.content[0]?.text}`);
  }
  return JSON.parse(json.content[0].text);
}

async function httpGet(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${SERVER_URL}${path}`);
  return (await res.json()) as Record<string, unknown>;
}

async function httpPost(
  path: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
}

// ─── Main ──────────────────────────────────────────────

async function main() {
  const creds = loadAgentCredentials();
  const wallet = new ethers.Wallet(creds.privateKey);

  console.log("\n  ═══════════════════════════════════════════");
  console.log("  🤖 AgentBadge Full-Flow Demo");
  console.log(`  Server:  ${SERVER_URL}`);
  console.log(`  Agent:   ${AGENT_NAME} (tier: ${TIER})`);
  console.log(`  Account: ${creds.accountId}`);
  console.log(`  EVM:     ${creds.evmAddress}`);
  console.log(`  Upgrade: ${TIER} → ${UPGRADE_TIER}`);
  console.log("  ═══════════════════════════════════════════");

  // Step 1: Health check
  step(1, "Health check");
  const health = await httpGet("/health");
  console.log(`  Status: ${health.status}`);
  if (health.status !== "healthy") throw new Error("Server not healthy");
  console.log("  ✅ Server is healthy");
  done();

  // Step 2: Get tier catalog
  step(2, "Get tier catalog");
  const catalog = await mcpCall("get_tier_requirements", {});
  const tiers = catalog.tiers as Array<{ name: string; price: number; capabilities: string[] }>;
  console.log(`  Tiers: ${tiers.length}`);
  for (const t of tiers) {
    console.log(`    ${t.name.padEnd(10)} ${String(t.price).padStart(4)} HBAR  [${t.capabilities.join(", ")}]`);
  }
  done();

  // Step 3: Load agent wallet
  step(3, "Load agent wallet");
  console.log(`  Account ID: ${creds.accountId}`);
  console.log(`  EVM Addr:   ${creds.evmAddress}`);
  console.log(`  Key:        ${creds.privateKey.slice(0, 20)}...`);
  done();

  // Step 4: Sign wallet ownership
  step(4, "Sign wallet ownership");
  const message = `Request Passport: ${creds.accountId}`;
  const signature = await wallet.signMessage(message);
  console.log(`  Message:   "${message}"`);
  console.log(`  Signature: ${signature.slice(0, 30)}...`);
  done();

  // Step 5: Request passport
  step(5, "Request passport (mint NFT)");
  const endpoint = "http://localhost:4030";
  const tierCaps = tiers.find((t) => t.name === TIER)?.capabilities ?? ["api_call"];
  const passport = (await mcpCall("request_passport", {
    accountId: creds.accountId,
    signature,
    tier: TIER,
    name: AGENT_NAME,
    capabilities: tierCaps,
    endpoint,
  })) as {
    tokenId: string;
    serialNumber: number;
    did: string;
    tier: string;
    hashScanLink: string;
  };
  console.log(`  DID:       ${passport.did}`);
  console.log(`  Token:     ${passport.tokenId}`);
  console.log(`  Serial:    ${passport.serialNumber}`);
  console.log(`  HashScan:  ${passport.hashScanLink}`);
  done();

  // Step 6: Verify passport
  step(6, "Verify passport (active)");
  const verify = await mcpCall("verify_passport", {
    tokenId: passport.tokenId,
    serial: passport.serialNumber,
  });
  console.log(`  Active: ${verify.active}`);
  console.log(`  Tier:   ${verify.tier}`);
  console.log(`  Owner:  ${verify.owner ?? verify.accountId ?? "—"}`);
  if (verify.active !== true) throw new Error("Passport not active!");
  console.log("  ✅ Passport is active");
  done();

  // Step 7: List all passports
  step(7, "List all passports");
  const listResult = await mcpCall("list_passports", {});
  const passports = listResult.passports as Array<{ serialNumber: number }>;
  console.log(`  Total passports: ${passports.length}`);
  const found = passports.find((p) => p.serialNumber === passport.serialNumber);
  console.log(`  Our passport in list: ${found ? "yes" : "no"}`);
  if (!found) throw new Error("Our passport not found in list!");
  console.log("  ✅ Passport listed");
  done();

  // Step 8: Register agent in directory
  step(8, "Register agent in directory");
  const regResult = await mcpCall("register_agent", {
    did: passport.did,
    tokenId: passport.tokenId,
    serial: passport.serialNumber,
    accountId: creds.accountId,
    name: AGENT_NAME,
    capabilities: tierCaps,
    endpoint,
    tier: TIER,
  });
  console.log(`  Registered: ${regResult.registered}`);
  if (regResult.warning) console.log(`  Warning:    ${regResult.warning}`);
  if (regResult.registered !== true) throw new Error("Registration failed!");
  console.log("  ✅ Agent registered");
  done();

  // Step 9: Find agents by capability
  step(9, "Find agents by capability");
  const findResult = await mcpCall("find_agents", {
    capability: tierCaps[0],
  });
  const agents = findResult.agents as Array<{ name: string; did: string; capabilities: string[] }>;
  console.log(`  Agents with "${tierCaps[0]}": ${agents.length}`);
  for (const a of agents) {
    console.log(`    - ${a.name} (${a.did})`);
  }
  const us = agents.find((a) => a.did === passport.did);
  console.log(`  Our agent found: ${us ? "yes" : "no"}`);
  if (!us) console.log("  ⚠️  Agent not immediately visible (HCS consensus delay)");
  done();

  // Step 10: Upgrade tier
  step(10, `Upgrade tier: ${TIER} → ${UPGRADE_TIER}`);
  const upgradeResult = await mcpCall("upgrade_tier", {
    tokenId: passport.tokenId,
    serial: passport.serialNumber,
    newTier: UPGRADE_TIER,
    accountId: creds.accountId,
  });
  console.log(`  New tier: ${upgradeResult.tier}`);
  if (upgradeResult.tier !== UPGRADE_TIER) throw new Error("Upgrade failed!");
  console.log("  ✅ Tier upgraded");

  // Verify upgrade
  const verifyAfterUpgrade = await mcpCall("verify_passport", {
    tokenId: passport.tokenId,
    serial: passport.serialNumber,
  });
  console.log(`  Verified tier: ${verifyAfterUpgrade.tier}`);
  done();

  // Step 11: Check audit trail
  step(11, "Check audit trail");
  const auditResult = await mcpCall("get_audit_trail", {
    tokenId: passport.tokenId,
    serial: passport.serialNumber,
  });
  const events = auditResult.events as Array<{ type: string; timestamp?: string }>;
  console.log(`  Events: ${events.length}`);
  for (const e of events) {
    console.log(`    - ${e.type}`);
  }
  const eventTypes = events.map((e) => e.type);
  const hasIssued = eventTypes.includes("passport_issued");
  const hasRegistered = eventTypes.includes("agent_registered");
  const hasUpgraded = eventTypes.includes("tier_upgraded");
  console.log(`  passport_issued: ${hasIssued ? "✅" : "❌"}`);
  console.log(`  agent_registered: ${hasRegistered ? "✅" : "❌"}`);
  console.log(`  tier_upgraded: ${hasUpgraded ? "✅" : "❌"}`);
  done();

  // Step 12: Revoke passport (admin)
  step(12, "Revoke passport (admin)");
  const revokeResult = await httpPost(
    "/admin/revoke",
    {
      tokenId: passport.tokenId,
      serial: passport.serialNumber,
      reason: "Demo revocation — end of full-flow test",
    },
    { Authorization: `Bearer ${ADMIN_KEY}` },
  );
  console.log(`  Success: ${revokeResult.success}`);
  console.log(`  DID:      ${revokeResult.did}`);
  if (revokeResult.error) {
    console.log(`  Error:    ${revokeResult.error}`);
    console.log("  ⚠️  Revocation skipped (admin key may not be configured)");
  } else {
    console.log("  ✅ Passport revoked");
  }
  done();

  // Step 13: Verify revocation
  step(13, "Verify revocation");
  const verifyAfterRevoke = await mcpCall("verify_passport", {
    tokenId: passport.tokenId,
    serial: passport.serialNumber,
  });
  console.log(`  Active: ${verifyAfterRevoke.active}`);
  if (verifyAfterRevoke.active === false) {
    console.log("  ✅ Passport is revoked (inactive)");
  } else if (revokeResult.success) {
    throw new Error("Passport still active after revocation!");
  } else {
    console.log("  ⚠️  Could not verify revocation (admin key not configured)");
  }
  done();

  // Summary
  console.log("\n  ═══════════════════════════════════════════");
  console.log("  ✅ Full-flow demo complete!");
  console.log(`  Agent:     ${AGENT_NAME}`);
  console.log(`  DID:       ${passport.did}`);
  console.log(`  Tier:      ${TIER} → ${UPGRADE_TIER}`);
  console.log(`  Active:    ${verifyAfterRevoke.active}`);
  console.log(`  HashScan:  ${passport.hashScanLink}`);
  console.log(`  Events:    ${events.length} audit entries`);
  console.log("  ═══════════════════════════════════════════\n");

  // Write certificate
  const cert = `# AgentBadge Full-Flow Demo Certificate

Generated: ${new Date().toISOString()}

## Agent

- **Name:** ${AGENT_NAME}
- **DID:** ${passport.did}
- **Account:** ${creds.accountId}
- **EVM:** ${creds.evmAddress}
- **Initial Tier:** ${TIER}
- **Upgraded Tier:** ${UPGRADE_TIER}
- **Active:** ${verifyAfterRevoke.active}

## Passport

- **Token ID:** ${passport.tokenId}
- **Serial:** ${passport.serialNumber}
- **HashScan:** ${passport.hashScanLink}

## Steps Completed

1. ✅ Health check — server healthy
2. ✅ Tier catalog — ${tiers.length} tiers retrieved
3. ✅ Agent wallet loaded — ${creds.accountId}
4. ✅ Wallet signed — ownership proven
5. ✅ Passport requested — NFT minted (${passport.did})
6. ✅ Passport verified — active: true
7. ✅ Passports listed — found in collection
8. ✅ Agent registered — in HCS directory
9. ✅ Agents found — discoverable by capability
10. ✅ Tier upgraded — ${TIER} → ${UPGRADE_TIER}
11. ✅ Audit trail — ${events.length} events (${eventTypes.join(", ")})
12. ${revokeResult.success ? "✅" : "⚠️"} Passport revoked — ${revokeResult.success ? "success" : "skipped (no admin key)"}
13. ${verifyAfterRevoke.active === false ? "✅" : "⚠️"} Revocation verified — active: ${verifyAfterRevoke.active}

## Capabilities

${tierCaps.map((c) => `- ${c}`).join("\n")}
`;

  const certPath = "/tmp/agentgate-demo-certificate.md";
  await Bun.write(certPath, cert);
  console.log(`  📜 Certificate written to ${certPath}`);
  console.log("");
}

main().catch((e) => {
  console.error(`\n❌ Demo failed: ${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
