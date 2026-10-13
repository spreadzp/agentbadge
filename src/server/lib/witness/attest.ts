/**
 * SLICE-185-2 (EPIC-185): witness attestation pipeline helpers.
 *
 * EIP-191 canonical payload (D-185-3):
 *   AgentBadgeWitness:v1:<jobId>:<agentId>:<verdict>:<contentSha256>:<reasonHash>
 * reasonHash = keccak256(reason) — the raw reason is NOT in the signed
 * string, so an attacker who sees a signature learns only its hash.
 *
 * All functions are pure/sync except verifyWitnessSignature (viem
 * verifyMessage — local EOA recovery, no RPC) and checkDailyCap.
 */
import { keccak256, toBytes, verifyMessage } from "viem";
import type { WitnessStore } from "./store";
import type { WitnessAttestation } from "./types";
import type { WitnessJobRef } from "./jobs";

export const WITNESS_PAYLOAD_PREFIX = "AgentBadgeWitness:v1";

export function buildWitnessPayload(input: {
  jobId: string;
  agentId: string;
  verdict: WitnessAttestation["verdict"];
  contentSha256: string;
  reason: string;
}): string {
  const reasonHash = keccak256(toBytes(input.reason));
  return [
    WITNESS_PAYLOAD_PREFIX,
    input.jobId,
    input.agentId,
    input.verdict,
    input.contentSha256.toLowerCase(),
    reasonHash,
  ].join(":");
}

/**
 * EIP-191 verify: recovered signer must equal the wallet recorded at
 * enroll (wallet is immutable — COI anchor). Throws nothing; a
 * malformed signature is simply false.
 */
export async function verifyWitnessSignature(
  payload: string,
  signature: `0x${string}`,
  expectedWallet: `0x${string}`,
): Promise<boolean> {
  try {
    return await verifyMessage({
      address: expectedWallet,
      message: payload,
      signature,
    });
  } catch {
    return false;
  }
}

/**
 * COI (D-185-5): conflict when the witness agentId OR its enrolled
 * wallet matches any job participant (requester / buyer / evaluator).
 * Wallet matching is the sybil-proof dimension — a fresh agentId with
 * the same wallet is still the same entity.
 */
export function checkCoi(
  job: WitnessJobRef,
  agentId: string,
  wallet: string,
): boolean {
  const id = agentId.toLowerCase();
  const w = wallet.toLowerCase();
  const agentIds = [
    job.requesterAgentId,
    job.buyerAgentId,
    job.evaluatorAgentId,
  ];
  if (agentIds.some((a) => a && a.toLowerCase() === id)) return true;
  const wallets = [job.requesterWallet, job.buyerWallet, job.evaluatorWallet];
  return wallets.some((x) => x && x.toLowerCase() === w);
}

export type AttestWindow = "ok" | "not_delivered" | "closed";

/**
 * Window is [deliveredAt, deliveredAt + windowSec). An undelivered job
 * has no attestable artifact → "not_delivered" (distinct from closed —
 * the window hasn't opened yet).
 */
export function validateAttestWindow(
  job: WitnessJobRef,
  windowSec: number,
  now = Date.now(),
): AttestWindow {
  if (!job.deliveredAt) return "not_delivered";
  if (now >= job.deliveredAt + windowSec * 1000) return "closed";
  return "ok";
}

/**
 * Daily credit spend (D-185-5). Atomically increments the agent's
 * day-bucket and reports whether it is still within `cap`. Attempt-
 * budget semantics: the credit is spent even if a LATER pipeline step
 * (sig verify) fails — signature guessing also burns quota. Only
 * `witness_daily_cap` refusals don't reach this point anyway.
 */
export async function checkDailyCap(
  store: WitnessStore,
  agentId: string,
  cap: number,
  dayKey = utcDayKey(),
): Promise<boolean> {
  const used = await store.incrDailyCredits(agentId, dayKey);
  return used <= cap;
}

export function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
