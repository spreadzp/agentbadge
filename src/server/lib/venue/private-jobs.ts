/**
 * SLICE-153-3: private jobs — off-chain payload + onchain keccak commitments.
 *
 * Onchain the job description is only a public tag `bv:<slug>:<commitment12>`;
 * the full payload (descriptionFull, terms, deliverableData) lives in the meta
 * lane `venue:private:<jobId>` — readable by venue members only. On submit the
 * deliverable's keccak256 goes onchain; plaintext never leaves the venue.
 *
 * No caching — reads hit the store each time (consistent with members.ts;
 * instant revoke relies on fresh reads).
 */
import { keccak256, toBytes, toHex, type Hex } from "viem";

import { getVenueMeta, setVenueMeta } from "./store";
import type { VenueRecord } from "./venues";

// ─── Types ─────────────────────────────────────────────────────────

export interface PrivateJobPayload {
  jobId: string;
  venueId: string;
  /** Members-only full scope text. */
  descriptionFull: string;
  /** SLA / conditions — members-only. */
  terms?: string;
  /** Deliverable result data — stored off-chain on submit. */
  deliverableData?: string;
  /** External link for large deliverables (> limit → uri-only). */
  deliverableUri?: string;
  /** keccak256(canonical payload) — the onchain link. */
  commitment: Hex;
}

/** Input shape for commitment computation (excludes commitment itself). */
export type PrivateJobInput = Omit<PrivateJobPayload, "commitment">;

// ─── Env ───────────────────────────────────────────────────────────

/** Max byte size of the stored private payload (default 256 KiB). */
export function privateLimit(): number {
  const n = Number(process.env.ARC_BV_MAX_PRIVATE_BYTES ?? 262144);
  return Number.isFinite(n) && n > 0 ? n : 262144;
}

/** ARC_BV_MEMO_LINK (default 1) — emit memo(jobId↔commitment) tx on create. */
export function memoLinkEnabled(): boolean {
  return process.env.ARC_BV_MEMO_LINK !== "0";
}

// ─── Commitment ────────────────────────────────────────────────────

/** Canonical JSON: object keys sorted recursively — deterministic hash. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

/**
 * commitment = keccak256(canonical JSON of the payload) — key order and
 * absent-vs-undefined fields don't change the hash.
 */
export function computeCommitment(payload: PrivateJobInput): Hex {
  return keccak256(toBytes(canonical(payload)));
}

/** Public onchain description for business-venue jobs: `bv:<slug>:<tag>`. */
export function privateTag(venue: VenueRecord, commitment: Hex): string {
  return `bv:${venue.slug}:${commitment.slice(2, 10)}`.slice(0, 128);
}

/** memoId linking off-chain record to the job — keccak256(jobId|venueId). */
export function privateMemoId(jobId: string, venueId: string): Hex {
  return keccak256(toBytes(`${jobId}|${venueId}`));
}

/** memo context bytes — the commitment itself (publicly verifiable). */
export function privateMemoContext(commitment: Hex): Hex {
  return toHex(commitment);
}

// ─── Persistence (meta lane) ───────────────────────────────────────

const KEY = (jobId: string) => `venue:private:${jobId}`;

export function getPrivateJob(jobId: string): PrivateJobPayload | undefined {
  return getVenueMeta<PrivateJobPayload>(KEY(jobId));
}

export function savePrivateJob(payload: PrivateJobPayload): PrivateJobPayload {
  setVenueMeta(KEY(payload.jobId), payload);
  return payload;
}

/** Merge-update stored payload (e.g. deliverableData on submit). */
export function updatePrivateJob(
  jobId: string,
  patch: Partial<Omit<PrivateJobPayload, "jobId" | "venueId">>,
): PrivateJobPayload | undefined {
  const cur = getPrivateJob(jobId);
  if (!cur) return undefined;
  const next = { ...cur, ...patch };
  setVenueMeta(KEY(jobId), next);
  return next;
}

/**
 * Validate + build a private record for create. Returns the payload or
 * throws Error (message is client-safe). Enforces the byte cap over the
 * serialized private fields.
 */
export function buildPrivateJob(args: {
  jobId: string;
  venue: VenueRecord;
  details: { descriptionFull?: string; terms?: string };
}): PrivateJobPayload {
  const input: PrivateJobInput = {
    jobId: args.jobId,
    venueId: args.venue.id,
    descriptionFull: String(args.details.descriptionFull ?? ""),
    terms: args.details.terms ? String(args.details.terms) : undefined,
  };
  const bytes = Buffer.byteLength(canonical(input), "utf8");
  const limit = privateLimit();
  if (bytes > limit) {
    throw new Error(
      `privateDetails too large (${bytes}B > ${limit}B) — use deliverableUri/external link`,
    );
  }
  return { ...input, commitment: computeCommitment(input) };
}
