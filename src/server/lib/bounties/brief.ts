/**
 * SLICE-197-05: bounty create + brief read — service layer.
 *
 * Q33: structured brief = criteria[] + deliverable_type + steps +
 * verify; readable pre-claim via GET /api/bounties/:id.
 * Q34: steps default to a template keyed by deliverable_type; the
 * operator may override with bespoke steps.
 * Q35/Q36: create + brief read require a passport (Bearer agb_ →
 * passportId); the brief read additionally requires the caller to
 * sign with the passport OWNER wallet (fetchAgentOwner == signer).
 * Q20: the public feed strips brief, budget and private fields.
 */
import { randomBytes } from "node:crypto";

import { ErrorCodes, type ErrorCode } from "../error-codes";
import {
  verifyWalletSigRequest,
  type WalletSigCheck,
} from "../../middleware/agent-auth";
import {
  fetchAgentOwner,
  resolveVenueNetwork,
} from "../venue/chain";
import { appendTransition, listBounties, upsertBounty } from "./store";
import type { BountyStatus } from "./lifecycle";
import type { BountyRecord } from "./types";

// ─── Deliverable types + step templates (Q34) ────────────────────

export const DELIVERABLE_TYPES = ["pr", "url", "post", "report"] as const;
export type DeliverableType = (typeof DELIVERABLE_TYPES)[number];

export const STEP_TEMPLATES: Record<DeliverableType, string[]> = {
  pr: [
    "Fork or clone the referenced repository",
    "Implement the change so every criterion holds",
    "Open a pull request describing what was done",
    "Submit the PR link and wait for the QA verdict",
  ],
  url: [
    "Produce the deliverable described in the brief",
    "Publish or deploy it at a stable URL",
    "Submit the URL and wait for the QA verdict",
  ],
  post: [
    "Draft the content per the brief criteria",
    "Publish it on the required platform",
    "Submit the post link and wait for the QA verdict",
  ],
  report: [
    "Research the topic described in the brief",
    "Write the report covering every criterion",
    "Submit the report link or attachment and wait for the QA verdict",
  ],
};

export function stepsTemplate(t: DeliverableType): string[] {
  return [...STEP_TEMPLATES[t]];
}

// ─── Create ──────────────────────────────────────────────────────

export interface CreateBountyInput {
  title?: unknown;
  description?: unknown;
  budgetUsdc?: unknown;
  criteria?: unknown;
  deliverableType?: unknown;
  /** snake_case alias accepted (deliverable_type). */
  deliverable_type?: unknown;
  steps?: unknown;
  verify?: unknown;
  onchainJobId?: unknown;
  payload?: unknown;
}

export type CreateBountyResult =
  | { ok: true; bounty: BountyRecord }
  | { ok: false; status: 400; code: ErrorCode; message: string };

const asStr = (v: unknown, max = 500): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const isStrList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && s.trim().length > 0);

export function createBounty(
  input: CreateBountyInput,
  ctx: { passportId: string },
  deps: { newId?: () => string; now?: () => number } = {},
): CreateBountyResult {
  const title = asStr(input.title, 200);
  if (!title) {
    return { ok: false, status: 400, code: ErrorCodes.MISSING_FIELDS,
      message: "title is required" };
  }
  const budgetRaw = asStr(input.budgetUsdc, 40);
  const budget = Number(budgetRaw);
  if (!budgetRaw || !Number.isFinite(budget) || budget <= 0) {
    return { ok: false, status: 400, code: ErrorCodes.MISSING_FIELDS,
      message: "budgetUsdc must be a positive decimal string" };
  }
  if (!isStrList(input.criteria)) {
    return { ok: false, status: 400, code: ErrorCodes.MISSING_FIELDS,
      message: "criteria must be a non-empty string[] (Q33)" };
  }
  const dtRaw = asStr(input.deliverableType ?? input.deliverable_type, 20);
  if (!DELIVERABLE_TYPES.includes(dtRaw as DeliverableType)) {
    return { ok: false, status: 400, code: ErrorCodes.INVALID_INPUT,
      message: `deliverable_type must be one of ${DELIVERABLE_TYPES.join("|")}` };
  }
  const deliverableType = dtRaw as DeliverableType;
  const verify = asStr(input.verify, 500);
  if (!verify) {
    return { ok: false, status: 400, code: ErrorCodes.MISSING_FIELDS,
      message: "verify is required — how QA checks the deliverable (Q33)" };
  }
  let steps: string[] | undefined;
  if (input.steps !== undefined) {
    if (!isStrList(input.steps)) {
      return { ok: false, status: 400, code: ErrorCodes.INVALID_INPUT,
        message: "steps must be a non-empty string[]" };
    }
    steps = (input.steps as string[]).map((s) => s.trim()).filter(Boolean);
  }

  const now = (deps.now ?? Date.now)();
  const bounty: BountyRecord = {
    bountyId: (deps.newId ?? (() => `bty_${randomBytes(8).toString("hex")}`))(),
    title,
    description: asStr(input.description, 2000) || undefined,
    budgetUsdc: budgetRaw,
    status: "open",
    jobAttempt: 1,
    onchainJobId: asStr(input.onchainJobId, 66) || undefined,
    createdByPassportId: ctx.passportId,
    createdAt: new Date(now).toISOString(),
    brief: {
      criteria: input.criteria.map((s) => s.trim()),
      deliverableType,
      steps: steps ?? stepsTemplate(deliverableType), // Q34
      verify,
    },
    ...(typeof input.payload === "object" && input.payload !== null
      ? { payload: input.payload as Record<string, unknown> }
      : {}),
  };
  upsertBounty(bounty);
  appendTransition({
    id: `${bounty.bountyId}:0:create:${now}`,
    bountyId: bounty.bountyId,
    actor: ctx.passportId,
    from: "none",
    to: "open",
    atMs: now,
  });
  return { ok: true, bounty };
}

// ─── Public feed projection (Q20) ────────────────────────────────

/** Status, title, tx hashes — no brief, budget, or private fields. */
export function toPublicBounty(b: BountyRecord) {
  return {
    bountyId: b.bountyId,
    title: b.title,
    status: b.status,
    jobAttempt: b.jobAttempt,
    createdAt: b.createdAt,
    chainTxs: b.chainTxs,
  };
}

export function publicFeed(filter?: {
  status?: BountyStatus;
  limit?: number;
}) {
  return listBounties(filter).map(toPublicBounty);
}

// ─── Brief access gate (Q35/Q36) ─────────────────────────────────

export interface BriefAccessDeps {
  /** Injectable wallet-sig check (agent-auth). */
  verify?: (args: {
    wallet: string | undefined;
    signature: string | undefined;
    timestamp: string | undefined;
    method: string;
    path: string;
  }) => Promise<WalletSigCheck>;
  /** Injectable onchain owner lookup. */
  fetchOwner?: (passportId: string) => Promise<string | null>;
}

async function defaultFetchOwner(passportId: string): Promise<string | null> {
  const agentId = Number(passportId);
  if (!Number.isFinite(agentId)) return null;
  return fetchAgentOwner(agentId, resolveVenueNetwork());
}

/**
 * Returns null when access is granted, else the error triple for
 * errorResponse. Order matches acceptance: no passport → 403; missing
 * sig headers → 401; bad sig → 401; owner mismatch → 403.
 */
export async function checkBriefAccess(args: {
  passportId?: string;
  wallet?: string;
  signature?: string;
  timestamp?: string;
  method: string;
  path: string;
}, deps: BriefAccessDeps = {}): Promise<{
  status: 401 | 403;
  code: ErrorCode;
  message: string;
} | null> {
  if (!args.passportId) {
    return { status: 403, code: ErrorCodes.PASSPORT_NOT_FOUND,
      message: "passport required — authenticate with Bearer agb_ key (Q35)" };
  }
  const verify = deps.verify ?? verifyWalletSigRequest;
  const sig = await verify({
    wallet: args.wallet,
    signature: args.signature,
    timestamp: args.timestamp,
    method: args.method,
    path: args.path,
  });
  if (sig === "no-headers") {
    return { status: 401, code: ErrorCodes.MISSING_FIELDS,
      message: "Missing required headers: X-Wallet, X-Sig, X-Timestamp" };
  }
  if (sig !== "valid") {
    return { status: 401, code: ErrorCodes.INVALID_INPUT,
      message: "Signature verification failed" };
  }
  const fetchOwner = deps.fetchOwner ?? defaultFetchOwner;
  const owner = await fetchOwner(args.passportId);
  if (!owner || owner.toLowerCase() !== args.wallet!.toLowerCase()) {
    return { status: 403, code: ErrorCodes.WRONG_SIGNER,
      message: "signer wallet is not the passport owner" };
  }
  return null;
}
