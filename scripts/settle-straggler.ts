/**
 * SLICE-173-3 (EPIC-173): straggler settlement — the last use of the
 * OLD evaluator key after cutover.
 *
 * Old Submitted jobs have `job.evaluator == OLD_EOA` baked into the
 * contract — the NEW settle key cannot call complete/reject on them
 * (access control). This one-off script settles them out with the old
 * key, read from a file descriptor — NEVER from server env:
 *
 *   OLD_SETTLE_KEY_FILE=/run/secrets/old-settle-key \
 *     bun scripts/settle-straggler.ts --dry-run
 *   OLD_SETTLE_KEY_FILE=/run/secrets/old-settle-key \
 *     bun scripts/settle-straggler.ts --execute
 *
 * or via stdin: `cat key.hex | bun scripts/settle-straggler.ts --execute`
 *
 * Policy flag (default = reject — refund, never approve unverifiable
 * deliverables): `--mode complete` settles each straggler to provider.
 * When zero stragglers remain → destroy the old key (runbook step 8).
 */

import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";

const KEY_RE = /^0x[0-9a-fA-F]{64}$/;

async function readOldKey(): Promise<`0x${string}`> {
  const file = process.env.OLD_SETTLE_KEY_FILE;
  let raw = "";
  if (file) {
    raw = readFileSync(file, "utf8").trim();
  } else if (!process.stdin.isTTY) {
    raw = await new Promise<string>((resolve) => {
      const rl = createInterface({ input: process.stdin });
      rl.on("line", (l) => {
        rl.close();
        resolve(l.trim());
      });
    });
  } else {
    console.error("Provide the OLD key via OLD_SETTLE_KEY_FILE or stdin — never server env");
    process.exit(1);
  }
  if (!KEY_RE.test(raw)) {
    console.error("OLD key is not a 64-hex private key");
    process.exit(1);
  }
  return raw as `0x${string}`;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const modeIdx = process.argv.indexOf("--mode");
  const mode = modeIdx >= 0 ? process.argv[modeIdx + 1] : "reject";
  if (mode !== "complete" && mode !== "reject") {
    console.error("--mode must be complete|reject");
    process.exit(1);
  }
  const oldKey = await readOldKey();
  const oldEoa = privateKeyToAccount(oldKey).address;
  console.log(`old evaluator EOA: ${oldEoa} (${execute ? "EXECUTE" : "dry-run"})`);

  const { resolveVenueNetwork, publicClient } = await import(
    "../src/server/lib/venue/chain"
  );
  const { keyWallet } = await import("../src/server/lib/eaas/keys");
  const { arcChainFor } = await import("../src/server/lib/marketplace/chain");
  const { createErc8183 } = await import("@agentbadge/circle-payments");

  const net = resolveVenueNetwork();
  const chain = arcChainFor(net.chain.caip2);
  const read = publicClient(net);
  const { account, wallet } = keyWallet(oldKey, chain, net.chain.rpcUrl);
  if (!wallet || !account) throw new Error("old-key wallet failed to build");

  // Stragglers = Submitted jobs whose evaluator is the OLD EOA on the
  // registered escrow contracts. Discovery is contract-list-driven;
  // operators re-run until the count is zero, then destroy the key.
  const escrow = createErc8183({
    read: read as never,
    contract: net.agenticCommerce,
    usdc: net.chain.usdc,
    variant: net.variant,
  });
  console.log(`scanning ${net.name} escrow ${net.agenticCommerce} for Submitted jobs (evaluator=${oldEoa})…`);

  // Job enumeration: recent jobIds are sequential on ERC-8183 —
  // probe a bounded window; empty window → nothing to settle.
  const windowEnd = BigInt(process.env.STRAGGLER_JOB_ID_MAX ?? "500");
  let settled = 0;
  for (let id = 1n; id <= windowEnd; id++) {
    let job;
    try {
      job = await escrow.getJob(id);
    } catch {
      continue; // hole in id space / contract variant mismatch
    }
    if (!job) continue;
    if (job.evaluator.toLowerCase() !== oldEoa.toLowerCase()) continue;
    if (job.status !== "Submitted") continue;
    console.log(`straggler job ${id}: status=Submitted evaluator match`);
    if (!execute) continue;
    const reason = ("0x" + Buffer.from("straggler-cutover").toString("hex")) as `0x${string}`;
    try {
      const tx = mode === "complete"
        ? await escrow.completeJob(wallet as never, { jobId: id, reason })
        : await escrow.rejectJob(wallet as never, { jobId: id, reason });
      console.log(`  ${mode} tx=${tx}`);
      settled++;
    } catch (e) {
      console.error(`  settle failed for job ${id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(settled === 0
    ? (execute ? "no stragglers settled — see notes" : "dry-run: 0 stragglers found")
    : `settled ${settled} stragglers — re-run until 0, then destroy the old key`);
}

void main();
