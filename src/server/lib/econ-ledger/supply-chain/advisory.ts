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

export interface ShipmentAdvisoryFlags {
  /** §25 S2: a temperature-type evidence ref was asserted by a
   *  non-party issuer — the reading comes from outside custody and
   *  needs policy review. §25 "payment HELD" maps to this advisory
   *  in v1 (no automatic block). */
  tempViolation?: boolean;
  /** §25 S3: a device-typed evidence issuer differs from the hop's
   *  declared `roles.device`. Only set when a device IS declared —
   *  without a declared sensor there is nothing to compare against,
   *  so the flag stays off rather than guessing. */
  fakeSensor?: boolean;
  /** §25 S4: the hop reached handed_off (or later) with no evidence
   *  refs — a telemetry gap. The chain stays valid (backward compat,
   *  D-211-2); the flag marks the gap for the verifier. */
  missingEvidence?: boolean;
  /** §25 S5: a gps-type evidence ref was asserted by a non-party
   *  issuer — the route claim comes from outside custody, the
   *  geo-policy engine judges plausibility (v2). §25 "CONFLICT"
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
    const declaredDevice = hop.roles?.device?.address;
    for (const ref of hop.evidence ?? []) {
      // S2: temperature claim asserted outside the hop's parties.
      if (ref.type === "temperature" && ref.issuerMatchesParty === false) {
        hop.tempViolation = true;
      }
      // S5: gps claim asserted outside the hop's parties.
      if (ref.type === "gps" && ref.issuerMatchesParty === false) {
        hop.gpsAnomaly = true;
      }
      // S3: device-typed issuer ≠ the declared sensor — only when a
      // device is declared (no declared sensor → nothing to compare).
      if (
        declaredDevice !== undefined &&
        ref.issuer.type === "device" &&
        ref.issuer.address.toLowerCase() !== declaredDevice.toLowerCase()
      ) {
        hop.fakeSensor = true;
      }
    }
  }
}
