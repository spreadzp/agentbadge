/**
 * SLICE-207-9 (D-207-8): verify leg split from shipment.ts (max-lines).
 *
 * A `verify` event carries `criteriaDigest` — keccak256 of the offer's
 * canonical `terms` — so a third party can reproduce which acceptance
 * criteria the verdict applied (ERC-8004 requestHash precedent).
 * `policyRef` is only an optional URI resolver — the digest is the
 * binding. Explicit `extra.criteriaDigest` overrides the auto binding.
 */

import { hashCanonical } from "../../eaas/verdict";
import {
  appendEvent,
  assertHopIndex,
  assertShipmentId,
  bound,
  seqFor,
  SHIPMENT_SOURCE,
  ShipmentOrderError,
  shipmentState,
  withHopLock,
} from "./state";
import { statusRank, type ShipmentDeps } from "./types";

/** Final hop verification — evaluator verdict per hop.
 *  H-3 (207 audit): requires the hop already paid — verified is terminal.
 *  214-5 (audit H-3): the whole guard→append runs inside withHopLock
 *  and the actor must BE the plan's evaluator for this hop —
 *  hops[i+1].receiver, or the client on the last hop (D-207-7). A
 *  fail outcome is the evaluator's rejection and projects as a
 *  dispute on its own authority; inconclusive records a verdict
 *  without lifting status (audit H-2). */
export async function verifyHop(
  shipmentId: string,
  hopIndex: number,
  outcome: "pass" | "fail" | "inconclusive",
  actor: `0x${string}`,
  counterparty: `0x${string}`,
  deps: ShipmentDeps,
  extra?: {
    deliverableHash?: `0x${string}`;
    score?: number;
    txHash?: `0x${string}`;
    policyRef?: string;
    criteriaDigest?: `0x${string}`;
    evidenceHash?: `0x${string}`;
    verifierVersion?: string;
  },
): Promise<void> {
  assertShipmentId(shipmentId);
  assertHopIndex(hopIndex);
  await withHopLock(`${shipmentId}:${hopIndex}`, async () => {
    const { hops, client, events } = await shipmentState(deps.ledger, shipmentId, { light: true });
    const hop = hops.find((h) => h.hopIndex === hopIndex);
    if (!hop || statusRank(hop.status) < statusRank("paid")) {
      throw new ShipmentOrderError(
        `hop ${hopIndex} not paid (status "${hop?.status ?? "missing"}") — verify refused`,
      );
    }
    if (hop.disputed) {
      throw new ShipmentOrderError(`hop ${hopIndex} is disputed — verdict refused until resolution`);
    }
    // evaluator = next hop's receiver, else the client (D-207-7) —
    // string-compare on caller-supplied actor (trusted-boundary, M-7).
    const evaluator = hops.find((h) => h.hopIndex === hopIndex + 1)?.receiver ?? client;
    if (evaluator !== undefined && actor.toLowerCase() !== evaluator.toLowerCase()) {
      throw new ShipmentOrderError(
        `verify actor ${actor.slice(0, 80)} ≠ hop evaluator ${evaluator} — ` +
          `only the plan's evaluator may issue a verdict`,
      );
    }
    const offerTerms = (events.find((e) => e.kind === "work_offer")?.payload as
      | { terms?: unknown }
      | undefined)?.terms;
    const criteriaDigest =
      extra?.criteriaDigest ??
      (offerTerms !== undefined ? hashCanonical(offerTerms) : undefined);
    await appendEvent(deps.ledger, {
      source: SHIPMENT_SOURCE,
      sourceId: shipmentId,
      seq: seqFor(hopIndex, "verify"),
      kind: "verify",
      actor,
      counterparty,
      at: new Date().toISOString(),
      payload: {
        outcome,
        shipmentId,
        hopIndex,
        ...(extra?.deliverableHash ? { deliverableHash: extra.deliverableHash } : {}),
        ...(extra?.score !== undefined ? { score: extra.score } : {}),
        ...(extra?.txHash ? { txHash: extra.txHash } : {}),
        ...(criteriaDigest ? { criteriaDigest } : {}),
        ...(extra?.policyRef ? { policyRef: extra.policyRef } : {}),
        ...(extra?.evidenceHash ? { evidenceHash: extra.evidenceHash } : {}),
        ...(extra?.verifierVersion ? { verifierVersion: extra.verifierVersion } : {}),
      },
    });
  });
}

/**
 * 214-3 (D-214-4, §25 S6): receiver dispute stub — "sender=delivered,
 * receiver=not received → DISPUTE". The honest carrier inside
 * econ-events/1 is a `verify` event with outcome:"fail" + reasonCodes
 * (the closed kind set takes a spec bump for a dedicated kind — v1
 * reuses the verdict vocabulary).
 *
 * Guards: the hop must be handed off (nothing to dispute before a
 * delivery claim exists) and not yet paid — post-settle verdicts go
 * through verifyHop (audit M-3). The actor must be the hop's
 * receiver — only the party claiming non-receipt may dispute, and a
 * receiver-less hop fails closed. Occupies the per-hop verdict seq
 * slot and the whole guard→append runs inside withHopLock — a
 * concurrent settle cannot slip between the disputed check and the
 * event landing.
 *
 * settleHop refuses while `hop.disputed` stands; there is no
 * un-dispute path in v1 (dispute engine = block 10).
 */
export async function disputeHop(
  shipmentId: string,
  hopIndex: number,
  actor: `0x${string}`,
  deps: ShipmentDeps,
  extra?: {
    reasonCodes?: string[];
    deliverableHash?: `0x${string}`;
    verifierVersion?: string;
  },
): Promise<void> {
  assertShipmentId(shipmentId);
  assertHopIndex(hopIndex);
  await withHopLock(`${shipmentId}:${hopIndex}`, async () => {
    const { hops } = await shipmentState(deps.ledger, shipmentId, { light: true });
    const hop = hops.find((h) => h.hopIndex === hopIndex);
    if (!hop || statusRank(hop.status) < statusRank("handed_off")) {
      throw new ShipmentOrderError(
        `hop ${hopIndex} not handed off (status "${hop?.status ?? "missing"}") — nothing to dispute`,
      );
    }
    if (hop.disputed) {
      throw new ShipmentOrderError(`hop ${hopIndex} already disputed`);
    }
    // M-3: the dispute stub covers "not received" BEFORE settlement —
    // a paid/verified hop is past that point; verdicts go through verify.
    if (statusRank(hop.status) >= statusRank("paid")) {
      throw new ShipmentOrderError(
        `hop ${hopIndex} already ${hop.status} — post-settle verdicts go through verifyHop`,
      );
    }
    // fail-closed: a receiver-less hop can never be disputed.
    if (hop.receiver === undefined || actor.toLowerCase() !== hop.receiver.toLowerCase()) {
      throw new ShipmentOrderError(
        `dispute actor ${actor.slice(0, 80)} ≠ hop receiver ${hop.receiver ?? "<unset>"} — ` +
          `only the party claiming non-receipt may dispute`,
      );
    }
    const reasonCodes = (extra?.reasonCodes ?? []).map((c) => bound(c, 64)).slice(0, 32);
    await appendEvent(deps.ledger, {
      source: SHIPMENT_SOURCE,
      sourceId: shipmentId,
      // same per-hop verdict slot as verify — v1 has no un-dispute, so
      // one verdict per hop stays the invariant.
      seq: seqFor(hopIndex, "verify"),
      kind: "verify",
      actor,
      counterparty: hop.receiver,
      at: new Date().toISOString(),
      payload: {
        outcome: "fail",
        ...(reasonCodes.length ? { reasonCodes } : {}),
        shipmentId,
        hopIndex,
        ...(extra?.deliverableHash ? { deliverableHash: extra.deliverableHash } : {}),
        ...(extra?.verifierVersion ? { verifierVersion: extra.verifierVersion } : {}),
      },
    });
  });
}
