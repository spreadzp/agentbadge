/**
 * SLICE-201-1 (EPIC-201): universal task-model projection types.
 *
 * The EPIC-201 vocabulary (Task / Receipt / PaymentLeg) is a pure projection
 * over existing board records — nothing here mutates or replaces
 * BoardCardRecord/BoardEntryRecord (D-201-0: living protocol untouched,
 * D-201-3: doc-mapping, each context keeps its own language).
 *
 *   Task      = BoardCardRecord        (+ BoardEntry journal)
 *   Receipt   = TaskReceiptInput (SLICE-201-2 signs it, EIP-712 "AgentBadgeReceipt")
 *   Payment   = PaymentLeg (escrow/settle leg, ERC-8004 proofOfPayment fields)
 *
 * See docs/EPICS/201-agent-economy-interface/ADR-201-task-model.md.
 */
import { z } from "zod";
import type { BoardCardRecord, BoardEntryRecord } from "./types";

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Projected task — what the outside world sees of a board card. */
export const TaskSnapshotSchema = z.object({
  /** = BoardCardRecord.cardId */
  taskId: z.string().min(1),
  /** 1:1 onchain bounty reference. */
  bountyId: z.string().min(1),
  title: z.string().min(1),
  /** keccak256(spec) — immutable (D-199-4), equals onchain job specHash. */
  specHash: z.string().regex(HEX32),
  /** Full spec text — immutable after create. */
  spec: z.string(),
  /** USDC budget as decimal string; null when not set. */
  budgetUsdc: z.string().nullable(),
  /** BoardColumn mapped verbatim — journal is source of truth. */
  status: z.enum([
    "todo",
    "in_progress",
    "testing",
    "review",
    "done",
    "bug",
    "cancelled",
  ]),
  /** Active executor's passport (BoardCard.currentPassportId or latest claim). */
  executorPassportId: z.string().nullable(),
  /** Highest attempt index seen in the journal; 0 when no entries. */
  latestAttempt: z.number().int().nonnegative(),
  createdBy: z.string().optional(),
  /** ISO timestamp. */
  createdAt: z.string().regex(ISO),
});
export type TaskSnapshot = z.infer<typeof TaskSnapshotSchema>;

/** One settlement leg — ERC-8004 `proofOfPayment`-compatible shape. */
export const PaymentLegSchema = z.object({
  from: z.string().regex(ADDRESS),
  to: z.string().regex(ADDRESS),
  amountUsdc: z.string().min(1),
  chainId: z.number().int().positive(),
  txHash: z.string().regex(HEX32),
});
export type PaymentLeg = z.infer<typeof PaymentLegSchema>;

/**
 * Everything SLICE-201-2 needs to sign a receipt — assembled on the fly from
 * card + journal + verdict + settlement (no new store, D-201-2).
 */
export const TaskReceiptInputSchema = z.object({
  task: TaskSnapshotSchema,
  /** Attempt this receipt settles (journal attempt index). */
  attempt: z.number().int().positive(),
  /** ISO completion timestamp (done-entry atMs). */
  completedAt: z.string().regex(ISO),
  /** All chain tx hashes involved (createJob/submit/complete/refund). */
  txHashes: z.array(z.string().regex(HEX32)),
  /** EIP-712 VerdictArtifact id when evaluation happened. */
  verdictId: z.string().regex(HEX32).optional(),
  /** keccak256 of the submitted deliverable (evidence binding). */
  deliverableHash: z.string().regex(HEX32).optional(),
  payment: PaymentLegSchema.optional(),
});
export type TaskReceiptInput = z.infer<typeof TaskReceiptInputSchema>;

/**
 * Pure projection: BoardCardRecord (+ optional journal) → TaskSnapshot.
 * Executor falls back to the actor of the most recent `claim` entry when
 * `currentPassportId` is unset (card reopened / executor released).
 */
export function toTaskSnapshot(
  card: BoardCardRecord,
  entries: BoardEntryRecord[] = [],
): TaskSnapshot {
  const claims = entries
    .filter((e) => e.kind === "claim")
    .sort((a, b) => b.seq - a.seq);
  const latestAttempt = entries.reduce((m, e) => Math.max(m, e.attempt), 0);
  return {
    taskId: card.cardId,
    bountyId: card.bountyId,
    title: card.title,
    specHash: card.specHash,
    spec: card.spec,
    budgetUsdc: card.budgetUsdc ?? null,
    status: card.column,
    executorPassportId: card.currentPassportId ?? claims[0]?.actor ?? null,
    latestAttempt,
    ...(card.createdBy !== undefined ? { createdBy: card.createdBy } : {}),
    createdAt: card.createdAt,
  };
}
