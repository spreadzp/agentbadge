/**
 * EPIC-264 (SLICE-264-4): shared helpers for the operator admin
 * surfaces — response meta shapes (NO keyHash — the hash is an
 * auth secret-adjacent value, not display data), the idempotent
 * write path (runKnowledgeWrite precedent), the capability gate and
 * the structured attribution line (durable AdminAction rows land in
 * SLICE-264-7 with the principalId column, per D-264-Q1).
 */

import type { Context, Next } from "hono";
import { logger } from "@agentbadge/passport/logger";

import { requireCapability } from "../middleware/operatorAuth";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import {
  idempotentWrite,
  readIdempotencyKey,
  requestFingerprint,
} from "../lib/contract-guards";
import type {
  AdminOperator,
  AdminOperatorCredential,
  Principal,
} from "../lib/operators";

export const credMeta = (cred: AdminOperatorCredential) => ({
  id: cred.id,
  keyPrefix: cred.keyPrefix,
  status: cred.status,
  issuedAt: cred.issuedAt,
  revokedAt: cred.revokedAt,
  lastUsedAt: cred.lastUsedAt,
});

export const opMeta = (o: AdminOperator) => ({
  id: o.id,
  displayName: o.displayName,
  principalType: o.principalType,
  capabilities: o.capabilities,
  status: o.status,
  createdAt: o.createdAt,
  disabledAt: o.disabledAt,
});

/** Structured attribution line — principal.id, never the key. */
export function auditOperatorAdmin(
  actor: Principal,
  action: string,
  subject: string,
  extra?: Record<string, unknown>,
): void {
  logger.info("operator_admin.action", {
    action,
    actor: actor.id,
    principalType: actor.principalType,
    actorKeyPrefix: actor.keyPrefix,
    subject,
    ...extra,
  });
}

/** Idempotency-key + canonical body fingerprint; failures NOT cached.
 *  Asymmetry accepted (review): a SUCCESS body — incl. the one-time
 *  opk_ plaintext of an issue/rotate — sits in dedupeStore for the
 *  24h replay window and is re-served on replay; that IS the contract
 *  a retried caller needs (retry must get the SAME key, not a fresh
 *  orphan). The window is in-process memory behind the same
 *  credential that minted it — a leaked idempotency-key alone
 *  reaches nothing without the operator key. */
export async function runOperatorWrite(
  c: Context,
  scope: string,
  produce: () => Promise<{ status: number; body: Record<string, unknown> }>,
  opts: { owner: string; resource?: string; body: unknown },
): Promise<Response> {
  const key = readIdempotencyKey(c);
  if (key instanceof Response) return key;
  try {
    const res = await idempotentWrite(scope, key, produce, {
      owner: opts.owner,
      resource: opts.resource,
      fingerprint: requestFingerprint(opts.body),
      cacheErrors: false,
    });
    return c.json(res.body, res.status as 200);
  } catch (err) {
    if (err instanceof Error && err.name === "IdempotencyConflictError") {
      return errorResponse(
        c,
        409,
        ErrorCodes.CONFLICT,
        "idempotency key reused with a different request body",
      );
    }
    throw err;
  }
}

/** capability gate mounted after operatorAuth (C7 — record only). */
export const operatorAdminGate = async (c: Context, next: Next) => {
  const deny = requireCapability(c, "operator-admin");
  if (deny) return deny;
  await next();
};

/** Store-reason → HTTP status shared by both surfaces. State-conflict
 *  refusals are 409 (matches the advertised OpenAPI docs); shape and
 *  name errors are 400. */
export const reasonStatus = (reason: string): number =>
  reason === "missing" ||
  reason === "missing_operator" ||
  reason === "missing_credential"
    ? 404
    : reason === "last_operator" ||
        reason === "disabled_operator" ||
        reason === "already_revoked"
      ? 409
      : 400;
