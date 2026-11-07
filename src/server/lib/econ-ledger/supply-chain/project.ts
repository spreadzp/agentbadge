/** SLICE-214-5 (audit H-1/H-2): shipmentState moved out of state.ts
 *  (max-lines) and hardened — the projection now binds the plan to
 *  the canonical offer (seq 1, first wins) and only lifts state from
 *  canonical seq slots with in-plan indices and payloads bound to
 *  THIS shipmentId. A foreign writer's event can no longer rewrite
 *  receivers/jobIds, mint phantom hops, or turn an inconclusive
 *  verdict into "verified".
 *
 *  Residual: a foreign writer able to OCCUPY a canonical seq slot
 *  first is a ledger-ACL question (trusted-writer boundary) —
 *  tracked for the hardening epic, not this stub. */

import type { EconEventStored, EconLedgerStore } from "@agentbadge/database";
import {
  type EconomicEvent,
  HandoffPayloadSchema,
} from "@agentbadge/econ-events";
import { seqFor, SHIPMENT_SOURCE } from "./state";
import { statusRank, type HopStatus } from "./types";
import { applyAdvisoryFlags, type AdvisoryShipmentHop } from "./advisory";

export type { AdvisoryShipmentHop };

interface OfferTerms {
  shipmentId?: string;
  hops?: Array<{ hopIndex?: number; receiver?: string; jobId?: string }>;
}

/** Derive hop states from the shipment's own event stream (SoT read).
 *  `opts.light` skips the roles/evidence lifts + advisory post-pass —
 *  guard paths never read claims (213-5, audit M-2). */
export async function shipmentState(
  ledger: EconLedgerStore,
  shipmentId: string,
  opts?: { light?: boolean },
): Promise<{ hops: AdvisoryShipmentHop[]; events: EconomicEvent[]; client?: string }> {
  const rows = await ledger.listBySourceId(SHIPMENT_SOURCE, shipmentId);
  const events = rows.map((r: EconEventStored) => r.event);
  const hops = new Map<number, AdvisoryShipmentHop>();
  const light = opts?.light === true;

  // H-1 pass 1: bind the plan to the canonical offer only — seq 1,
  // first wins; a later work_offer cannot rewrite receivers/jobIds.
  let client: string | undefined;
  let planSize: number | undefined;
  const offer = events.find((e) => e.kind === "work_offer" && e.seq === 1);
  if (offer) {
    client = offer.actor;
    const terms = (offer.payload as { terms?: OfferTerms }).terms;
    if (terms && (terms.shipmentId === undefined || terms.shipmentId === shipmentId)) {
      planSize = terms.hops?.length;
      for (const h of terms.hops ?? []) {
        if (!Number.isInteger(h.hopIndex) || (h.hopIndex as number) < 0) continue;
        const idx = h.hopIndex as number;
        const hop = hops.get(idx) ?? { hopIndex: idx, status: "offered" as HopStatus };
        if (h.receiver !== undefined) hop.receiver = h.receiver;
        if (h.jobId !== undefined) hop.jobId = h.jobId;
        hops.set(idx, hop);
      }
    }
  }

  // H-1 pass 2: per-hop legs — canonical seq + in-plan index +
  // payload bound to THIS shipmentId, or the event lifts nothing.
  for (const e of events) {
    if (e.kind === "handoff") {
      const parsed = HandoffPayloadSchema.safeParse(e.payload);
      if (!parsed.success) continue;
      const p = parsed.data;
      if (p.shipmentId !== shipmentId) continue;
      if (planSize !== undefined && p.hopIndex >= planSize) continue;
      if (e.seq !== seqFor(p.hopIndex, "handoff")) continue;
      const hop = hops.get(p.hopIndex) ?? { hopIndex: p.hopIndex, status: "offered" as HopStatus };
      if (statusRank(hop.status) < statusRank("handed_off")) hop.status = "handed_off";
      // First-event-wins claims (213-5 M-4/M-5): canonical seq is now
      // guaranteed by the gate above; clone, never alias; provenance kept.
      if (!light && p.roles && hop.roles === undefined) {
        hop.roles = structuredClone(p.roles);
        hop.rolesAssertedBy = e.actor;
      }
      if (!light && p.evidence && p.evidence.length > 0 && hop.evidence === undefined) {
        const parties = new Set([e.actor.toLowerCase(), (e.counterparty ?? "").toLowerCase()]);
        hop.evidence = p.evidence.map((r) => ({
          ...structuredClone(r),
          issuerMatchesParty: parties.has(r.issuer.address.toLowerCase()),
        }));
        hop.evidenceAssertedBy = e.actor;
      }
      hops.set(p.hopIndex, hop);
    } else if (e.kind === "pay" || e.kind === "verify") {
      const p = e.payload as {
        shipmentId?: string;
        hopIndex?: number;
        jobId?: string;
        outcome?: string;
      };
      const idx = p.hopIndex;
      if (!Number.isInteger(idx) || (idx as number) < 0 || p.shipmentId !== shipmentId) continue;
      if (planSize !== undefined && (idx as number) >= planSize) continue;
      if (e.seq !== seqFor(idx as number, e.kind)) continue;
      const hop = hops.get(idx as number) ?? { hopIndex: idx as number, status: "offered" as HopStatus };
      // H-2: ONLY "pass" lifts to verified; "fail" is the receiver
      // dispute stub (D-214-4); inconclusive/unknown lift nothing.
      if (e.kind === "verify") {
        if (p.outcome === "fail") hop.disputed = true;
        else if (p.outcome === "pass" && statusRank(hop.status) < statusRank("verified")) {
          hop.status = "verified";
        }
      } else {
        if (statusRank(hop.status) < statusRank("paid")) hop.status = "paid";
        if (p.jobId) hop.jobId = p.jobId;
      }
      hops.set(idx as number, hop);
    }
  }
  if (!light) applyAdvisoryFlags(hops);
  return { hops: [...hops.values()].sort((a, b) => a.hopIndex - b.hopIndex), events, client };
}
