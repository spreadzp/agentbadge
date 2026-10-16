/**
 * SLICE-199-13: per-kind leg handlers for the ChainTxOutbox dispatcher
 * (split out of dispatch.ts for the 300-line cap). Each handler
 * pre-flights onchain state and composes only the MISSING legs — a
 * resend after crash between broadcast and patch is a no-op on the
 * already-executed legs (D-199-7 reconciler duty).
 */
import { parseUnits, type Hex } from "viem";

import type { BountyRecord } from "../bounties/types";
import { getBounty, getClaim, upsertBounty } from "../bounties/store";
import type { VenueNetwork } from "../venue/chain";
import { sendAsRole, serverRoleAddress, type VenueRole } from "../venue/lifecycle-sign";
import type { PreparedTx } from "../venue/lifecycle";
import { buildClientRatingTx } from "../venue/reputation";

import type { BoardStoreBackend } from "./store";
import type { ChainTxOutboxRecord } from "./types";
import type { DispatchDeps } from "./dispatch";
import {
  decodeRefJobId,
  readRefJob,
  refApproveFundTxs,
  refClaimRefundTx,
  refCompleteTx,
  refCreateJobTx,
  refRejectTx,
  refSetBudgetTx,
  refSetProviderTx,
  refSetPayoutReceiverTx,
  refSubmitTx,
  REF_STATUS,
  ZERO_ADDR,
  type RefJob,
} from "./erc8183-ref";

const ERR_NO_SIGNER = "no server signer for role";

export interface SendStep { role: VenueRole; txs: PreparedTx[] }

export interface LegResult { hash: string | null; noop?: boolean; err?: string }

const ok = (hash: string): LegResult => ({ hash });
const noop = (): LegResult => ({ hash: null, noop: true });
const fail = (err: string): LegResult => ({ hash: null, err });

export const nowOf = (d: DispatchDeps) => (d.now ?? Date.now)();
export const sendTxs = (d: DispatchDeps, r: VenueRole, t: PreparedTx[], n: VenueNetwork) =>
  (d.sendTxs ?? ((rr, tt, nn) => sendAsRole(rr, tt, nn.chain.rpcUrl)))(r, t, n);
export const readJob = (d: DispatchDeps, j: bigint, n: VenueNetwork) =>
  (d.readJob ?? readRefJob)(j, n);
export const decodeJob = (d: DispatchDeps, h: Hex, n: VenueNetwork) =>
  (d.decodeJobId ?? decodeRefJobId)(h, n);

/** USDC amount for fund/setBudget — 6-decimal ERC-20 on Arc. */
const usdcAmount = (budgetUsdc: string | null | undefined): bigint =>
  parseUnits(String(budgetUsdc ?? "0"), 6);

/**
 * Compose the bind+fund legs that are still missing for `job`.
 * Called by setProvider/fund/submit rows — identical pre-flight.
 */
async function bindFundSteps(
  deps: DispatchDeps,
  net: VenueNetwork,
  bounty: BountyRecord,
  job: RefJob | null,
  payoutWallet: `0x${string}`,
  providerEoa: `0x${string}`,
): Promise<{ steps: SendStep[]; err?: string }> {
  const steps: SendStep[] = [];
  const token = net.chain.usdc;
  const amount = usdcAmount(bounty.budgetUsdc);
  const providerBound =
    !!job && job.provider.toLowerCase() !== ZERO_ADDR;

  const jobId = BigInt(bounty.onchainJobId!);
  const budgetSet =
    !!job && job.paymentToken.toLowerCase() !== ZERO_ADDR && job.budget > 0n;
  if (!providerBound) {
    // client binds the server provider EOA (+ optional ERC-8004 agentId
    // when the claim carries one — 0 is allowed).
    const agentId = 0n;
    steps.push({
      role: "client",
      txs: [refSetProviderTx(net, jobId, providerEoa, agentId)],
    });
  }
  if (!providerBound || !budgetSet) {
    // provider then points payout at the agent wallet + sets price.
    // Runs whenever the provider leg is missing or half-done — a bound
    // provider with budget=0/token=0x0 leaves fund() reverting on the
    // expectedToken != job.token mismatch (crash-mid-composite).
    steps.push({
      role: "provider",
      txs: [
        refSetPayoutReceiverTx(net, jobId, payoutWallet),
        refSetBudgetTx(net, jobId, token, amount),
      ],
    });
  }

  if (!job || job.status === REF_STATUS.Open) {
    steps.push({
      role: "client",
      txs: refApproveFundTxs(net, jobId, token, amount),
    });
  }
  return { steps };
}

export async function handleCreateJob(
  deps: DispatchDeps,
  st: BoardStoreBackend,
  net: VenueNetwork,
  row: ChainTxOutboxRecord,
): Promise<LegResult> {
  const bounty = getBounty(row.payload?.bountyId as string);
  if (!bounty) return fail(`bounty ${row.payload?.bountyId} not found`);
  if (bounty.onchainJobId) return noop(); // already created → confirm only
  const evaluator = serverRoleAddress("evaluator") ?? serverRoleAddress("client");
  if (!evaluator) return fail(ERR_NO_SIGNER + ": evaluator");
  const providerEoa = serverRoleAddress("provider");
  if (!providerEoa) return fail(ERR_NO_SIGNER + ": provider");
  if (evaluator.toLowerCase() === providerEoa.toLowerCase()) {
    return fail("provider == evaluator EOA — contract reverts ProviderCannotBeEvaluator");
  }
  // Job TTL: reuse claim lease ttl when absent — 2h covers e2e windows.
  const leaseMs = Number(process.env.BOARD_JOB_TTL_MS ?? 2 * 60 * 60 * 1000);
  const expiredAt = BigInt(Math.floor((nowOf(deps) + leaseMs) / 1000));
  const tx = refCreateJobTx(net, {
    provider: ZERO_ADDR,
    evaluator,
    expiredAtSec: expiredAt,
    description: `board:${row.cardId ?? bounty.bountyId}`,
  });
  const hashes = await sendTxs(deps, "client", [tx], net);
  if (!hashes?.length) return fail("createJob send failed");
  const jobId = await decodeJob(deps, hashes[0], net);
  if (jobId) upsertBounty({ ...bounty, onchainJobId: jobId.toString() });
  return ok(hashes[0]);
}

export async function handleBindOrFund(
  deps: DispatchDeps,
  st: BoardStoreBackend,
  net: VenueNetwork,
  row: ChainTxOutboxRecord,
): Promise<LegResult> {
  const bounty = cardBounty(row, st);
  if (!bounty) return fail("bounty for card not found");
  if (!bounty.onchainJobId) {
    const r = await handleCreateJob(deps, st, net, {
      ...row,
      payload: { ...row.payload, bountyId: bounty.bountyId },
    });
    if (r.err || !r.hash) return fail(r.err ?? "createJob leg failed");
  }
  const job = await readJob(deps, BigInt(bounty.onchainJobId!), net);
  if (!job) return fail(`getJob(${bounty.onchainJobId}) failed`);
  if (job.status >= REF_STATUS.Submitted) return noop(); // already past bind+fund
  const claim = getClaim(bounty.bountyId, bounty.jobAttempt);
  const payout = (row.payload?.payoutWallet as `0x${string}` | undefined) ??
    (claim?.payoutWallet as `0x${string}` | undefined);
  if (!payout) return fail("no payoutWallet (claim missing)");
  const providerEoa = serverRoleAddress("provider") as `0x${string}` | null;
  if (!providerEoa) return fail(ERR_NO_SIGNER + ": provider");
  const { steps } = await bindFundSteps(deps, net, bounty, job, payout, providerEoa);
  const hash = await runSteps(deps, net, steps);
  return hash ? ok(hash) : fail("bind/fund send failed");
}

export async function handleSubmit(
  deps: DispatchDeps,
  st: BoardStoreBackend,
  net: VenueNetwork,
  row: ChainTxOutboxRecord,
): Promise<LegResult> {
  const bounty = cardBounty(row, st);
  if (!bounty?.onchainJobId) return fail("no onchainJobId");
  const jobId = BigInt(bounty.onchainJobId);
  const job = await readJob(deps, jobId, net);
  if (!job) return fail(`getJob(${jobId}) failed`);
  if (job.status >= REF_STATUS.Submitted) return noop();

  const steps: SendStep[] = [];
  if (job.status === REF_STATUS.Open) {
    // Job unbound/unfunded → the submit row carries the whole leg
    // (spec: "ops setProvider+fund → agent submit (ops-signed)").
    const claim = getClaim(bounty.bountyId, bounty.jobAttempt);
    const payout = (row.payload?.payoutWallet as `0x${string}` | undefined) ??
      (claim?.payoutWallet as `0x${string}` | undefined);
    if (!payout) return fail("no payoutWallet (claim missing)");
    const providerEoa = serverRoleAddress("provider") as `0x${string}` | null;
    if (!providerEoa) return fail(ERR_NO_SIGNER + ": provider");
    const { steps: bind } = await bindFundSteps(deps, net, bounty, job, payout, providerEoa);
    steps.push(...bind);
  }
  steps.push({
    role: "provider",
    txs: [refSubmitTx(net, jobId, (row.payload?.deliverableHash as Hex) ?? "0x")],
  });
  const hash = await runSteps(deps, net, steps);
  return hash ? ok(hash) : fail("submit leg send failed");
}

export async function handleReviewTx(
  deps: DispatchDeps,
  st: BoardStoreBackend,
  net: VenueNetwork,
  row: ChainTxOutboxRecord,
): Promise<LegResult> {
  const bounty = cardBounty(row, st);
  const jobId = row.payload?.jobId ?? bounty?.onchainJobId;
  if (!jobId) return fail("no jobId");
  const job = await readJob(deps, BigInt(String(jobId)), net);
  if (job && job.status >= REF_STATUS.Completed) return noop();
  const reason = (row.payload?.reasonHash as Hex) ??
    (("0x" + "00".repeat(32)) as Hex);
  const tx =
    row.kind === "complete"
      ? refCompleteTx(net, BigInt(String(jobId)), reason)
      : refRejectTx(net, BigInt(String(jobId)), reason);
  const hashes = await sendTxs(deps, "evaluator", [tx], net);
  if (!hashes?.length) return fail(`${row.kind} send failed`);
  return ok(hashes[0]);
}

export async function handleClaimRefund(
  deps: DispatchDeps,
  st: BoardStoreBackend,
  net: VenueNetwork,
  row: ChainTxOutboxRecord,
): Promise<LegResult> {
  const bounty = cardBounty(row, st);
  const jobId = row.payload?.jobId ?? bounty?.onchainJobId;
  if (!jobId) return fail("no jobId");
  const job = await readJob(deps, BigInt(String(jobId)), net);
  if (!job) return fail(`getJob(${jobId}) unreadable`);
  // Only a Funded job has escrow worth reclaiming. Open jobs (never
  // bound/funded — the usual claim-expiry state) and terminal states
  // are no-ops; a Submitted job forfeits via evaluator reject instead.
  if (job.status !== REF_STATUS.Funded) return noop();
  const hashes = await sendTxs(deps, "client", [
    refClaimRefundTx(net, BigInt(String(jobId))),
  ], net);
  if (!hashes?.length) return fail("claimRefund send failed");
  return ok(hashes[0]);
}

export async function handleGiveFeedback(
  deps: DispatchDeps,
  st: BoardStoreBackend,
  net: VenueNetwork,
  row: ChainTxOutboxRecord,
): Promise<LegResult> {
  const p = row.payload ?? {};
  if (p.agentId == null) return fail("giveFeedback payload missing agentId");
  const tx = buildClientRatingTx(net, {
    agentId: BigInt(String(p.agentId)),
    value: BigInt(String(p.value ?? 0)),
    decimals: Number(p.decimals ?? 0),
    tag1: String(p.tag1 ?? "board"),
    tag2: String(p.tag2 ?? ""),
    endpoint: `/board/cards/${row.cardId ?? ""}`,
    feedbackURI: String(p.feedbackURI ?? ""),
    hash: (p.hash as Hex) ?? undefined,
  });
  const hashes = await sendTxs(deps, "client", [tx], net);
  if (!hashes?.length) return fail("giveFeedback send failed");
  return ok(hashes[0]);
}

/** Look up the card's bounty row — card.bountyId or cardId==bountyId. */
function cardBounty(
  row: ChainTxOutboxRecord,
  st: BoardStoreBackend,
): BountyRecord | undefined {
  const direct = row.payload?.bountyId as string | undefined;
  if (direct) return getBounty(direct);
  if (!row.cardId) return undefined;
  const card = st.getCard(row.cardId);
  const bountyId = (card?.bountyId ?? row.cardId) as string;
  return getBounty(bountyId);
}

async function runSteps(
  deps: DispatchDeps,
  net: VenueNetwork,
  steps: SendStep[],
): Promise<string | null> {
  let last: Hex | null = null;
  for (const step of steps) {
    const hashes = await sendTxs(deps, step.role, step.txs, net);
    if (!hashes?.length) return null;
    last = hashes[hashes.length - 1];
  }
  return last;
}
