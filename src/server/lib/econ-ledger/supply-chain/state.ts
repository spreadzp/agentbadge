/** SLICE-207-7: supply-chain pack — shared state/helpers.
 *  Shipment state is DERIVED from the event log (source=supply_chain,
 *  sourceId=shipmentId) — the log is SoT, never caller input. */

import type { EconLedgerStore } from "@agentbadge/database";
import {
  ADDRESS,
  buildEconomicEvent,
  type BuildEventInput,
  DECIMAL_USDC,
  type EconomicEvent,
  type ShipmentHop,
} from "@agentbadge/econ-events";
import { statusRank, type HopStatus } from "./types";

export type { AdvisoryShipmentHop, ShipmentAdvisoryFlags } from "./advisory";
export { shipmentState } from "./project";

export const SHIPMENT_SOURCE = "supply_chain";
export const SHIPMENT_ID_RE = /^[\w.:-]{1,128}$/;
// 212-5: single source for shared regexes — previously re-declared
// here and could drift from the package contract.
export const ADDRESS_RE = ADDRESS;
export const DECIMAL_USDC_RE = DECIMAL_USDC;

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
  // Store the tail we compare against in finally — comparing to `cur`
  // never matched, so entries leaked per key (re-audit N-1).
  const tail = prev.then(() => cur);
  hopLocks.set(key, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (hopLocks.get(key) === tail) hopLocks.delete(key);
  }
}

// ─── Validation (audit C-3, M-2, M-3) ────────────────────────────
/** 213-5 (audit M-7): bound attacker-influenced text before it reaches an
 *  error message or a log line — strip control/format chars, then slice.
 *  Length-only capping leaves \n and ESC sequences in the echo. */
const ECHO_BAD = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu;
/** M-7: sanitize + bound attacker-influenced echo text. Exported for
 *  claims.ts — same contract, one implementation. */
export function bound(s: string, n = 200): string {
  return s.replace(ECHO_BAD, "").slice(0, n);
}

export function assertShipmentId(id: string): void {
  if (!SHIPMENT_ID_RE.test(id)) {
    throw new ShipmentOrderError(`shipmentId must match ${SHIPMENT_ID_RE}`);
  }
}

export function assertAddress(addr: string, field: string): asserts addr is `0x${string}` {
  if (!ADDRESS_RE.test(addr)) {
    // cap attacker-influenced echo (audit M-4/nit)
    throw new ShipmentOrderError(`${field} is not a valid 0x-address: ${addr.slice(0, 80)}`);
  }
}

export function assertAmountUsdc(amount: string): void {
  if (!DECIMAL_USDC_RE.test(amount)) {
    throw new ShipmentOrderError(`amountUsdc must be decimal USDC: ${bound(amount, 80)}`);
  }
}

/** Re-audit N-6: seqFor derives event seq from hopIndex, so a fractional
 *  or negative value can collide with another kind's seq. */
export function assertHopIndex(hopIndex: number): void {
  if (!Number.isInteger(hopIndex) || hopIndex < 0) {
    throw new ShipmentOrderError(`hopIndex must be a non-negative integer: ${bound(String(hopIndex), 80)}`);
  }
}

/**
 * Handoff order guards — run INSIDE the per-hop lock on the derived
 * (light) state. Hoisted from handoffHop (213-5, max-lines lint);
 * semantics unchanged.
 *
 * 213-5 rider: address equality is case-insensitive — plan terms may
 * carry checksummed addresses while callers pass lowercase; a case-only
 * mismatch is a liveness bug, not a plan violation.
 */
export function assertHandoffOrder(
  hops: ShipmentHop[],
  client: string | undefined,
  hopIndex: number,
  actor: `0x${string}`,
  counterparty: `0x${string}`,
): void {
  if (hops.length === 0) {
    throw new ShipmentOrderError("shipment has no offer — cannot handoff");
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
  if (hop.receiver && counterparty.toLowerCase() !== hop.receiver.toLowerCase()) {
    throw new ShipmentOrderError(
      `handoff counterparty ${counterparty.slice(0, 80)} ≠ plan receiver ${hop.receiver}`,
    );
  }
  const expectedActor = hopIndex === 0
    ? client
    : hops.find((h) => h.hopIndex === hopIndex - 1)?.receiver;
  if (expectedActor && actor.toLowerCase() !== expectedActor.toLowerCase()) {
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
}

// ─── Ledger append (awaited — pack guards re-read immediately) ────
export async function appendEvent(
  ledger: EconLedgerStore,
  input: BuildEventInput,
): Promise<EconomicEvent> {
  let event: EconomicEvent;
  try {
    event = buildEconomicEvent(input);
  } catch (err) {
    // 213-5 nit: builder failures (raw ZodError/EconEventError) surface
    // as a bounded 4xx-class error, never an unbounded echo.
    throw new ShipmentOrderError(
      `event build failed: ${bound(err instanceof Error ? err.message : String(err))}`,
    );
  }
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

export const hopStatus = (hops: ShipmentHop[], idx: number): HopStatus =>
  hops.find((h) => h.hopIndex === idx)?.status ?? "offered";

// ─── Misc helpers ────────────────────────────────────────────────
/** BigInt decimal sum — float math drifts across many hops (audit M-1). */
export function sumUsdc(hops: Array<{ amountUsdc: string }>): string {
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
