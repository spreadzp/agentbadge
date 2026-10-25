/**
 * SLICE-207-7: supply-chain pack — shared state/helpers.
 *
 * Shipment state is DERIVED from the event log (source=supply_chain,
 * sourceId=shipmentId) — the log is SoT, never caller input.
 */

import type { EconEventStored, EconLedgerStore } from "@agentbadge/database";
import {
  buildEconomicEvent,
  type BuildEventInput,
  type EconomicEvent,
  type HandoffPayload,
  type ShipmentHop,
} from "@agentbadge/econ-events";
import { statusRank, type HopSpec, type HopStatus } from "./types";

export const SHIPMENT_SOURCE = "supply_chain";
export const SHIPMENT_ID_RE = /^[\w.:-]{1,128}$/;
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export const DECIMAL_USDC_RE = /^\d{1,12}(\.\d{1,6})?$/;

export class ShipmentOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShipmentOrderError";
  }
}

// ─── Per-hop settle lock (audit C-1) ─────────────────────────────
// Serializes guard→settle→append per (shipmentId, hopIndex) so two
// concurrent requests can't both pass the "not yet paid" check and
// double-pay onchain. Single-process scope — a multi-instance deploy
// must upgrade to pg_advisory_xact_lock (documented in DECISIONS).
const hopLocks = new Map<string, Promise<void>>();

export async function withHopLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = hopLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const cur = new Promise<void>((r) => { release = r; });
  hopLocks.set(key, prev.then(() => cur));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (hopLocks.get(key) === cur) hopLocks.delete(key);
  }
}

// ─── Validation (audit C-3, M-2, M-3) ────────────────────────────
export function assertShipmentId(id: string): void {
  if (!SHIPMENT_ID_RE.test(id)) {
    throw new ShipmentOrderError(`shipmentId must match ${SHIPMENT_ID_RE}`);
  }
}

export function assertAddress(addr: string, field: string): asserts addr is `0x${string}` {
  if (!ADDRESS_RE.test(addr)) {
    throw new ShipmentOrderError(`${field} is not a valid 0x-address: ${addr}`);
  }
}

export function assertAmountUsdc(amount: string): void {
  if (!DECIMAL_USDC_RE.test(amount)) {
    throw new ShipmentOrderError(`amountUsdc must be decimal USDC: ${amount}`);
  }
}

// ─── Ledger append (awaited — pack guards re-read immediately) ────
export async function appendEvent(
  ledger: EconLedgerStore,
  input: BuildEventInput,
): Promise<EconomicEvent> {
  const event = buildEconomicEvent(input);
  await ledger.append([event]);
  return event;
}

/** Retry-able append for post-chain writes (audit M-6). */
export async function appendEventWithRetry(
  ledger: EconLedgerStore,
  input: BuildEventInput,
  attempts = 3,
): Promise<EconomicEvent> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await appendEvent(ledger, input);
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 50 * 2 ** i));
    }
  }
  throw last;
}

// ─── Derived state ───────────────────────────────────────────────
/** Derive hop states from the shipment's own event stream (SoT read). */
export async function shipmentState(
  ledger: EconLedgerStore,
  shipmentId: string,
): Promise<{ hops: ShipmentHop[]; events: EconomicEvent[]; client?: string }> {
  const rows = await ledger.listBySourceId(SHIPMENT_SOURCE, shipmentId);
  const events = rows.map((r: EconEventStored) => r.event);
  const hops = new Map<number, ShipmentHop>();
  let client: string | undefined;
  for (const e of events) {
    if (e.kind === "handoff") {
      const p = e.payload as HandoffPayload;
      const hop = hops.get(p.hopIndex) ?? { hopIndex: p.hopIndex, status: "offered" as HopStatus };
      if (statusRank(hop.status) < statusRank("handed_off")) hop.status = "handed_off";
      hops.set(p.hopIndex, hop);
    } else if (e.kind === "pay" || e.kind === "verify") {
      const p = e.payload as { shipmentId?: string; hopIndex?: number; jobId?: string };
      const idx = p.hopIndex;
      if (idx === undefined) continue;
      const hop = hops.get(idx) ?? { hopIndex: idx, status: "offered" as HopStatus };
      const stage = e.kind === "pay" ? "paid" : "verified";
      if (statusRank(hop.status) < statusRank(stage)) hop.status = stage;
      if (e.kind === "pay" && p.jobId) hop.jobId = p.jobId;
      hops.set(idx, hop);
    } else if (e.kind === "work_offer") {
      client = e.actor;
      const terms = (e.payload as { terms?: { hops?: Array<{ hopIndex: number; receiver: string; jobId?: string }> } }).terms;
      for (const h of terms?.hops ?? []) {
        const hop = hops.get(h.hopIndex) ?? { hopIndex: h.hopIndex, status: "offered" as HopStatus };
        hop.receiver = h.receiver;
        if (h.jobId) hop.jobId = h.jobId;
        hops.set(h.hopIndex, hop);
      }
    }
  }
  return { hops: [...hops.values()].sort((a, b) => a.hopIndex - b.hopIndex), events, client };
}

export function hopStatus(hops: ShipmentHop[], idx: number): HopStatus {
  return hops.find((h) => h.hopIndex === idx)?.status ?? "offered";
}

// ─── Misc helpers ────────────────────────────────────────────────
/** BigInt decimal sum — float math drifts across many hops (audit M-1). */
export function sumUsdc(hops: HopSpec[]): string {
  const SCALE = 1_000_000n;
  let micros = 0n;
  for (const h of hops) {
    const [whole, frac = ""] = h.amountUsdc.split(".");
    micros += BigInt(whole) * SCALE + BigInt((frac + "000000").slice(0, 6));
  }
  const w = micros / SCALE;
  const f = String(micros % SCALE).padStart(6, "0").replace(/0+$/, "");
  return f ? `${w}.${f}` : String(w);
}

/** Deterministic seq per (hopIndex, stage) — idempotency keys stay
 *  stable across retries/backfill (D-207-2). Offer owns seq 1;
 *  seq 2 is intentionally reserved (per-hop space starts at 3). */
export function seqFor(hopIndex: number, stage: "accept" | "handoff" | "pay" | "verify"): number {
  const stageIdx = { accept: 1, handoff: 2, pay: 3, verify: 4 }[stage];
  return 2 + hopIndex * 4 + stageIdx;
}
