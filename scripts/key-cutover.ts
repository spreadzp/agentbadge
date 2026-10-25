/**
 * SLICE-173-3 (EPIC-173): signing-key cutover — one-shot rotation onto
 * the dedicated ARC_SETTLE_KEY / ARC_OPS_KEY scheme + plumbing for
 * instant emergency rotation later.
 *
 *   # 1. Generate fresh keys (prints secrets ONCE — save into a vault):
 *   bun scripts/key-cutover.ts --gen
 *
 *   # 2. Or import keys generated offline (env vars, never argv):
 *   NEW_SETTLE_KEY=0x.. NEW_OPS_KEY=0x.. bun scripts/key-cutover.ts --import
 *
 *   # 3. Register the new evaluator on ERC-8004 (needs ops wallet funded):
 *   NEW_SETTLE_KEY=0x.. NEW_OPS_KEY=0x.. bun scripts/key-cutover.ts \
 *     --register --network mainnet
 *
 * ── RUNBOOK (window=0 cutover, D-173-3) ────────────────────────────
 *   1.  this script --gen → save NEW keys in operator vault
 *   2.  top-up new settle EOA with a few cents of USDC (gas) — see
 *       printed address; testnet: faucet, mainnet: treasury transfer
 *   3.  --register → ERC-8004 agentId for the new evaluator EOA
 *   4.  fly secrets set ARC_SETTLE_KEY=.. ARC_OPS_KEY=..
 *       (+ SIGNER_BACKEND=socket SIGNER_ALLOW_TO=<csv> when the
 *        signer-service runs — its SIGNER_KEY=ARC_SETTLE_KEY)
 *   5.  fly secrets unset ARC_EVALUATOR_KEY DEPLOYER_PRIVATE_KEY
 *   6.  redeploy; watch log "EaaS jobs API mounted {settler: ...}"
 *       — must equal the NEW settle address
 *   7.  run scripts/settle-straggler.ts with the OLD key until no
 *       Submitted jobs with the old evaluator remain
 *   8.  destroy the old key (it must not live in deploy env anymore)
 *   9.  verify: GET /keys/verdict-signers.json current == new settle
 *       EOA; an OLD verdict still verifies via
 *       verifyVerdictSignature (self-describing EIP-712 — no code path
 *       reads the signers file for acceptance, it is trust-ahead only)
 *
 * Files touched by this script: public/keys/verdict-signers.json.
 * Private keys NEVER touch disk or server env here — argv/gen prints
 * to stdout, operator moves them into Fly secrets / vault.
 */

import { writeFileSync } from "node:fs";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const OUT = "public/keys/verdict-signers.json";

interface KeyPair { settle: `0x${string}`; ops: `0x${string}` }
interface Addrs { settleAddr: `0x${string}`; opsAddr: `0x${string}` }

const KEY_RE = /^0x[0-9a-fA-F]{64}$/;

function derive(keys: KeyPair): Addrs {
  return {
    settleAddr: privateKeyToAccount(keys.settle).address,
    opsAddr: privateKeyToAccount(keys.ops).address,
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    gen: args.includes("--gen"),
    import_: args.includes("--import"),
    register: args.includes("--register"),
    network: args.includes("--network") ? args[args.indexOf("--network") + 1] : "testnet",
    next: args.includes("--next") ? args[args.indexOf("--next") + 1] : undefined,
  };
}

function loadKeys(mode: { gen: boolean; import_: boolean }): KeyPair {
  if (mode.gen) {
    return {
      settle: generatePrivateKey() as `0x${string}`,
      ops: generatePrivateKey() as `0x${string}`,
    };
  }
  const settle = process.env.NEW_SETTLE_KEY as `0x${string}` | undefined;
  const ops = process.env.NEW_OPS_KEY as `0x${string}` | undefined;
  if (!settle || !ops || !KEY_RE.test(settle) || !KEY_RE.test(ops)) {
    console.error("Set NEW_SETTLE_KEY and NEW_OPS_KEY (64-hex) in env, or use --gen");
    process.exit(1);
  }
  return { settle, ops };
}

function writeSigners(addrs: Addrs, nextOverride?: string) {
  const current =
    process.env.SIGNERS_CURRENT?.toLowerCase() ??
    addrs.settleAddr.toLowerCase();
  const doc = {
    $schema: "https://agentbadge.xyz/schemas/verdict-signers/v1.json",
    updated: new Date().toISOString(),
    // electron-builder model: consumers pre-trust `next` so an urgent
    // rotation never leaves freshly-signed artifacts unverifiable.
    current: current as `0x${string}`,
    next: (nextOverride ?? addrs.settleAddr).toLowerCase() as `0x${string}`,
    verify: "EIP-712 VerdictArtifact — recovered signer == artifact.evaluator (self-describing; this file is advisory trust-ahead, not acceptance)",
  };
  writeFileSync(OUT, JSON.stringify(doc, null, 2) + "\n");
  return doc;
}

async function registerEvaluator(keys: KeyPair, addrs: Addrs, network: string) {
  // ERC-8004 register for the new evaluator EOA — needs the OPS wallet
  // funded (it pays gas for the metadata URI mint on IdentityRegistry).
  const { createErc8004 } = await import("@agentbadge/circle-payments");
  const { resolveVenueNetwork, publicClient } = await import(
    "../src/server/lib/venue/chain"
  );
  const { keyWallet } = await import("../src/server/lib/eaas/keys");
  const { arcChainFor } = await import("../src/server/lib/marketplace/chain");
  if (network === "mainnet") process.env.ARC_NETWORK = "mainnet";
  const net = resolveVenueNetwork();
  const chain = arcChainFor(net.chain.caip2);
  const ops = keyWallet(keys.ops, chain, net.chain.rpcUrl);
  if (!ops.wallet || !ops.account) throw new Error("ops wallet failed to build");
  const erc8004 = createErc8004({
    read: publicClient(net),
    identity: net.identityRegistry,
  } as never);
  const uri = `https://agentbadge.xyz/.well-known/agent.json#evaluator-${addrs.settleAddr.slice(2, 10)}`;
  const { agentId, txHash } = await erc8004.registerMirror(ops.wallet as never, uri);
  return { agentId: agentId.toString(), txHash };
}

async function main() {
  const mode = parseArgs();
  if (!mode.gen && !mode.import_ && !mode.register) {
    console.log("usage: key-cutover.ts --gen | --import [--register] [--network mainnet] [--next 0x..]");
    process.exit(0);
  }
  const keys = loadKeys(mode);
  const addrs = derive(keys);
  const doc = writeSigners(addrs, mode.next);

  console.log("=== NEW AUTHORITY ADDRESSES ===");
  console.log(`settle EOA : ${addrs.settleAddr}`);
  console.log(`ops EOA    : ${addrs.opsAddr}`);
  if (mode.gen) {
    console.log("\n=== PRIVATE KEYS — print once, move to vault, never commit ===");
    console.log(`ARC_SETTLE_KEY=${keys.settle}`);
    console.log(`ARC_OPS_KEY=${keys.ops}`);
  }
  console.log("\n=== env line for venue server wallets ===");
  console.log(`ARC_VENUE_SERVER_WALLETS=settle:${addrs.settleAddr},ops:${addrs.opsAddr}`);
  console.log(`\nWrote ${OUT}: current=${doc.current} next=${doc.next}`);

  if (mode.register) {
    const reg = await registerEvaluator(keys, addrs, mode.network);
    console.log(`\nERC-8004 registered: agentId=${reg.agentId} tx=${reg.txHash}`);
    console.log(`Set ARC_EAAS_AGENTID_MAP=${addrs.settleAddr}:${reg.agentId}`);
  }
  console.log("\nNext: follow the RUNBOOK checklist at the top of this file.");
}

void main();
