/**
 * EPIC-227 / SLICE-227-4 — `agentbadge/settlement-receipt@1` artifact.
 *
 * Deterministic EIP-712 receipt over a plan's payout state, after the
 * task-receipt pattern (SLICE-201, D-227-8):
 *
 *   publicBody (sorted milestones/legs, fixed field order)
 *     → canonicalJson → keccak256 → receiptHash
 *     → sign {agreementId, receiptHash, issuedAt, chainId} under the
 *       shared AgentBadgeReceipt domain → signature + body
 *
 * Determinism: every field comes from stored rows in stable order —
 * `issuedAt` is the completedAt of the last COMPLETED leg (never a
 * wall clock), so a rebuild over the same state is byte-identical.
 *
 * The artifact builds once ≥1 leg is COMPLETED; unreleased legs are
 * included with txHash null — the receipt is a statement of observed
 * payout state, never a claim about unsettled work.
 */
import { keccak256, toBytes } from "viem";
import { ethers } from "ethers";
import type { Hex } from "viem";

import { buildReceiptDomain } from "../board/task-receipt.js";
import { canonicalJson } from "../eaas/verdict.js";
import type { SettlementCtx } from "./services/ctx.js";
import { fail, ok, type SettlementResult } from "./types.js";

export const SETTLEMENT_RECEIPT_SCHEMA_ID = "agentbadge/settlement-receipt@1";

const RECEIPT_TYPE = [
  { name: "agreementId", type: "string" },
  { name: "receiptHash", type: "bytes32" },
  { name: "issuedAt", type: "string" },
  { name: "chainId", type: "uint256" },
] as const;

/** EIP-712 message actually signed — the public body is hash-bound. */
export interface SettlementReceiptSigningBody {
  agreementId: string;
  receiptHash: Hex;
  issuedAt: string;
  chainId: bigint;
}

export interface SettlementReceiptLeg {
  payee: string;
  amountUsdc: string;
  role: string;
  status: string;
  network: string | null;
  txHash: string | null;
}

export interface SettlementReceiptMilestone {
  milestoneId: string;
  seq: number;
  amountUsd: string;
  status: string;
  intentId: string | null;
  legs: SettlementReceiptLeg[];
}

/** The hash-bound public part — also what external verifiers validate
 *  against `/.well-known/settlement-receipt.schema.json`. */
export interface SettlementReceiptPublic {
  schema: typeof SETTLEMENT_RECEIPT_SCHEMA_ID;
  agreement: {
    ref: string;
    planId: string;
    status: string;
    currency: string;
    totalUsd: string;
    buyerWallet: string;
    providerWallet: string;
  };
  milestones: SettlementReceiptMilestone[];
  signer: string;
  chainId: number;
  /** ISO timestamp of the last COMPLETED leg — stored state, not clock. */
  issuedAt: string;
}

export interface SettlementReceipt extends SettlementReceiptPublic {
  signature: Hex;
  /** The EIP-712 message — what the signature actually covers. */
  body: SettlementReceiptSigningBody;
}

export interface SettlementReceiptSigner {
  address: string;
  chainId: number;
  sign(body: SettlementReceiptSigningBody): Promise<Hex>;
}

/** Settlement EIP-712 signer (ARC_RECEIPT_SIGNER_KEY seam, same EOA
 *  family as task receipts — typed name/fields differ). */
export function createSettlementReceiptSigner(
  privateKey: string,
  chainId: number,
): SettlementReceiptSigner {
  const wallet = new ethers.Wallet(privateKey);
  const types = { SettlementReceipt: [...RECEIPT_TYPE] };
  return {
    address: wallet.address,
    chainId,
    async sign(body) {
      return (await wallet.signTypedData(
        buildReceiptDomain(body.chainId as unknown as number),
        types,
        body,
      )) as Hex;
    },
  };
}

/**
 * The canonical public body + receiptHash for a plan — no signing.
 * `signerAddress`/`chainId` are part of the hash-bound body, so an
 * anchor keyed to a different signer binds a different receipt.
 */
export async function buildReceiptPublic(
  ctx: SettlementCtx,
  agreementRef: string,
  deps: { signerAddress: string; chainId: number },
): Promise<
  SettlementResult<{
    publicBody: SettlementReceiptPublic;
    receiptHash: Hex;
  }>
> {
  const plan = await ctx.db.settlement.plans.getByAgreement(agreementRef);
  if (!plan) {
    return fail("NOT_FOUND", `settlement plan not found: ${agreementRef}`);
  }
  const rows = await ctx.db.settlement.milestones.listByPlan(plan.id);
  const milestones: SettlementReceiptMilestone[] = [];
  let lastCompletedMs: number | null = null;
  for (const m of [...rows].sort((a, b) => a.seq - b.seq)) {
    const intent = await ctx.db.settlement.payoutIntents.getByMilestone(m.id);
    const legs = intent
      ? [...(await ctx.db.settlement.payoutLegs.listByIntent(intent.id))].sort(
          (a, b) => a.id.localeCompare(b.id),
        )
      : [];
    for (const l of legs) {
      if (l.status === "COMPLETED" && typeof l.completedAtMs === "number") {
        lastCompletedMs = Math.max(lastCompletedMs ?? 0, l.completedAtMs);
      }
    }
    milestones.push({
      milestoneId: m.milestoneId,
      seq: m.seq,
      amountUsd: m.amountUsd,
      status: m.status,
      intentId: intent?.id ?? null,
      legs: legs.map((l) => ({
        payee: l.payee,
        amountUsdc: l.amountUsdc,
        role: l.role,
        status: l.status,
        network: l.network ?? null,
        txHash: l.txHash ?? null,
      })),
    });
  }
  if (lastCompletedMs === null) {
    return fail(
      "INVALID_STATE",
      "no completed payout legs — nothing settled to receipt",
    );
  }
  const publicBody: SettlementReceiptPublic = {
    schema: SETTLEMENT_RECEIPT_SCHEMA_ID,
    agreement: {
      ref: plan.agreementRef,
      planId: plan.id,
      status: plan.status,
      currency: plan.currency ?? "USDC",
      totalUsd: plan.totalUsd,
      buyerWallet: plan.buyerWallet,
      providerWallet: plan.providerWallet,
    },
    milestones,
    signer: deps.signerAddress,
    chainId: deps.chainId,
    issuedAt: new Date(lastCompletedMs).toISOString(),
  };
  return ok({
    publicBody,
    receiptHash: keccak256(toBytes(canonicalJson(publicBody))),
  });
}

/** Assemble and sign the settlement receipt for an agreement. */
export async function buildSettlementReceipt(
  ctx: SettlementCtx,
  agreementRef: string,
  deps: { signer: SettlementReceiptSigner; chainId: number },
): Promise<SettlementResult<SettlementReceipt>> {
  const built = await buildReceiptPublic(ctx, agreementRef, {
    signerAddress: deps.signer.address,
    chainId: deps.chainId,
  });
  if (!built.ok) return built;
  const { publicBody, receiptHash } = built.value;
  const body: SettlementReceiptSigningBody = {
    agreementId: agreementRef,
    receiptHash,
    issuedAt: publicBody.issuedAt,
    chainId: BigInt(deps.chainId),
  };
  const signature = await deps.signer.sign(body);
  return ok({ ...publicBody, signature, body });
}

/** JSON-safe wire form — `body.chainId` is BigInt and cannot serialize. */
export function settlementReceiptToJson(r: SettlementReceipt) {
  return {
    ...r,
    body: { ...r.body, chainId: String(r.body.chainId) },
  };
}

/**
 * Offline verification — TWO checks, both required:
 *  1. the public body re-hashes to `body.receiptHash` (tamper with any
 *     public field → hash mismatch → false);
 *  2. the EIP-712 signature recovers to `receipt.signer` under the
 *     shared AgentBadgeReceipt domain.
 */
export function verifySettlementReceiptSignature(
  receipt: SettlementReceipt,
  expectedSigner?: string,
): boolean {
  try {
    const { signature, body, ...publicPart } = receipt;
    const recomputed = keccak256(toBytes(canonicalJson(publicPart)));
    if (recomputed.toLowerCase() !== body.receiptHash.toLowerCase()) {
      return false;
    }
    // M6: signature-bound fields must agree with the hash-bound public
    // part, and the caller must pin the expected signer — recovering
    // against the embedded `signer` proves consistency, not
    // authenticity (any key can mint a self-consistent receipt).
    if (
      body.agreementId !== receipt.agreement.ref ||
      body.issuedAt !== receipt.issuedAt ||
      body.chainId !== BigInt(receipt.chainId)
    ) {
      return false;
    }
    if (
      expectedSigner !== undefined &&
      receipt.signer.toLowerCase() !== expectedSigner.toLowerCase()
    ) {
      return false;
    }
    const recovered = ethers.verifyTypedData(
      buildReceiptDomain(receipt.chainId),
      { SettlementReceipt: [...RECEIPT_TYPE] },
      body,
      signature,
    );
    return recovered.toLowerCase() === receipt.signer.toLowerCase();
  } catch {
    return false;
  }
}
