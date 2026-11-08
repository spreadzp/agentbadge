/**
 * SLICE-214-2 (D-214-1, O-214-1): advisory flags derived at projection
 * time — honest data signals for the scenario matrix, never automatic
 * blocks. Split from state.ts (max-lines lint); called from
 * shipmentState() only when claims are lifted (not in light mode).
 *
 * The flag set ships in the API contract via 215 replay-types; today
 * it is visible through shipmentState() only (the API schema strips
 * unknown keys on parse). Each flag means "this data needs policy
 * review", not a verdict — the ref is a link, not a fact (D-213-4).
 */

import type { ShipmentEvidenceRef, ShipmentHop } from "@agentbadge/econ-events";
import { statusRank } from "./types";

/** 216-3 (audit H-1): the projection's evidence ref. The published
 *  package schema (@agentbadge/econ-events 0.1.2) still names the
 *  annotation `issuerMatchesParty` — the issuerIsHopParty /
 *  issuerIsCounterparty rename ships in 0.1.3 (not yet on npm).
 *  The server emits the new provenance fields, so model the lifted
 *  ref locally until the publish lands and this file can use
 *  ShipmentEvidenceRef directly again. */
export type ProjectedEvidenceRef =
  Omit<ShipmentEvidenceRef, "issuerMatchesParty"> & {
    issuerIsHopParty: boolean;
    issuerIsCounterparty?: boolean;
  };

/** Projection-internal hop — ShipmentHop minus the npm-stale evidence
 *  annotation (see ProjectedEvidenceRef). */
export type SupplyChainHop = Omit<ShipmentHop, "evidence"> & {
  evidence?: ProjectedEvidenceRef[];
};

/** 214-5 (audit M-1): telemetry-producing ref types — a claim from
 *  a source other than the declared device is the fake-sensor signal.
 *  Matching on REF type (not issuer type) closes the evasion where a
 *  rogue sensor self-declares issuer.type "org". */
const TELEMETRY_TYPES = new Set(["temperature", "gps", "weight"]);

export interface ShipmentAdvisoryFlags {
  /** §25 S2: a temperature claim from an untrusted source — the
   *  issuer is neither a hop party NOR the declared roles.device
   *  (audit M-1: a declared sensor's own reading is a trusted
   *  channel, not a violation). §25 "payment HELD" maps to this
   *  advisory in v1 (no automatic block). */
  tempViolation?: boolean;
  /** §25 S3: a telemetry-type evidence ref (temp/gps/weight) was
   *  asserted by a source ≠ the hop's declared `roles.device`. Only
   *  set when a device IS declared — without one there is nothing to
   *  compare against, so the flag stays off rather than guessing. */
  fakeSensor?: boolean;
  /** §25 S4: the hop reached handed_off (or later) with no evidence
   *  refs — a telemetry gap. The chain stays valid (backward compat,
   *  D-211-2); the flag marks the gap for the verifier. */
  missingEvidence?: boolean;
  /** §25 S5: a gps claim from an untrusted source — neither a hop
   *  party nor the declared device (same trust rule as tempViolation).
   *  The geo-policy engine judges plausibility (v2). §25 "CONFLICT"
   *  maps to this advisory in v1. */
  gpsAnomaly?: boolean;
  /** §25 S6 (D-214-4): the hop's receiver recorded a fail-verdict on
   *  the handoff (verify event, outcome:"fail") — a dispute stub.
   *  settleHop refuses while this flag stands; there is no
   *  un-dispute path in v1 (dispute engine = block 10). Set in the
   *  event loop, not here — it is event-driven, not derived. */
  disputed?: boolean;
  /** 216-3 (audit H-1): at least one evidence ref names the hop's
   *  counterparty as issuer — a self-serving channel: the actor
   *  ASSERTS the claim on the receiver's behalf. Flagged for review;
   *  it no longer counts as a trusted source for violation flags. */
  counterpartyIssued?: boolean;
  /** 216-3 (audit M-4): plan-declared leg amount from the canonical
   *  offer — carried on the hop so settle can compare the requested
   *  pay without re-reading terms. Derived, not a flag. */
  planAmountUsdc?: string;
}

/** ShipmentHop plus the derived advisory flags (214-2). */
export type AdvisoryShipmentHop = SupplyChainHop & ShipmentAdvisoryFlags;

/** Post-pass over the derived hops — mutates flags in place. */
export function applyAdvisoryFlags(hops: Map<number, AdvisoryShipmentHop>): void {
  for (const hop of hops.values()) {
    // S4: handed off (or later) with zero telemetry → flag the gap.
    if (statusRank(hop.status) >= statusRank("handed_off") && hop.evidence === undefined) {
      hop.missingEvidence = true;
    }
    const declaredDevice = hop.roles?.device?.address?.toLowerCase();
    // 216-3 (audit H-1): a "device" whose address IS the asserting
    // actor is a self-declared sensor — it cannot vouch for itself,
    // so it provides no trusted channel at all.
    const selfDeclaredDevice =
      declaredDevice !== undefined &&
      hop.rolesAssertedBy?.toLowerCase() === declaredDevice;
    const trustedDevice = selfDeclaredDevice ? undefined : declaredDevice;
    for (const ref of hop.evidence ?? []) {
      if (ref.issuerIsCounterparty === true) hop.counterpartyIssued = true;
      // 216-3 (audit H-1): trusted = the declared device ONLY — and
      // never a self-declared one. Hop-party issuers (actor or
      // counterparty) are self-claims: provenance stays on the ref
      // (issuerIsHopParty) but they no longer suppress the violation
      // advisory — "this data needs policy review" is the honest call.
      const trusted =
        trustedDevice !== undefined && ref.issuer.address.toLowerCase() === trustedDevice;
      if (ref.type === "temperature" && !trusted) hop.tempViolation = true;
      if (ref.type === "gps" && !trusted) hop.gpsAnomaly = true;
      // S3: a telemetry ref from a source ≠ the declared sensor —
      // matched on ref type so a rogue can't evade by declaring
      // issuer.type "org" (audit M-1 evasion). A self-declared device
      // provides no baseline to compare against — the violation flags
      // above carry that signal instead.
      if (
        trustedDevice !== undefined &&
        TELEMETRY_TYPES.has(ref.type) &&
        ref.issuer.address.toLowerCase() !== trustedDevice
      ) {
        hop.fakeSensor = true;
      }
    }
  }
}
