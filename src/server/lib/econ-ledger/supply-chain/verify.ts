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
  assertShipmentId,
  seqFor,
  SHIPMENT_SOURCE,
  ShipmentOrderError,
  shipmentState,
} from "./state";
import { statusRank, type ShipmentDeps } from "./types";

/** Final hop verification — evaluator verdict per hop.
 *  H-3: requires the hop already paid — verified is terminal. */
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
  const { hops, events } = await shipmentState(deps.ledger, shipmentId);
  const hop = hops.find((h) => h.hopIndex === hopIndex);
  if (!hop || statusRank(hop.status) < statusRank("paid")) {
    throw new ShipmentOrderError(
      `hop ${hopIndex} not paid (status "${hop?.status ?? "missing"}") — verify refused`,
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
}
