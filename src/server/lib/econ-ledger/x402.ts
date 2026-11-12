/**
 * SLICE-207-3: x402 settled payment → `pay` leg.
 *
 * Hook: settlePhase() in ../x402-settle-seam.ts — shared by the atomic
 * seam and the two-phase commit(). sourceId = tx hash → settle retries
 * dedupe; seq=1 (one pay leg per settlement tx).
 */

import type { BuildEventInput } from "@agentbadge/econ-events";
import type { EconLedgerStore } from "@agentbadge/database";
import { emitEconomicEvent } from "./emit.js";

const HEX32 = /^0x[0-9a-fA-F]{64}$/;

/** x402 network → numeric chainId where known; undefined otherwise. */
const NETWORK_CHAIN_ID: Record<string, number> = {
  arc: 5042001,
  "arc-testnet": 5042002,
  eip155: 0, // sentinel — eip155:NNN handled below
};

function chainIdOf(network: string): number | undefined {
  if (NETWORK_CHAIN_ID[network]) return NETWORK_CHAIN_ID[network];
  const m = /^eip155:(\d+)$/.exec(network);
  if (m) return Number(m[1]);
  return undefined;
}

export interface SettleLeg {
  payer: string;
  payTo: string;
  /** atomic base units — bigint or decimal string (requirements.amount). */
  amountAtomic: bigint | string;
  tx?: string;
  network: string;
  scheme: string;
  /** Paid resource URL/path — lands in payload.endpoint (242-8). */
  resource?: string;
}

/** Pure mapper — settled payment → canonical `pay` input. */
export function settleToEconomic(leg: SettleLeg): BuildEventInput {
  const atomic = BigInt(leg.amountAtomic);
  const usdc = (Number(atomic) / 1e6).toFixed(6).replace(/0+$/, "").replace(/\.$/, ".0");
  return {
    source: "x402",
    // sourceId must not contain ":" (idempotencyKey shape); "~" is safe.
    sourceId: leg.tx ?? `${leg.payer}~${leg.payTo}~${atomic}`,
    seq: 1,
    kind: "pay",
    actor: leg.payer,
    counterparty: leg.payTo,
    amountUsdc: usdc,
    at: new Date().toISOString(),
    payload: {
      rail: "x402",
      txHash: leg.tx && HEX32.test(leg.tx) ? leg.tx : undefined,
      chainId: chainIdOf(leg.network),
      endpoint: leg.resource,
    },
  };
}

/** Emit after a successful settle — fire-and-forget, never blocks. */
export function emitX402Settle(
  leg: SettleLeg,
  ledger?: EconLedgerStore | null,
): void {
  emitEconomicEvent(settleToEconomic(leg), ledger);
}
