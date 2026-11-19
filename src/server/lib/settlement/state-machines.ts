/**
 * EPIC-227 / SLICE-227-2 — settlement transition tables: the legality
 * authority for every settlement status write (stores only serialize
 * concurrent writers via guarded updates).
 *
 * Also hosts the event hash-chain primitives: SHA-256 over canonical
 * JSON with prevHash→hash linkage per entity stream — the SLICE-224-2
 * pattern, self-contained here because the settlement domain must not
 * import commerce (slice rule).
 */
import { createHash } from "node:crypto";

import type { SettlementEntityType } from "./types";

// ---------- transition tables ----------

const TRANSITIONS: Record<
  SettlementEntityType,
  ReadonlyMap<string, readonly string[]>
> = {
  settlement_plan: new Map([
    // DISPUTED→ACTIVE restores on resolve; COMPLETED when every
    // milestone reached a terminal state.
    ["ACTIVE", ["DISPUTED", "COMPLETED", "CANCELLED"]],
    ["DISPUTED", ["ACTIVE", "COMPLETED", "CANCELLED"]],
    ["COMPLETED", []],
    ["CANCELLED", []],
  ]),
  milestone: new Map([
    // PENDING→READY (work submitted), READY→APPROVED (release policy
    // met) → RELEASED when all intent legs completed. DISPUTED from any
    // pre-release state; resolution returns to the pre-dispute status
    // (stored on the dispute row) or CANCELLED for FOR_BUYER.
    // READY→PENDING releases a milestone whose bound submission was
    // rejected (R4-M5 resubmission round); APPROVED→READY/PENDING reverts
    // an approval whose commerce verdict never committed (R4-H1, direct
    // to PENDING when the committed verdict was a reject) — both are
    // bridge/operator-only edges, never participant paths.
    ["PENDING", ["READY", "DISPUTED", "CANCELLED"]],
    ["READY", ["APPROVED", "DISPUTED", "CANCELLED", "PENDING"]],
    ["APPROVED", ["RELEASED", "DISPUTED", "CANCELLED", "READY", "PENDING"]],
    ["DISPUTED", ["PENDING", "READY", "APPROVED", "CANCELLED"]],
    ["RELEASED", []],
    ["CANCELLED", []],
  ]),
  payout_intent: new Map([
    // Dispute freezes OPEN intents; resolution unfreezes or cancels.
    // CANCELLED→OPEN re-opens a never-paid intent that an approval
    // revert cancelled (R5-H1) — only legal while every leg is
    // unpaid, enforced in doApprove.
    ["OPEN", ["FROZEN", "COMPLETED", "CANCELLED"]],
    ["FROZEN", ["OPEN", "CANCELLED"]],
    // FAILED is reserved (seam) — terminal, no incoming edges in v1.
    ["COMPLETED", []],
    ["FAILED", []],
    ["CANCELLED", ["OPEN"]],
  ]),
  payout_leg: new Map([
    ["OPEN", ["FROZEN", "COMPLETED", "CANCELLED"]],
    ["FROZEN", ["OPEN", "CANCELLED"]],
    ["COMPLETED", []],
    ["FAILED", []],
    ["CANCELLED", ["OPEN"]],
  ]),
  settlement_dispute: new Map([
    ["OPEN", ["RESOLVED"]],
    ["RESOLVED", []],
  ]),
  settlement_anchor: new Map([
    ["PENDING", ["ANCHORED", "FAILED"]],
    ["FAILED", ["PENDING"]],
    ["ANCHORED", []],
  ]),
};

/** `true` when `from → to` is legal for the entity's table. */
export function isLegalTransition(
  entity: SettlementEntityType,
  from: string,
  to: string,
): boolean {
  return TRANSITIONS[entity].get(from)?.includes(to) ?? false;
}

/** Terminal states per entity — nothing can leave them. */
export function isTerminal(entity: SettlementEntityType, status: string) {
  return (TRANSITIONS[entity].get(status)?.length ?? 0) === 0;
}

// ---------- event hash-chain primitives ----------

/** Genesis sentinel for the first event of each entity stream. */
export const GENESIS_HASH = "0".repeat(64);

/** Sorted-key JSON — identical logical content hashes identically
 *  regardless of key order (mirrors the commerce emitter's shape). */
function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, canonicalize(o[k])]),
    );
  }
  return v;
}

export function canonicalJson(v: unknown): string {
  return JSON.stringify(canonicalize(v));
}

export interface EventHashInput {
  prevHash: string;
  entityType: string;
  entityId: string;
  eventType: string;
  actorWallet: string | null;
  payload: unknown;
}

/** SHA-256 over the canonical tuple — eventSeq excluded (assigned by
 *  the store after insert). */
export function hashEvent(input: EventHashInput): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}
