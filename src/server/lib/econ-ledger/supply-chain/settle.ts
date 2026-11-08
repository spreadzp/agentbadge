/** 216-3 (max-lines split): settle leg moved out of shipment.ts —
 *  same module, same guards; re-exported from shipment.ts so the
 *  public import surface is unchanged. */

import {
  appendEventWithRetry,
  assertAddress,
  assertHopIndex,
  assertPositiveAmountUsdc,
  assertShipmentId,
  hopLockKey,
  seqFor,
  SHIPMENT_SOURCE,
  ShipmentOrderError,
  shipmentState,
  usdcMicros,
  withHopLock,
} from "./state";
import { statusRank, type HopJobExecutor, type ShipmentDeps } from "./types";

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
  assertHopIndex(hopIndex);
  assertPositiveAmountUsdc(amountUsdc);
  assertAddress(receiver, "receiver");
  // C-1: serialize the guard→settle→append triple per hop.
  await withHopLock(hopLockKey(shipmentId, hopIndex), async () => {
    // light read — guards need status/receiver/jobId/disputed only.
    const { hops, events } = await shipmentState(deps.ledger, shipmentId, { light: true });
    const hop = hops.find((h) => h.hopIndex === hopIndex);
    if (!hop || statusRank(hop.status) < statusRank("handed_off")) {
      throw new ShipmentOrderError(
        `hop ${hopIndex} not handed off (status "${hop?.status ?? "missing"}") — settle refused`,
      );
    }
    if (statusRank(hop.status) >= statusRank("paid")) {
      // 216-3 (audit M-3): the idempotent leg must MATCH the recorded
      // pay — a re-send with a different amount/receiver is a bug or
      // an attempt to hide a divergent settle, never a silent no-op.
      const pay = events.find(
        (e) =>
          e.kind === "pay" &&
          e.seq === seqFor(hopIndex, "pay") &&
          typeof e.payload === "object" &&
          e.payload !== null &&
          (e.payload as { shipmentId?: string }).shipmentId === shipmentId &&
          (e.payload as { hopIndex?: number }).hopIndex === hopIndex,
      );
      const recorded = pay?.amountUsdc;
      const recordedReceiver = pay?.counterparty;
      if (
        recorded !== undefined &&
        usdcMicros(recorded) !== usdcMicros(amountUsdc)
      ) {
        throw new ShipmentOrderError(
          `hop ${hopIndex} already paid ${recorded} — re-settle amount ${amountUsdc} diverges`,
        );
      }
      if (
        recordedReceiver !== undefined &&
        recordedReceiver.toLowerCase() !== receiver.toLowerCase()
      ) {
        throw new ShipmentOrderError(
          `hop ${hopIndex} already paid to ${recordedReceiver} — re-settle receiver ${receiver} diverges`,
        );
      }
      return; // already settled — idempotent leg
    }
    // 214-3 (D-214-4): a disputed hop cannot settle — the receiver's
    // fail-verdict stands until a dispute engine exists (block 10).
    if (hop.disputed) {
      throw new ShipmentOrderError(
        `hop ${hopIndex} is disputed — settle refused until resolution`,
      );
    }
    // 216-3 (audit H-5): fail closed — a plan hop without a receiver
    // is malformed; it must not skip the receiver check.
    if (hop.receiver === undefined || receiver.toLowerCase() !== hop.receiver.toLowerCase()) {
      throw new ShipmentOrderError(
        `settle receiver ${receiver} ≠ plan receiver ${hop.receiver ?? "<unset>"}`,
      );
    }
    // 216-3 (audit M-4): the requested pay must equal the plan's own
    // declared amount — the ledger records what the caller asked, so
    // an unchecked gap is invisible in the replay.
    if (
      hop.planAmountUsdc !== undefined &&
      usdcMicros(hop.planAmountUsdc) !== usdcMicros(amountUsdc)
    ) {
      throw new ShipmentOrderError(
        `settle amount ${amountUsdc} ≠ plan amount ${hop.planAmountUsdc} for hop ${hopIndex}`,
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
