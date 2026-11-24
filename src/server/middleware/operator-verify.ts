/**
 * EPIC-264 (SLICE-264-8): the operatorAuth verdict as a callable —
 * key → credential row → {principal, operator} | typed refusal.
 *
 * operatorAuth composes this with its transport extraction and the
 * x-operator-id boundary rejection; the upgrade route (DID-or-admin
 * dual auth) calls it directly — there "not a valid operator" falls
 * through to the DID check instead of short-circuiting a 401.
 *
 * One verdict, one place: the timing-safe compare, dummy-digest pad,
 * malformed-row 500, status refusals, legacy-window fallback and the
 * throttled lastUsed touch all live here so no second consumer can
 * drift a weaker copy (audit lesson: duplicated auth diverges).
 */

import { timingSafeEqual } from "node:crypto";

import { ErrorCodes, type ErrorCode } from "../lib/error-codes";
import {
  hashAdminKey,
  type AdminOperator,
  type OperatorStore,
  type Principal,
} from "../lib/operators";
import { tryLegacySharedKey } from "./operator-legacy";

/** Minimum gap between lastUsedAt writes (D-264-Q6 — diagnostics, not auth). */
const LAST_USED_MIN_INTERVAL_MS = 5 * 60 * 1000;

// Constant-work pad for the unknown-key path: the digest compare runs
// even when the lookup missed — the oracle buys nothing against
// 192-bit keys behind a byte-identical envelope.
const DUMMY_DIGEST = Buffer.alloc(32);
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export type OperatorAuthVerdict =
  | { ok: true; principal: Principal; operator: AdminOperator }
  | { ok: false; status: 401 | 500; code: ErrorCode; message: string };

const refuse = (
  status: 401 | 500,
  code: ErrorCode,
  message: string,
): OperatorAuthVerdict => ({ ok: false, status, code, message });

const unauthorized = (): OperatorAuthVerdict =>
  refuse(401, ErrorCodes.UNAUTHORIZED, "Unauthorized");

export async function authenticateOperatorKey(
  store: OperatorStore,
  provided: string,
  surface: string,
): Promise<OperatorAuthVerdict> {
  const keyHash = hashAdminKey(provided);
  let pair;
  try {
    pair = await store.getOperatorByKeyHash(keyHash);
  } catch {
    // store failure is a typed 500 — never folded into a 401.
    return refuse(
      500,
      ErrorCodes.INTERNAL_ERROR,
      "Operator store unavailable",
    );
  }

  const stored = pair?.credential.keyHash;
  if (pair === null || stored === undefined) {
    timingSafeEqual(Buffer.from(keyHash, "hex"), DUMMY_DIGEST);
    // SLICE-264-5 dual-auth window: no credential row → the shared
    // ADMIN_API_KEY gets exactly one more verdict — a MARKED
    // break_glass principal, never a personal identity.
    const legacy = tryLegacySharedKey(provided, surface);
    if (!legacy.accepted) return unauthorized();
    return {
      ok: true,
      principal: legacy.principal,
      operator: legacy.operator,
    };
  }
  // A non-sha256 stored row is a data-integrity failure — loud 500.
  if (!SHA256_HEX_RE.test(stored)) {
    return refuse(
      500,
      ErrorCodes.INTERNAL_ERROR,
      "Credential store returned malformed keyHash",
    );
  }
  if (
    !timingSafeEqual(Buffer.from(stored, "hex"), Buffer.from(keyHash, "hex"))
  ) {
    return unauthorized();
  }
  // revoked credential / disabled operator — identical refusal.
  if (pair.credential.status !== "active" || pair.operator.status !== "active") {
    return unauthorized();
  }

  // Throttled fire-and-forget touch; NaN/future lastUsedAt self-heals.
  const nowMs = Date.now();
  const lastMs =
    pair.credential.lastUsedAt === null
      ? NaN
      : Date.parse(pair.credential.lastUsedAt);
  if (
    !Number.isFinite(lastMs) ||
    lastMs > nowMs ||
    nowMs - lastMs >= LAST_USED_MIN_INTERVAL_MS
  ) {
    try {
      void store
        .touchLastUsed(pair.credential.id, new Date(nowMs).toISOString())
        .catch(() => {});
    } catch {
      // diagnostics column never fails the request — even a
      // synchronously-throwing store impl is swallowed here
    }
  }

  const { operator, credential } = pair;
  return {
    ok: true,
    principal: {
      id: operator.id,
      principalType: operator.principalType,
      keyPrefix: credential.keyPrefix,
    },
    operator,
  };
}
