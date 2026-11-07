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

import type { ShipmentHop } from "@agentbadge/econ-events";
import { statusRank } from "./types";

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
}

/** ShipmentHop plus the derived advisory flags (214-2). */
export type AdvisoryShipmentHop = ShipmentHop & ShipmentAdvisoryFlags;

/** Post-pass over the derived hops — mutates flags in place. */
export function applyAdvisoryFlags(hops: Map<number, AdvisoryShipmentHop>): void {
  for (const hop of hops.values()) {
    // S4: handed off (or later) with zero telemetry → flag the gap.
    if (statusRank(hop.status) >= statusRank("handed_off") && hop.evidence === undefined) {
      hop.missingEvidence = true;
    }
    const declaredDevice = hop.roles?.device?.address?.toLowerCase();
    for (const ref of hop.evidence ?? []) {
      // M-1 trusted source: a hop party OR the declared device — a
      // declared sensor's own reading is a trusted channel, not a
      // violation (previously every non-party claim fired, flagging
      // clean cold-chain data).
      const trusted =
        ref.issuerMatchesParty === true ||
        (declaredDevice !== undefined && ref.issuer.address.toLowerCase() === declaredDevice);
      if (ref.type === "temperature" && !trusted) hop.tempViolation = true;
      if (ref.type === "gps" && !trusted) hop.gpsAnomaly = true;
      // S3: a telemetry ref from a source ≠ the declared sensor —
      // matched on ref type so a rogue can't evade by declaring
      // issuer.type "org" (audit M-1 evasion).
      if (
        declaredDevice !== undefined &&
        TELEMETRY_TYPES.has(ref.type) &&
        ref.issuer.address.toLowerCase() !== declaredDevice
      ) {
        hop.fakeSensor = true;
      }
    }
  }
}
