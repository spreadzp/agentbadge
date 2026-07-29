#!/usr/bin/env bun
/**
 * Hermes Demo Agent — CLI entry point.
 *
 * Usage:
 *   bun run hermes --register --name TradingBot --tier silver
 *   bun run hermes --register --name TradingBot --tier silver --interactive
 *   bun run hermes --interactive --name TradingBot --tier silver
 *
 * --register:     One-shot registration (sign → request passport → register)
 * --interactive:  Drop into REPL after registration (or directly if already registered)
 *
 * Requires HERMES_ACCOUNT_ID and HERMES_PRIVATE_KEY in .env
 *
 * Reference: SLICE-4-4, CONTEXT.md:73-75
 */

import { parseCliArgs, runHermes, tierToCapabilities } from "../src/agents/hermes";
import { startRepl, type ReplState } from "../src/agents/repl";
import { buildAgentCard, serveAgentCard } from "../src/agents/agent-card";

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (!args.register && !args.interactive) {
    console.error("Hermes requires --register and/or --interactive mode.");
    console.error("Usage:");
    console.error("  bun run hermes --register --name TradingBot --tier silver");
    console.error("  bun run hermes --register --name TradingBot --tier silver --interactive");
    console.error("  bun run hermes --interactive --name TradingBot --tier silver");
    process.exit(1);
  }

  try {
    let passport = null;
    let card = null;

    if (args.register) {
      passport = await runHermes(args);

      const agentPort = Number(process.env.HERMES_PORT ?? 4030);
      const endpoint =
        process.env.HERMES_ENDPOINT ?? `http://localhost:${agentPort}`;

      card = buildAgentCard({
        name: args.name,
        did: passport.did,
        passportTokenId: passport.tokenId,
        passportSerial: passport.serialNumber,
        capabilities: tierToCapabilities(args.tier),
        tier: args.tier,
        endpoint,
      });
    }

    if (args.interactive) {
      if (!passport) {
        const agentPort = Number(process.env.HERMES_PORT ?? 4030);
        const endpoint =
          process.env.HERMES_ENDPOINT ?? `http://localhost:${agentPort}`;

        card = buildAgentCard({
          name: args.name,
          did: "did:hcs:pending",
          passportTokenId: process.env.PASSPORT_TOKEN_ID ?? "0.0.unknown",
          passportSerial: 0,
          capabilities: tierToCapabilities(args.tier),
          tier: args.tier,
          endpoint,
        });

        serveAgentCard(card, agentPort);
        console.log(`  AgentCard served at http://localhost:${agentPort}/.well-known/agent-card.json`);
      }

      const state: ReplState = {
        serverUrl: process.env.MCP_SERVER_URL ?? "http://localhost:4021",
        passport,
        card,
        agentName: args.name,
        accountId: process.env.HERMES_ACCOUNT_ID ?? "",
        lastResult: null,
      };

      await startRepl(state);
    }
  } catch (e) {
    console.error(`\n❌ Hermes failed: ${e instanceof Error ? e.message : e}\n`);
    process.exit(1);
  }
}

main();
