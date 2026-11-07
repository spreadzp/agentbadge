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
 * contract's required fields, or a final schema-conformance failure —
 * the vitrine never fabricates.
 */

import type { EconLedgerStore } from "@agentbadge/database";
import { HEX32 } from "@agentbadge/econ-events";
import { shipmentState } from "./project";
import { seqFor, sumUsdc } from "./state";
import { statusRank } from "./types";
import {
  REPLAY_LIMITS_V1,
  ShipmentReplayResponseSchema,
  type ReplayHop,
  type ReplayTimelineEntry,
  type ShipmentReplayResponse,
  type ShipmentReplayStatus,
} from "./replay-types";

interface OfferHopPlan {
  hopIndex?: number;
  receiver?: string;
  amountUsdc?: string;
  jobId?: string;
}
interface OfferTerms {
  shipmentId?: string;
  hops?: OfferHopPlan[];
}

const ADVISORY_FLAG_KEYS = [
  "tempViolation",
  "fakeSensor",
  "missingEvidence",
  "gpsAnomaly",
  "disputed",
] as const;

export async function shipmentReplay(
  ledger: EconLedgerStore,
  shipmentId: string,
): Promise<ShipmentReplayResponse | null> {
  const state = await shipmentState(ledger, shipmentId);
  if (state.events.length === 0 || state.client === undefined) return null;
  const client = state.client;

  // Plan terms — canonical offer only (seq 1, first wins), mirroring
  // the H-1 binding in project.ts.
  const offer = state.events.find(
    (e) => e.kind === "work_offer" && e.seq === 1,
  );
  const terms = offer
    ? (offer.payload as { terms?: OfferTerms }).terms
    : undefined;
  const planByIndex = new Map<number, OfferHopPlan>();
  if (
    terms &&
    (terms.shipmentId === undefined || terms.shipmentId === shipmentId)
  ) {
    for (const h of terms.hops ?? []) {
      if (Number.isInteger(h.hopIndex) && (h.hopIndex as number) >= 0) {
        planByIndex.set(h.hopIndex as number, h);
      }
    }
  }

  // Per-hop correlation from canonical pay slots: settle txHash and —
  // as fallback for plan-less chains — the paid amount (core field).
  const txByHop = new Map<number, string>();
  const payAmountByHop = new Map<number, string>();
  for (const e of state.events) {
    if (e.kind !== "pay") continue;
    const p = e.payload as {
      shipmentId?: string;
      hopIndex?: number;
      txHash?: string;
    };
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
    if (e.amountUsdc !== undefined) payAmountByHop.set(idx as number, e.amountUsdc);
  }

  const timeline: ReplayTimelineEntry[] = state.events.map((e) => {
    const p = e.payload as { hopIndex?: number };
    const entry: ReplayTimelineEntry = { seq: e.seq, kind: e.kind, ts: e.at };
    if (Number.isInteger(p?.hopIndex) && (p.hopIndex as number) >= 0) {
      entry.hopIndex = p.hopIndex as number;
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
    if (receiver === undefined || amountUsdc === undefined) return null;
    const hop: ReplayHop = { index: h.hopIndex, receiver, amountUsdc, status: h.status };
    if (h.jobId !== undefined) hop.jobId = h.jobId;
    const txHash = txByHop.get(h.hopIndex);
    if (txHash !== undefined) hop.txHash = txHash;
    if (h.roles !== undefined) {
      hop.roles = h.roles;
      if (h.rolesAssertedBy !== undefined) hop.rolesAssertedBy = h.rolesAssertedBy;
    }
    if (h.evidence !== undefined) {
      hop.evidence = h.evidence;
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
  return parsed.success ? parsed.data : null;
}
