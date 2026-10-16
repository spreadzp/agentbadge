/**
 * SLICE-199-11 (EPIC-199): shared helpers for the board API routes —
 * public projections, passport denies, Idempotency-Key replay
 * (board:idem:{key}, 24h) and the snapshot cache plumbing.
 */
import type { Context } from "hono";
import type { CacheProvider } from "@agentbadge/cache";

import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import type { BoardCardRecord } from "../lib/board/types";

export interface AgentCtx {
  agentId: string;
  tier: string;
  name?: string;
}

export type HttpStatus = 200 | 201 | 400 | 403 | 404 | 409;

export const SNAP_TTL_SEC = 12;
const IDEM_TTL_SEC = 24 * 60 * 60;

/** Public projection — spec internals and payout data never leave. */
export function publicCard(card: BoardCardRecord) {
  return {
    cardId: card.cardId,
    bountyId: card.bountyId,
    title: card.title,
    column: card.column,
    budgetUsdc: card.budgetUsdc ?? null,
    createdAt: card.createdAt,
  };
}

/** spec is visible to ops/reviewer tiers and the claim holder. */
export function canSeeSpec(
  card: BoardCardRecord,
  agent?: AgentCtx,
): boolean {
  if (!agent) return false;
  if (agent.tier === "ops" || agent.tier === "reviewer") return true;
  return card.currentPassportId === agent.agentId;
}

export function denyPassport(c: Context) {
  return errorResponse(
    c,
    403,
    ErrorCodes.PASSPORT_NOT_FOUND,
    "passport required — authenticate with Bearer agb_ key",
    { hint: "Register a passport via POST /api/v1/agents/register" },
  );
}

export function denyTier(c: Context, what: string) {
  return errorResponse(
    c,
    403,
    ErrorCodes.PASSPORT_TYPE_MISMATCH,
    `${what} requires an ops-tier passport`,
  );
}

export interface IdemRecord {
  status: HttpStatus;
  body: unknown;
}

export async function readIdem(
  cache: CacheProvider | null,
  key: string | null,
): Promise<IdemRecord | undefined> {
  if (!cache || !key) return undefined;
  const hit = await cache
    .get<IdemRecord>(`board:idem:${key}`)
    .catch(() => null);
  return hit ?? undefined;
}

export async function writeIdem(
  cache: CacheProvider | null,
  key: string | null,
  rec: IdemRecord,
): Promise<void> {
  if (!cache || !key) return;
  await cache
    .set(`board:idem:${key}`, rec, { ttlSec: IDEM_TTL_SEC, tags: ["board"] })
    .catch(() => undefined);
}

export function err(r: { code: string; message: string }) {
  return { ok: false as const, error: { code: r.code, message: r.message } };
}
