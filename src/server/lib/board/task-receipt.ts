/**
 * SLICE-201-2 (EPIC-201): Task Receipt — portable, EIP-712-signed proof that
 * a board task reached DONE. Built as a pure projection (D-201-2): card +
 * journal + outbox + reputation ledger — nothing is persisted.
 *
 * The signature covers a compact message: identity (taskId/bountyId/specHash),
 * attempt, `receiptHash` (keccak256 of the canonical public receipt body) and
 * issuedAt — so any tampering with agent/task/evidence/payment fields breaks
 * verifyTypedData recovery, mirroring the VerdictArtifact pattern (eaas).
 *
 * Determinism: issuedAt derives from the journal `done` entry timestamp, so a
 * repeat build of the same terminal card yields the identical signature.
 */
import type { Hex } from "viem";
import { keccak256, toBytes } from "viem";
import { ethers } from "ethers";

import { canonicalJson } from "../eaas/verdict";
import { boardStore, type BoardStoreBackend } from "./store";
import { toTaskSnapshot } from "./task-model";
import { TaskReceiptInputSchema, type PaymentLeg } from "./task-model";

export const RECEIPT_DOMAIN_NAME = "AgentBadgeReceipt";
export const RECEIPT_DOMAIN_VERSION = "1";
/** Offchain-verified artifact — zero-address sentinel (verdict precedent). */
export const RECEIPT_VERIFYING_CONTRACT =
  "0x0000000000000000000000000000000000000000";
export const RECEIPT_SCHEMA_ID = "agentbadge/task-receipt@1";

const RECEIPT_TYPE = [
  { name: "taskId", type: "string" },
  { name: "bountyId", type: "string" },
  { name: "specHash", type: "bytes32" },
  { name: "attempt", type: "uint256" },
  { name: "receiptHash", type: "bytes32" },
  { name: "issuedAt", type: "string" },
  { name: "chainId", type: "uint256" },
] as const;

export function buildReceiptDomain(chainId: number) {
  return {
    name: RECEIPT_DOMAIN_NAME,
    version: RECEIPT_DOMAIN_VERSION,
    chainId,
    verifyingContract: RECEIPT_VERIFYING_CONTRACT,
  };
}

/** EIP-712 message actually signed — all other fields are hash-bound. */
export interface ReceiptSigningBody {
  taskId: string;
  bountyId: string;
  specHash: Hex;
  attempt: bigint;
  receiptHash: Hex;
  issuedAt: string;
  chainId: bigint;
}

export interface TaskReceipt {
  schema: typeof RECEIPT_SCHEMA_ID;
  agent: {
    agentRegistry: string;
    agentId: string | null;
    passportId: string | null;
  };
  task: {
    id: string;
    bountyId: string;
    title: string;
    specHash: string;
    spec: string;
    status: "done";
    attempt: number;
    executorPassportId: string | null;
    createdAt: string;
    completedAt: string;
  };
  evidence: {
    txHashes: string[];
    verdictId?: string;
    deliverableHash?: string;
  };
  payment?: PaymentLeg;
  /** Signer EOA — EIP-712 recover must equal this. */
  signer: string;
  chainId: number;
  issuedAt: string;
  signature: Hex;
  /** The EIP-712 message — what the signature actually covers. */
  body: ReceiptSigningBody;
}

export interface ReceiptSigner {
  address: string;
  chainId: number;
  sign(body: ReceiptSigningBody): Promise<Hex>;
}

/** EIP-712 signer for the receipt EOA (ARC_RECEIPT_SIGNER_KEY seam). */
export function createReceiptSigner(
  privateKey: string,
  chainId: number,
): ReceiptSigner {
  const wallet = new ethers.Wallet(privateKey);
  const types = { TaskReceipt: [...RECEIPT_TYPE] };
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

export interface BuildReceiptDeps {
  signer: ReceiptSigner;
  chainId: number;
  agentRegistry: string;
  /** Escrow contract — receipt `payment.fromAddress`. */
  escrowAddress: string;
  /** Injectable store (tests); defaults to the singleton. */
  store?: BoardStoreBackend;
}

export type BuildReceiptResult =
  | TaskReceipt
  | null
  | { error: "not-terminal" };

/**
 * Assemble and sign the receipt for a DONE card. Returns null when the card
 * does not exist; `{error:"not-terminal"}` when it exists but is not DONE.
 */
export async function buildTaskReceipt(
  cardId: string,
  deps: BuildReceiptDeps,
): Promise<BuildReceiptResult> {
  const st = deps.store ?? boardStore();
  await st.ready();
  const card = st.getCard(cardId);
  if (!card) return null;
  if (card.column !== "done") return { error: "not-terminal" };

  const entries = st.listEntries(card.cardId);
  const snap = toTaskSnapshot(card, entries);
  const doneEntry = [...entries].reverse().find((e) => e.kind === "done");
  const completedAt = doneEntry
    ? new Date(doneEntry.atMs).toISOString()
    : card.createdAt;
  const attempt = doneEntry?.attempt ?? snap.latestAttempt ?? 1;

  // Evidence: every chain leg — entry txHashes + confirmed outbox sends.
  const outbox = st.listOutbox({ cardId: card.cardId });
  const txHashes = [
    ...new Set(
      [
        ...entries.map((e) => e.txHash),
        ...outbox.map((o) => o.txHash),
      ].filter((t): t is string => typeof t === "string"),
    ),
  ];
  const evidence: TaskReceipt["evidence"] = { txHashes };
  const reviewEntry = [...entries].reverse().find((e) => e.kind === "review");
  const verdictId = reviewEntry?.payload?.verdictId;
  if (typeof verdictId === "string") evidence.verdictId = verdictId;
  const deliverableHash = entries
    .map((e) => e.payload?.deliverableHash)
    .find((v): v is string => typeof v === "string");
  if (deliverableHash) evidence.deliverableHash = deliverableHash;

  // Payment leg: settle outbox (complete) + claim payoutWallet.
  const settle = outbox.find((o) => o.kind === "complete" && o.txHash);
  const lastClaim = [...entries].reverse().find((e) => e.kind === "claim");
  const payoutWallet = lastClaim?.payload?.payoutWallet;
  const payment: PaymentLeg | undefined =
    settle?.txHash && typeof payoutWallet === "string"
      ? {
        from: deps.escrowAddress,
        to: payoutWallet,
        amountUsdc: card.budgetUsdc ?? "0",
        chainId: deps.chainId,
        txHash: settle.txHash,
      }
      : undefined;

  const reputation = st.getReputation("board", card.cardId, attempt);
  const agent = {
    agentRegistry: deps.agentRegistry,
    agentId: reputation?.agentId ?? null,
    passportId: snap.executorPassportId,
  };

  const task = {
    id: card.cardId,
    bountyId: card.bountyId,
    title: card.title,
    specHash: card.specHash,
    spec: card.spec,
    status: "done" as const,
    attempt,
    executorPassportId: snap.executorPassportId,
    createdAt: card.createdAt,
    completedAt,
  };

  // receiptHash binds every public field — the signature need not repeat them.
  const publicBody = {
    schema: RECEIPT_SCHEMA_ID as typeof RECEIPT_SCHEMA_ID,
    agent,
    task,
    evidence,
    ...(payment ? { payment } : {}),
    signer: deps.signer.address,
    chainId: deps.chainId,
    issuedAt: completedAt,
  };
  const receiptHash = keccak256(toBytes(canonicalJson(publicBody)));

  const body: ReceiptSigningBody = {
    taskId: card.cardId,
    bountyId: card.bountyId,
    specHash: card.specHash as Hex,
    attempt: BigInt(attempt),
    receiptHash,
    issuedAt: completedAt,
    chainId: BigInt(deps.chainId),
  };
  const signature = await deps.signer.sign(body);

  // Sanity: the public part must satisfy the SLICE-201-1 receipt schema.
  TaskReceiptInputSchema.parse({
    task: snap,
    attempt,
    completedAt,
    txHashes,
    ...(evidence.verdictId ? { verdictId: evidence.verdictId } : {}),
    ...(evidence.deliverableHash
      ? { deliverableHash: evidence.deliverableHash }
      : {}),
    ...(payment ? { payment } : {}),
  });

  return { ...publicBody, signature, body };
}

/**
 * Offline verification — recover the EIP-712 signer and compare with
 * receipt.signer. Any tampering (fields, hash, timestamps) changes the
 * digest → different recovered address → false. Mirrors verifyVerdictSignature.
 */
export function verifyTaskReceiptSignature(receipt: TaskReceipt): boolean {
  try {
    const recovered = ethers.verifyTypedData(
      buildReceiptDomain(receipt.chainId),
      { TaskReceipt: [...RECEIPT_TYPE] },
      receipt.body,
      receipt.signature,
    );
    return recovered.toLowerCase() === receipt.signer.toLowerCase();
  } catch {
    return false;
  }
}
