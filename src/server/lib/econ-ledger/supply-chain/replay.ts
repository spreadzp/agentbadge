/**
 * SLICE-215-2 (D-211-9): shipment replay builder — assembles the
 * canonical `ShipmentReplayResponse` (contract of 215-1) from the
 * derived shipment state + the raw event stream.
 *
 * Derivation rules (never caller input, always from the log):
 *  - timeline  = every event of the shipment, seq order; `hopIndex`
 *    lifted only when the payload names one (handoff/pay/verify).
 *  - hop fields = derived state (project.ts) + plan terms
 *    (amountUsdc/receiver from the canonical work_offer seq 1, same
 *    first-wins binding as the projection) + pay payload `txHash`
 *    (canonical seq slot only).
 *  - aggregate = completedPct (verified share), currentCustodian
 *    (last handed-off receiver, else the client), outstandingUsdc
 *    (plan amount on hops below `paid`, BigInt decimal sum).
 *  - status    = disputed > completed > in_progress > offered.
 *  - limits    = REPLAY_LIMITS_V1 — always present (D-215-3).
 *
 * Returns null when there is no replayable shipment: no events, no
 * canonical offer (no client), a hop that cannot honestly produce the
 * contract's required fields, an over-cap stream (REPLAY_MAX_*), or a
 * final schema-conformance failure — the vitrine never fabricates.
 * Every refusal reason is warn-logged (215-5, audit M-1); the wire
 * still gets a plain 404.
 */

import type { EconLedgerStore } from "@agentbadge/database";
import { HEX32 } from "@agentbadge/econ-events";
import { logger } from "@agentbadge/passport/logger";
import { shipmentState, type OfferHopPlan, type OfferTerms } from "./project";
import { ADDRESS_RE, DECIMAL_USDC_RE, seqFor, sumUsdc } from "./state";
import { statusRank } from "./types";
import {
  REPLAY_LIMITS_V1,
  ShipmentReplayResponseSchema,
  type ReplayHop,
  type ReplayTimelineEntry,
  type ShipmentReplayResponse,
  type ShipmentReplayStatus,
} from "./replay-types";

/** 215-5 (audit H-3): honest bounds — an over-cap stream gets a null
 *  (plain 404) instead of an unbounded scan/response. */
export const REPLAY_MAX_EVENTS = 4096;
export const REPLAY_MAX_HOPS = 256;

/** 215-5 (audit M-6): evidence uri schemes allowed on read — same
 *  allowlist as the write-side strict schema (http/https/ipfs/ar). */
const URI_SCHEMES = new Set(["http:", "https:", "ipfs:", "ar:"]);
/** 215-5 (audit H-5): hopIndex is lifted into the timeline only for
 *  these kinds at their canonical seq slot, bound to the shipment. */
const TIMELINE_HOP_KINDS = new Set(["handoff", "pay", "verify"]);

const ADVISORY_FLAG_KEYS = [
  "tempViolation",
  "fakeSensor",
  "missingEvidence",
  "gpsAnomaly",
  "disputed",
  "counterpartyIssued",
] as const;

/** 216-3 (audit M-7): per-process replay micro-cache — a hot read
 *  loop on one shipmentId replays the SoT once per TTL instead of
 *  re-projecting the stream per request. 404s cache too: an unknown
 *  id hammering the endpoint doesn't re-scan the ledger each call. */
const REPLAY_CACHE_TTL_MS = 5_000;
const REPLAY_CACHE_MAX = 512;
const replayCache = new Map<
  string,
  { at: number; res: ShipmentReplayResponse | null }
>();

export async function shipmentReplay(
  ledger: EconLedgerStore,
  shipmentId: string,
): Promise<ShipmentReplayResponse | null> {
  const cached = replayCache.get(shipmentId);
  if (cached && Date.now() - cached.at < REPLAY_CACHE_TTL_MS) return cached.res;
  const res = await buildReplay(ledger, shipmentId);
  replayCache.set(shipmentId, { at: Date.now(), res });
  if (replayCache.size > REPLAY_CACHE_MAX) {
    // oldest-first eviction — Map iterates in insertion order.
    replayCache.delete(replayCache.keys().next().value!);
  }
  return res;
}

async function buildReplay(
  ledger: EconLedgerStore,
  shipmentId: string,
): Promise<ShipmentReplayResponse | null> {
  // 216-3 (audit M-7): bound the stream read at the query — cap+1 rows
  // is enough to detect an over-cap stream without projecting it.
  const state = await shipmentState(ledger, shipmentId, {
    limit: REPLAY_MAX_EVENTS + 1,
  });
  if (state.events.length === 0 || state.client === undefined) return null;
  const refuse = (reason: string): null => {
    logger.warn("shipment replay refused", { shipmentId, reason });
    return null;
  };
  if (state.events.length > REPLAY_MAX_EVENTS) {
    return refuse(`stream ${state.events.length} events > cap ${REPLAY_MAX_EVENTS}`);
  }
  if (state.hops.length > REPLAY_MAX_HOPS) {
    return refuse(`${state.hops.length} hops > cap ${REPLAY_MAX_HOPS}`);
  }
  const client = state.client;

  // Plan terms — canonical offer only (seq 1, first wins), mirroring
  // the H-1 binding in project.ts.
  const offer = state.events.find(
    (e) => e.kind === "work_offer" && e.seq === 1,
  );
  const rawTerms = (offer?.payload as { terms?: OfferTerms } | null | undefined)?.terms;
  const terms =
    rawTerms !== null && typeof rawTerms === "object" ? rawTerms : undefined;
  const planByIndex = new Map<number, OfferHopPlan>();
  if (
    terms !== undefined &&
    (terms.shipmentId === undefined || terms.shipmentId === shipmentId) &&
    Array.isArray(terms.hops)
  ) {
    for (const h of terms.hops) {
      // 215-5 (audit H-1): non-object plan entries and non-integer
      // indexes degrade to "no plan entry" — never a TypeError.
      if (h === null || typeof h !== "object") continue;
      if (!Number.isInteger(h.hopIndex) || (h.hopIndex as number) < 0) continue;
      // Validate each plan field BEFORE it can reach JSON/BigInt:
      // a crafted amountUsdc/receiver is dropped (→ missing required
      // field → honest null), never summed or echoed unvalidated.
      const plan: OfferHopPlan = { hopIndex: h.hopIndex as number };
      if (typeof h.receiver === "string" && ADDRESS_RE.test(h.receiver)) {
        plan.receiver = h.receiver;
      }
      if (typeof h.amountUsdc === "string" && DECIMAL_USDC_RE.test(h.amountUsdc)) {
        plan.amountUsdc = h.amountUsdc;
      }
      if (typeof h.jobId === "string" && h.jobId.length > 0) {
        plan.jobId = h.jobId;
      }
      planByIndex.set(h.hopIndex as number, plan);
    }
  }

  // Per-hop correlation from canonical pay slots: settle txHash and —
  // as fallback for plan-less chains — the paid amount (core field).
  const txByHop = new Map<number, string>();
  const payAmountByHop = new Map<number, string>();
  for (const e of state.events) {
    if (e.kind !== "pay") continue;
    const p =
      typeof e.payload === "object" && e.payload !== null
        ? (e.payload as {
          shipmentId?: string;
          hopIndex?: number;
          txHash?: string;
        })
        : {};
    const idx = p.hopIndex;
    if (
      !Number.isInteger(idx) ||
      (idx as number) < 0 ||
      p.shipmentId !== shipmentId ||
      e.seq !== seqFor(idx as number, "pay")
    ) {
      continue;
    }
    if (typeof p.txHash === "string" && HEX32.test(p.txHash)) {
      txByHop.set(idx as number, p.txHash);
    }
    if (e.amountUsdc !== undefined && DECIMAL_USDC_RE.test(e.amountUsdc)) {
      payAmountByHop.set(idx as number, e.amountUsdc);
    }
  }

  // 215-5 nit: seq-sorted regardless of store order (the contract's
  // SoT is the log order, not a backend accident of listBySourceId).
  const ordered = [...state.events].sort((a, b) => a.seq - b.seq);
  // 215-5 nit: (source, sourceId, seq) must be unique — a duplicated
  // slot means corrupted/imported rows; refuse honestly.
  const seenSeq = new Set<number>();
  for (const e of ordered) {
    if (seenSeq.has(e.seq)) return refuse(`duplicate seq ${e.seq}`);
    seenSeq.add(e.seq);
  }
  const timeline: ReplayTimelineEntry[] = ordered.map((e) => {
    const p =
      typeof e.payload === "object" && e.payload !== null
        ? (e.payload as { hopIndex?: number; shipmentId?: string })
        : {};
    const entry: ReplayTimelineEntry = { seq: e.seq, kind: e.kind, ts: e.at };
    // 215-5 (audit H-5): hopIndex is lifted ONLY for canonical-slot
    // events bound to THIS shipment — a forged seq or foreign payload
    // can no longer annotate the timeline.
    const idx = p.hopIndex;
    if (
      TIMELINE_HOP_KINDS.has(e.kind) &&
      Number.isInteger(idx) &&
      (idx as number) >= 0 &&
      p.shipmentId === shipmentId &&
      e.seq === seqFor(idx as number, e.kind as "handoff" | "pay" | "verify")
    ) {
      entry.hopIndex = idx as number;
    }
    return entry;
  });

  const hops: ReplayHop[] = [];
  for (const h of state.hops) {
    const plan = planByIndex.get(h.hopIndex);
    const receiver = h.receiver ?? plan?.receiver;
    const amountUsdc = plan?.amountUsdc ?? payAmountByHop.get(h.hopIndex);
    // Required contract fields — a hop that cannot produce them
    // honestly voids the whole replay (never fabricate).
    if (receiver === undefined || amountUsdc === undefined) {
      return refuse(`hop ${h.hopIndex} lacks required receiver/amountUsdc`);
    }
    const hop: ReplayHop = { index: h.hopIndex, receiver, amountUsdc, status: h.status };
    if (h.jobId !== undefined) hop.jobId = h.jobId;
    const txHash = txByHop.get(h.hopIndex);
    if (txHash !== undefined) hop.txHash = txHash;
    if (h.roles !== undefined) {
      hop.roles = h.roles;
      if (h.rolesAssertedBy !== undefined) hop.rolesAssertedBy = h.rolesAssertedBy;
    }
    if (h.evidence !== undefined) {
      // 215-5 (audit M-6): keep the ref, drop a uri whose scheme is
      // outside the write-side allowlist — a javascript:/data:/file:
      // URI appended via importer/replay-mode never reaches JSON.
      hop.evidence = h.evidence.map((r) =>
        r.uri !== undefined && !allowedUri(r.uri) ? { ...r, uri: undefined } : r,
      );
      if (h.evidenceAssertedBy !== undefined) hop.evidenceAssertedBy = h.evidenceAssertedBy;
    }
    for (const flag of ADVISORY_FLAG_KEYS) {
      if (h[flag] === true) hop[flag] = true;
    }
    hops.push(hop);
  }

  // Aggregate — derived, never stored.
  const verified = hops.filter((h) => h.status === "verified").length;
  const completedPct =
    hops.length === 0 ? 0 : Math.round((verified / hops.length) * 100);
  const handedOff = [...state.hops]
    .reverse()
    .find((h) => statusRank(h.status) >= statusRank("handed_off"));
  // Custody: last handed-off receiver; the client pre-first-handoff;
  // omitted when custody cannot be derived.
  const currentCustodian =
    handedOff === undefined ? client : handedOff.receiver;
  const outstandingUsdc = sumUsdc(
    hops.filter((h) => statusRank(h.status) < statusRank("paid")),
  );

  const status: ShipmentReplayStatus = state.hops.some((h) => h.disputed === true)
    ? "disputed"
    : hops.length > 0 && verified === hops.length
      ? "completed"
      : handedOff !== undefined
        ? "in_progress"
        : "offered";

  const parsed = ShipmentReplayResponseSchema.safeParse({
    shipmentId,
    client,
    status,
    timeline,
    hops,
    aggregate: {
      completedPct,
      ...(currentCustodian !== undefined ? { currentCustodian } : {}),
      outstandingUsdc,
    },
    limits: [...REPLAY_LIMITS_V1],
  });
  if (!parsed.success) return refuse("final schema conformance failed");
  return parsed.data;
}

/** Evidence uri scheme gate — see URI_SCHEMES. */
function allowedUri(u: string): boolean {
  try {
    return URI_SCHEMES.has(new URL(u).protocol);
  } catch {
    return false;
  }
}
