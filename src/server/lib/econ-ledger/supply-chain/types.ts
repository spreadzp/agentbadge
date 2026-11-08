/**
 * SLICE-207-7 (D-207-3, D-207-7): supply-chain domain pack types.
 *
 * A shipment = a chain of handoff hops, each paid via its own
 * hop-linked ERC-8183 job (one job per hop — no multi-release).
 * The LEDGER is the source of truth for shipment state: hop order
 * is enforced by reading events, never by trusting caller input.
 */

import type { EconLedgerStore } from "@agentbadge/database";

/** One hop of a shipment: receiver gets custody + pay for the leg. */
export interface HopSpec {
  /** 0x-address of the party receiving the hop (carrier/warehouse). */
  receiver: `0x${string}`;
  /** Pay for the leg, decimal USDC. */
  amountUsdc: string;
  /** EPCIS "what" — goods/consignment description. */
  what?: string;
  /** EPCIS "where" — location of the hop. */
  where?: string;
  /** EPCIS "why" — business step (e.g. "linehaul", "last_mile"). */
  why?: string;
  /** Job expiry override (seconds from creation). */
  ttlSec?: number;
}

export interface ShipmentSpec {
  /** Correlation key — becomes `sourceId` on every shipment event. */
  shipmentId: string;
  /** The party creating + funding the shipment (0x-address). */
  client: `0x${string}`;
  hops: HopSpec[];
}

/** Shared deps for shipment lifecycle functions. */
export interface ShipmentDeps {
  ledger: EconLedgerStore;
  executor?: HopJobExecutor;
}

/** Hop job executor — the chain seam. Prod = ERC-8183 (D-207-7). */
export interface HopJobExecutor {
  /**
   * Create the hop's escrow job. `evaluator` for hop i is
   * `hops[i+1].receiver` (next custody) — last hop's evaluator is the
   * client. Returns the onchain job id + optional creation txHash.
   */
  createJob(hop: HopJobSpec): Promise<HopJobRef>;
  /** Settle the hop's job (pays the receiver). Returns settle txHash. */
  settle(jobId: string, amountUsdc: string): Promise<{ txHash?: string }>;
}

/** What a hop job must carry — evaluator = next hop's receiver. */
export interface HopJobSpec {
  shipmentId: string;
  hopIndex: number;
  /** The receiver the job pays (this hop's HopSpec.receiver). */
  provider: `0x${string}`;
  evaluator: `0x${string}`;
  client: `0x${string}`;
  amountUsdc: string;
  description: string;
  /** deliverableHash of the handoff evidence, bound on submit. */
  deliverableHash?: `0x${string}`;
  /** 216-3 (audit M-6): job expiry override (seconds from creation) —
   *  forwarded from HopSpec.ttlSec; ignored before. */
  ttlSec?: number;
}

export interface HopJobRef {
  jobId: string;
  txHash?: string;
}

/** Furthest stage of a hop — derived from the event log. */
export type HopStatus = "offered" | "handed_off" | "paid" | "verified";

const ORDER: Record<HopStatus, number> = {
  offered: 0,
  handed_off: 1,
  paid: 2,
  verified: 3,
};

export function statusRank(s: HopStatus): number {
  const r = ORDER[s];
  if (r === undefined) throw new Error(`unknown hop status: ${s}`);
  return r;
}
