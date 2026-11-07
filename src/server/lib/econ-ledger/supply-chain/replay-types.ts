/**
 * SLICE-215-1 (D-215-1): replay-view response contract — schema + types
 * FIRST, so `GET /api/ledger/shipments/:id` (215-2) and honest-empty
 * (215-3) build against a fixed contract, not a shape invented ad hoc.
 *
 *   { shipmentId, client, status, timeline[], hops[], aggregate, limits }
 *
 * Semantics the endpoint must honor:
 *  - timeline: the shipment's own event stream flattened to
 *    {seq, kind, ts, hopIndex?} in seq order — the log is SoT.
 *  - hops: plan + derived state per hop, INCLUDING the advisory flag
 *    set (tempViolation, fakeSensor, missingEvidence, gpsAnomaly,
 *    disputed) and provenance annotations (rolesAssertedBy,
 *    evidenceAssertedBy, issuerMatchesParty) — final list per O-215-1.
 *  - limits: honest-limitation strings, ALWAYS present and non-empty
 *    (D-215-3) — the vitrine declares what it does NOT prove.
 *
 * Read/contract schema discipline mirrors @agentbadge/econ-events api.ts:
 * structurally precise on fields we emit ourselves (addresses, hex32,
 * decimal USDC), OPEN on `kind` so a newer event kind never bricks the
 * parse for older clients.
 */

import { z } from "zod";
import {
  ADDRESS,
  DECIMAL_USDC,
  EvidenceRefSchema,
  HEX32,
  ISO_TS,
  ParticipantRolesSchema,
} from "@agentbadge/econ-events";

/** Shipment-level status derived from hop states:
 *  `offered` — plan exists, no hop progressed yet;
 *  `in_progress` — at least one hop handed_off/paid/verified;
 *  `completed` — every hop verified;
 *  `disputed` — at least one hop carries a fail verdict (D-214-4). */
export const SHIPMENT_REPLAY_STATUSES = [
  "offered",
  "in_progress",
  "completed",
  "disputed",
] as const;
export type ShipmentReplayStatus = (typeof SHIPMENT_REPLAY_STATUSES)[number];

/** Per-event row of the readable timeline — a flat projection of the
 *  shipment's canonical event stream. `hopIndex` links the event to a
 *  hop when the payload names one (handoff/pay/verify). */
export const ReplayTimelineEntrySchema = z.object({
  /** Monotonic seq inside (source, sourceId) — canonical order key. */
  seq: z.number().int().positive(),
  /** OPEN on read — a kind added by a newer writer must parse as an
   *  opaque string for older clients (read-side leniency, N-3). */
  kind: z.string().min(1).max(64),
  /** ISO-8601 UTC timestamp of the underlying event. */
  ts: z.string().regex(ISO_TS),
  hopIndex: z.number().int().nonnegative().optional(),
});
export type ReplayTimelineEntry = z.infer<typeof ReplayTimelineEntrySchema>;

/** Evidence ref as surfaced by the replay — the payload ref plus the
 *  projection-time annotation `issuerMatchesParty` (is the self-declared
 *  issuer one of the hop's parties). Mirrors ShipmentEvidenceRefSchema
 *  in @agentbadge/econ-events api.ts, kept local because that schema is
 *  not exported from the package index. */
export const ReplayEvidenceRefSchema = EvidenceRefSchema.extend({
  issuerMatchesParty: z.boolean(),
});
export type ReplayEvidenceRef = z.infer<typeof ReplayEvidenceRefSchema>;

/** One hop of the replay: plan terms + derived state + advisory flags.
 *  `roles`/`evidence` are SELF-DECLARED claims by the handoff actor —
 *  provenance fields say who asserted them, never verified identity
 *  (D-212-3, D-213-4). */
export const ReplayHopSchema = z.object({
  index: z.number().int().nonnegative(),
  receiver: z.string().regex(ADDRESS),
  /** Plan pay for this leg, decimal USDC. */
  amountUsdc: z.string().regex(DECIMAL_USDC),
  /** offered → handed_off → paid → verified (derived, never caller input). */
  status: z.enum(["offered", "handed_off", "paid", "verified"]),
  /** ERC-8183 job bound to the hop (0x0/deferred → omitted). */
  jobId: z.string().min(1).optional(),
  /** Settle transaction hash when the pay leg landed onchain. */
  txHash: z.string().regex(HEX32).optional(),
  roles: ParticipantRolesSchema.optional(),
  rolesAssertedBy: z.string().min(1).optional(),
  evidence: z.array(ReplayEvidenceRefSchema).optional(),
  evidenceAssertedBy: z.string().min(1).optional(),
  // Advisory flags (applyAdvisoryFlags, final list per O-215-1) —
  // "this data needs policy review", never a verdict.
  tempViolation: z.boolean().optional(),
  fakeSensor: z.boolean().optional(),
  missingEvidence: z.boolean().optional(),
  gpsAnomaly: z.boolean().optional(),
  disputed: z.boolean().optional(),
});
export type ReplayHop = z.infer<typeof ReplayHopSchema>;

/** Chain-level aggregate — derived, never stored. */
export const ReplayAggregateSchema = z.object({
  /** Share of hops that reached `verified`, 0..100. */
  completedPct: z.number().min(0).max(100),
  /** Current custody holder (last handoff receiver; client pre-first
   *  handoff). Absent when no custody can be derived. */
  currentCustodian: z.string().regex(ADDRESS).optional(),
  /** Plan amount on hops not yet paid, decimal USDC. */
  outstandingUsdc: z.string().regex(DECIMAL_USDC),
});
export type ReplayAggregate = z.infer<typeof ReplayAggregateSchema>;

/** Honest-limitation strings shipped in every response (D-215-3). */
export const REPLAY_LIMITS_V1 = [
  "linear hops only",
  "manual settlement per hop",
  "evidence is advisory — not verified",
] as const;

export const ShipmentReplayResponseSchema = z.object({
  shipmentId: z.string().min(1).max(256),
  /** The party that created + funded the shipment. */
  client: z.string().regex(ADDRESS),
  status: z.enum(SHIPMENT_REPLAY_STATUSES),
  timeline: z.array(ReplayTimelineEntrySchema),
  hops: z.array(ReplayHopSchema),
  aggregate: ReplayAggregateSchema,
  /** Always non-empty (D-215-3): the vitrine declares its own limits. */
  limits: z.array(z.string().min(1).max(256)).min(1),
});
export type ShipmentReplayResponse = z.infer<typeof ShipmentReplayResponseSchema>;
