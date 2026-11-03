/**
 * SLICE-207-7 (D-207-3, D-207-7): shipment lifecycle pack.
 *
 * Ledger = SoT: every guard re-derives hop state from the shipment's
 * own event stream — a caller can never fabricate order. hopIndex is
 * enforced: hop i+1 cannot handoff until hop i is paid (AC); no
 * handoff → no settle; no settle → no verify.
 *
 * Audit fixes (reviews/supply-chain-REVIEW.md): C-1 withHopLock
 * serializes settle; C-3 parties cross-checked vs plan; H-2 create
 * is idempotent; H-3 verify requires paid; M-6 append retries then
 * surfaces txHash.
 *
 * Emits: work_offer | work_accept | handoff | pay | verify (per hop).
 */

import {
  appendEvent,
  appendEventWithRetry,
  assertAddress,
  assertAmountUsdc,
  assertHopIndex,
  assertShipmentId,
  hopStatus,
  parseHandoffEvidence,
  parseHandoffRoles,
  seqFor,
  SHIPMENT_SOURCE,
  ShipmentOrderError,
  shipmentState,
  sumUsdc,
  withHopLock,
} from "./state";
import {
  statusRank,
  type HopJobExecutor,
  type HopJobSpec,
  type HopSpec,
  type ShipmentDeps,
  type ShipmentSpec,
} from "./types";

export { shipmentState, SHIPMENT_SOURCE, ShipmentOrderError };
export { verifyHop } from "./verify";
export type { ShipmentDeps };

/** Offer + N hop-linked jobs; hop i evaluator = hops[i+1].receiver,
 *  last = client (D-207-7). One job per hop. Idempotent at the offer
 *  level (H-2): second call on an existing shipmentId throws. */
export async function createShipment(
  spec: ShipmentSpec,
  deps: ShipmentDeps,
): Promise<{ shipmentId: string; jobs: Array<{ hopIndex: number; jobId?: string }> }> {
  const { shipmentId, client, hops } = spec;
  assertShipmentId(shipmentId);
  assertAddress(client, "client");
  if (hops.length === 0) throw new ShipmentOrderError("shipment needs >=1 hop");
  for (const h of hops) {
    assertAddress(h.receiver, `hops[].receiver`);
    assertAmountUsdc(h.amountUsdc);
  }

  // H-2: refuse a second offer — a retry must not create a second set
  // of chain jobs whose ids can never be re-recorded.
  const existing = await shipmentState(deps.ledger, shipmentId);
  if (existing.events.length > 0) {
    throw new ShipmentOrderError(`shipment ${shipmentId} already exists — use a new shipmentId`);
  }

  const jobs: Array<{ hopIndex: number; jobId?: string }> = [];
  const hopPlan = hops.map((h: HopSpec, i: number) => ({
    hopIndex: i,
    receiver: h.receiver,
    amountUsdc: h.amountUsdc,
    evaluator: (hops[i + 1]?.receiver ?? client) as string,
    jobId: undefined as string | undefined,
  }));

  if (deps.executor) {
    for (const plan of hopPlan) {
      const jobSpec: HopJobSpec = {
        shipmentId,
        hopIndex: plan.hopIndex,
        provider: plan.receiver as `0x${string}`,
        evaluator: plan.evaluator as `0x${string}`,
        client,
        amountUsdc: plan.amountUsdc,
        description: `shipment ${shipmentId} hop ${plan.hopIndex}`,
      };
      const ref = await deps.executor.createJob(jobSpec);
      plan.jobId = ref.jobId;
      jobs.push({ hopIndex: plan.hopIndex, jobId: ref.jobId });
    }
  }

  await appendEvent(deps.ledger, {
    source: SHIPMENT_SOURCE,
    sourceId: shipmentId,
    seq: 1,
    kind: "work_offer",
    actor: client,
    counterparty: hops[0]!.receiver,
    amountUsdc: sumUsdc(hops),
    at: new Date().toISOString(),
    payload: {
      taskRef: shipmentId,
      budgetUsdc: sumUsdc(hops),
      terms: { shipmentId, hopCount: hops.length, hops: hopPlan },
    },
  });
  return { shipmentId, jobs };
}

/** Accept a shipment offer — countersigned by the hop's receiver.
 *  Guard: the offer must exist (N-2). */
export async function acceptShipment(
  shipmentId: string,
  hopIndex: number,
  offerRef: string,
  actor: `0x${string}`,
  deps: ShipmentDeps,
): Promise<void> {
  assertShipmentId(shipmentId);
  assertHopIndex(hopIndex);
  const { events } = await shipmentState(deps.ledger, shipmentId);
  if (!events.some((e) => e.kind === "work_offer")) {
    throw new ShipmentOrderError(`shipment ${shipmentId} has no offer — cannot accept`);
  }
  await appendEvent(deps.ledger, {
    source: SHIPMENT_SOURCE,
    sourceId: shipmentId,
    seq: seqFor(hopIndex, "accept"),
    kind: "work_accept",
    actor,
    at: new Date().toISOString(),
    payload: { offerRef, taskRef: shipmentId },
  });
}

/** Custody moves to hop i's receiver. Guard (AC): hop i>0 requires
 *  hop i-1 status >= paid — next leg cannot start unpaid.
 *  M-4/C-3: actor/counterparty are cross-checked against the derived
 *  plan — the hander-offer must be the previous receiver (or the
 *  client at hop 0) and the receiver the plan's own receiver. */
export async function handoffHop(
  shipmentId: string,
  hopIndex: number,
  evidence: { deliverableHash?: `0x${string}`; proofOfDelivery?: string },
  actor: `0x${string}`,
  counterparty: `0x${string}`,
  deps: ShipmentDeps,
  epcis?: { what?: string; where?: string; why?: string },
  roles?: unknown, // N-2: raw input — typed param invites a lenient pre-parse
  evidenceRefs?: unknown, // 213-2: raw input — strict write parse inside
): Promise<void> {
  assertShipmentId(shipmentId);
  assertHopIndex(hopIndex);
  // 212-2/212-5: typed participants ride the handoff payload (D-211-7);
  // self-declared, never identity (D-212-3). Strict write-side parse.
  const parsedRoles = roles === undefined ? undefined : parseHandoffRoles(roles, counterparty);
  // 213-2 (D-211-8): typed evidence links — issuer mismatch → advisory-warn (D-213-3)
  const parsedEvidence = evidenceRefs === undefined ? undefined : parseHandoffEvidence(evidenceRefs, actor, counterparty);
  // H-3: serialize the guard→append pair — two concurrent handoffs of
  // the same hop must not both pass the "not yet handed off" check.
  await withHopLock(`${shipmentId}:${hopIndex}`, async () => {
    const { hops, client } = await shipmentState(deps.ledger, shipmentId);
    if (hops.length === 0) {
      throw new ShipmentOrderError(`shipment ${shipmentId} has no offer — cannot handoff`);
    }
    const hop = hops.find((h) => h.hopIndex === hopIndex);
    // M-2: a hopIndex outside the derived plan must not mint a phantom
    // hop carrying attacker roles in the public read model.
    if (!hop) {
      throw new ShipmentOrderError(`hop ${hopIndex} not in shipment plan — cannot handoff`);
    }
    // H-3: handoff is a one-way state transition, not idempotent data —
    // a repeat call would either silently dedupe (roles typo becomes
    // uncorrectable) or rewrite the read model (last-writer-wins).
    if (statusRank(hop.status) >= statusRank("handed_off")) {
      throw new ShipmentOrderError(`hop ${hopIndex} already handed off — cannot re-handoff`);
    }
    // M-4: the receiver must be the plan's own; the hander-offer must be
    // the previous custody holder (client at hop 0).
    if (hop.receiver && counterparty !== hop.receiver) {
      throw new ShipmentOrderError(
        `handoff counterparty ${counterparty.slice(0, 80)} ≠ plan receiver ${hop.receiver}`,
      );
    }
    const expectedActor = hopIndex === 0 ? client : hops.find((h) => h.hopIndex === hopIndex - 1)?.receiver;
    if (expectedActor && actor !== expectedActor) {
      throw new ShipmentOrderError(
        `handoff actor ${actor.slice(0, 80)} ≠ custody holder ${expectedActor}`,
      );
    }
    if (hopIndex > 0) {
      const prev = hopStatus(hops, hopIndex - 1);
      if (statusRank(prev) < statusRank("paid")) {
        throw new ShipmentOrderError(
          `hop ${hopIndex} blocked: hop ${hopIndex - 1} is "${prev}", must be paid first`,
        );
      }
    }
    // H-2 custodian==counterparty is enforced inside parseHandoffRoles.
    await appendEvent(deps.ledger, {
      source: SHIPMENT_SOURCE,
      sourceId: shipmentId,
      seq: seqFor(hopIndex, "handoff"),
      kind: "handoff",
      actor,
      counterparty,
      at: new Date().toISOString(),
      payload: {
        // H-4: explicit fields only, guarded keys last — an `epcis`
        // object carrying hopIndex/roles keys cannot override them.
        ...(epcis?.what ? { what: epcis.what } : {}),
        ...(epcis?.where ? { where: epcis.where } : {}),
        ...(epcis?.why ? { why: epcis.why } : {}),
        ...(evidence.deliverableHash ? { deliverableHash: evidence.deliverableHash } : {}),
        ...(evidence.proofOfDelivery ? { proofOfDelivery: evidence.proofOfDelivery } : {}),
        ...(parsedRoles ? { roles: parsedRoles } : {}),
        ...(parsedEvidence ? { evidence: parsedEvidence } : {}),
        shipmentId,
        hopIndex,
      },
    });
  });
}

/** Pay leg for hop i. Guards: hop i needs its own handoff (no
 *  evidence, no money); receiver must equal the plan receiver (C-3);
 *  whole guard→settle→append runs inside the per-hop lock (C-1). */
export async function settleHop(
  shipmentId: string,
  hopIndex: number,
  amountUsdc: string,
  payer: `0x${string}`,
  receiver: `0x${string}`,
  deps: ShipmentDeps & { executor: HopJobExecutor },
  opts?: { rail?: "x402" | "escrow" | "gateway" | "direct" | "other"; chainId?: number },
): Promise<void> {
  assertShipmentId(shipmentId);
  assertAmountUsdc(amountUsdc);
  assertAddress(receiver, "receiver");
  // C-1: serialize the guard→settle→append triple per hop.
  await withHopLock(`${shipmentId}:${hopIndex}`, async () => {
    const { hops } = await shipmentState(deps.ledger, shipmentId);
    const hop = hops.find((h) => h.hopIndex === hopIndex);
    if (!hop || statusRank(hop.status) < statusRank("handed_off")) {
      throw new ShipmentOrderError(
        `hop ${hopIndex} not handed off (status "${hop?.status ?? "missing"}") — settle refused`,
      );
    }
    if (statusRank(hop.status) >= statusRank("paid")) {
      return; // already settled — idempotent leg
    }
    if (hop.receiver && receiver !== hop.receiver) {
      throw new ShipmentOrderError(
        `settle receiver ${receiver} ≠ plan receiver ${hop.receiver}`,
      );
    }
    if (!hop.jobId) {
      // M-5: never let an unresolvable id reach the chain executor.
      throw new ShipmentOrderError(`hop ${hopIndex} has no jobId — cannot settle`);
    }
    const { txHash } = await deps.executor.settle(hop.jobId, amountUsdc);
    // M-6: the chain write already happened — retry the ledger write;
    // on total failure surface txHash so ops can reconcile by backfill.
    try {
      await appendEventWithRetry(deps.ledger, {
        source: SHIPMENT_SOURCE,
        sourceId: shipmentId,
        seq: seqFor(hopIndex, "pay"),
        kind: "pay",
        actor: payer,
        counterparty: receiver,
        amountUsdc,
        at: new Date().toISOString(),
        payload: {
          rail: opts?.rail ?? "escrow",
          ...(opts?.chainId ? { chainId: opts.chainId } : {}),
          jobId: hop.jobId,
          ...(txHash ? { txHash: txHash as `0x${string}` } : {}),
          shipmentId,
          hopIndex,
        },
      });
    } catch (err) {
      throw new ShipmentOrderError(
        `settled onchain (jobId=${hop.jobId}${txHash ? `, txHash=${txHash}` : ""}) ` +
        `but ledger write failed — reconcile manually: ${err instanceof Error ? err.message : err}`,
      );
    }
  });
}

// verifyHop moved to ./verify.ts (max-lines) — re-exported above.
