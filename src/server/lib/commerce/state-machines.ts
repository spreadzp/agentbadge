/**
 * SLICE-224-2 (EPIC-224): transition tables — the legality authority for
 * every commerce status write (stores only serialize concurrent writers
 * via guarded applyStatus).
 *
 * Also hosts the event-hash primitives: canonical JSON + SHA-256 chain
 * (D-224-7, EPIC-172 pattern). Kept here so both the state tables and the
 * chain stay one import for tests.
 */
import { createHash } from "node:crypto";

import type { CommerceEntityType } from "./types";
import { invalidTransition } from "./types";

// ---------- transition tables ----------

const TRANSITIONS: Record<CommerceEntityType, ReadonlyMap<string, readonly string[]>> = {
  task: new Map([
    ["DRAFT", ["OPEN", "CANCELLED"]],
    ["OPEN", ["IN_PROGRESS", "CANCELLED"]],
    ["IN_PROGRESS", ["SUBMITTED", "CANCELLED"]],
    ["SUBMITTED", ["UNDER_REVIEW", "CANCELLED"]],
    // rejected/revision → resubmission round keeps agreement ACTIVE
    ["UNDER_REVIEW", ["COMPLETED", "IN_PROGRESS", "CANCELLED"]],
    ["COMPLETED", []],
    ["CANCELLED", []],
  ]),
  offer: new Map([
    ["PENDING", ["ACCEPTED", "REJECTED", "WITHDRAWN"]],
    ["ACCEPTED", []],
    ["REJECTED", []],
    ["WITHDRAWN", []],
  ]),
  agreement: new Map([
    // DISPUTED reserved for future admin flow (D-224-5) — legal in the
    // table, unreachable from the service surface in v1.
    ["ACTIVE", ["COMPLETED", "CANCELLED", "DISPUTED"]],
    ["COMPLETED", []],
    ["CANCELLED", []],
    ["DISPUTED", []],
  ]),
  submission: new Map([
    ["SUBMITTED", ["ACCEPTED", "REJECTED", "REVISION_REQUIRED"]],
    ["ACCEPTED", []],
    ["REJECTED", []],
    ["REVISION_REQUIRED", []],
  ]),
  evidence: new Map<string, readonly string[]>([
    // append-only — evidence rows never transition
  ]),
  payment: new Map([
    ["NOT_PAID", ["PAYMENT_RECORDED"]],
    ["PAYMENT_RECORDED", ["PAYMENT_VERIFIED"]],
    ["PAYMENT_VERIFIED", []],
  ]),
};

/** Throws CommerceError INVALID_TRANSITION when `from → to` is not legal. */
export function assertTransition(
  entity: CommerceEntityType,
  from: string,
  to: string,
): void {
  const allowed = TRANSITIONS[entity].get(from);
  if (!allowed || !allowed.includes(to)) {
    throw invalidTransition(entity, from, to);
  }
}

export function isLegalTransition(
  entity: CommerceEntityType,
  from: string,
  to: string,
): boolean {
  return TRANSITIONS[entity].get(from)?.includes(to) ?? false;
}

// ---------- event hash-chain primitives ----------

/** Genesis sentinel for the first event of each entity stream. */
export const GENESIS_HASH = "0".repeat(64);

/**
 * Canonical JSON: sorted keys recursively — the hash input is identical
 * for identical logical content regardless of key order.
 */
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

/**
 * SHA-256 over the canonical tuple. eventSeq is intentionally excluded —
 * it's assigned by the DB after insert, so it can't be part of the hash.
 */
export function hashEvent(input: EventHashInput): string {
  return createHash("sha256")
    .update(canonicalJson(input))
    .digest("hex");
}
