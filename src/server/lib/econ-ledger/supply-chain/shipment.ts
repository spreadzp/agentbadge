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
  assertAddress,
  assertPositiveAmountUsdc,
  assertHandoffOrder,
  assertHopIndex,
  assertShipmentId,
  createLockKey,
  hopLockKey,
  seqFor,
  SHIPMENT_SOURCE,
  ShipmentOrderError,
  shipmentState,
  sumUsdc,
  withHopLock,
} from "./state";
import { parseHandoffEvidence, parseHandoffRoles } from "./claims";
import {
  type HopJobSpec,
  type HopSpec,
  type ShipmentDeps,
  type ShipmentSpec,
} from "./types";

export { shipmentState, SHIPMENT_SOURCE, ShipmentOrderError };

/** 213-5 (audit M-2): hard bound on hops per shipment plan. */
const MAX_HOPS = 64;

export { disputeHop, verifyHop } from "./verify";
export { settleHop } from "./settle"; // moved out for max-lines
export type { ShipmentDeps };

/** Offer + N hop-linked jobs; hop i evaluator = hops[i+1].receiver,
 *  last = client (D-207-7). One job per hop. Idempotent at the offer
 *  level (H-2): second call on an existing shipmentId throws. */
export async function createShipment(
  spec: ShipmentSpec,
  deps: ShipmentDeps,
  /** 216-3 (audit C-1): jobIds from a previous partially-failed create
   *  — hops carrying one reuse it instead of minting (and funding) a
   *  duplicate escrow. Get them from the thrown error's createdJobIds. */
  opts?: { resumeJobIds?: Record<number, string> },
): Promise<{ shipmentId: string; jobs: Array<{ hopIndex: number; jobId?: string }> }> {
  const { shipmentId, client, hops } = spec;
  assertShipmentId(shipmentId);
  assertAddress(client, "client");
  if (hops.length === 0) throw new ShipmentOrderError("shipment needs >=1 hop");
  // 213-5 (audit M-2): bound the plan — terms.hops is unbounded on read,
  // and shipmentState rebuild is O(hops^2) per lifecycle.
  if (hops.length > MAX_HOPS) {
    throw new ShipmentOrderError(`shipment has ${hops.length} hops — max ${MAX_HOPS}`);
  }
  for (const h of hops) {
    assertAddress(h.receiver, `hops[].receiver`);
    // 216-3 (audit C-2): a zero-amount hop mints a zero-budget escrow —
    // budget 0 skips the onchain settle check entirely.
    assertPositiveAmountUsdc(h.amountUsdc);
  }

  // H-2/H-4: refuse a second offer — and serialize the whole
  // check→create→append under the shipment lock so two concurrent
  // creates can't each pass the existence check and mint a second
  // set of funded jobs whose ids can never be re-recorded (audit H-4).
  return withHopLock(createLockKey(shipmentId), async () => {
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

    /** 216-3 (audit C-1): every jobId minted (or resumed) this run —
     *  attached to any failure so ops can resume without double-funding. */
    const createdJobIds: Record<number, string> = {};
    const orphanError = (msg: string): ShipmentOrderError => {
      const err = new ShipmentOrderError(
        `${msg} — created jobIds ${JSON.stringify(createdJobIds)}; ` +
          `resume with createShipment(spec, deps, { resumeJobIds })`,
      );
      (err as ShipmentOrderError & { createdJobIds?: Record<number, string> })
        .createdJobIds = { ...createdJobIds };
      return err;
    };

    try {
      if (deps.executor) {
        for (const plan of hopPlan) {
          const resumed = opts?.resumeJobIds?.[plan.hopIndex];
          if (resumed !== undefined) {
            plan.jobId = resumed;
            createdJobIds[plan.hopIndex] = resumed;
            jobs.push({ hopIndex: plan.hopIndex, jobId: resumed });
            continue;
          }
          const jobSpec: HopJobSpec = {
            shipmentId,
            hopIndex: plan.hopIndex,
            provider: plan.receiver as `0x${string}`,
            evaluator: plan.evaluator as `0x${string}`,
            client,
            amountUsdc: plan.amountUsdc,
            description: `shipment ${shipmentId} hop ${plan.hopIndex}`,
            ...(hops[plan.hopIndex]!.ttlSec !== undefined
              ? { ttlSec: hops[plan.hopIndex]!.ttlSec }
              : {}),
          };
          const ref = await deps.executor.createJob(jobSpec);
          plan.jobId = ref.jobId;
          createdJobIds[plan.hopIndex] = ref.jobId;
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
    } catch (err) {
      // C-1: an orphan set of funded jobs is recoverable ONLY if the
      // caller learns their ids — attach them, loudly.
      if (Object.keys(createdJobIds).length > 0) {
        throw orphanError(err instanceof Error ? err.message : String(err));
      }
      throw err;
    }
    return { shipmentId, jobs };
  });
}

/** Accept a shipment offer — countersigned by the hop's receiver.
 *  Guards (216-3 audit H-2): offer exists, hopIndex is IN the plan,
 *  actor IS the plan's receiver (fail-closed on a receiver-less plan),
 *  one canonical accept per hop — idempotent on a matched re-send,
 *  refuse on a second accept. */
export async function acceptShipment(
  shipmentId: string,
  hopIndex: number,
  offerRef: string,
  actor: `0x${string}`,
  deps: ShipmentDeps,
): Promise<void> {
  assertShipmentId(shipmentId);
  assertHopIndex(hopIndex);
  await withHopLock(hopLockKey(shipmentId, hopIndex), async () => {
    const { hops, events } = await shipmentState(deps.ledger, shipmentId, { light: true });
    if (!events.some((e) => e.kind === "work_offer" && e.seq === 1)) {
      throw new ShipmentOrderError(`shipment ${shipmentId} has no offer — cannot accept`);
    }
    if (events.some((e) => e.kind === "work_accept" && e.seq === seqFor(hopIndex, "accept"))) {
      throw new ShipmentOrderError(`hop ${hopIndex} already accepted — cannot re-accept`);
    }
    const hop = hops.find((h) => h.hopIndex === hopIndex);
    if (!hop) {
      throw new ShipmentOrderError(`hop ${hopIndex} not in shipment plan — cannot accept`);
    }
    if (hop.receiver === undefined || actor.toLowerCase() !== hop.receiver.toLowerCase()) {
      throw new ShipmentOrderError(
        `accept actor ${actor.slice(0, 80)} ≠ plan receiver ${hop.receiver ?? "<unset>"} — ` +
          `only the plan's receiver may accept the hop`,
      );
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
  // H-3: serialize the guard→append pair — two concurrent handoffs of
  // the same hop must not both pass the "not yet handed off" check.
  await withHopLock(hopLockKey(shipmentId, hopIndex), async () => {
    // 213-5 (audit M-2): light read — guards need status/receiver only;
    // roles/evidence lifts are skipped.
    const { hops, client } = await shipmentState(deps.ledger, shipmentId, { light: true });
    assertHandoffOrder(hops, client, hopIndex, actor, counterparty);
    // 213-5 (audit M-3): strict parses run INSIDE the lock after guards —
    // a rejected handoff can't burn parse work against a live shipment,
    // and a roles/evidence typo can't slip an event past a stale guard read.
    // 212-2/212-5: typed participants ride the handoff payload (D-211-7);
    // self-declared, never identity (D-212-3). Strict write-side parse.
    // H-2 custodian==counterparty is enforced inside parseHandoffRoles.
    const parsedRoles = roles === undefined ? undefined : parseHandoffRoles(roles, counterparty);
    // 213-2 (D-211-8): typed evidence links — issuer mismatch → advisory-warn (D-213-3).
    // ctx flows into the advisory so log correlation needs no manual join.
    const parsedEvidence = evidenceRefs === undefined ? undefined : parseHandoffEvidence(
      evidenceRefs, actor, counterparty, { shipmentId, hopIndex },
    );
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

// settleHop moved to ./settle.ts, verifyHop to ./verify.ts (max-lines)
// — both re-exported above; the import surface is unchanged.
