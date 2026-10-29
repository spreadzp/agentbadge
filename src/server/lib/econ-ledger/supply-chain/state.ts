/**
 * SLICE-207-7: supply-chain pack — shared state/helpers.
 *
 * Shipment state is DERIVED from the event log (source=supply_chain,
 * sourceId=shipmentId) — the log is SoT, never caller input.
 */

import type { EconEventStored, EconLedgerStore } from "@agentbadge/database";
import {
  ADDRESS,
  buildEconomicEvent,
  type BuildEventInput,
  DECIMAL_USDC,
  type EconomicEvent,
  type HandoffPayload,
  ParticipantRolesWriteSchema,
  type ParticipantRoles,
  type ShipmentHop,
} from "@agentbadge/econ-events";
import { statusRank, type HopSpec, type HopStatus } from "./types";

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
    // cap attacker-influenced echo (audit M-4/nit)
    throw new ShipmentOrderError(`${field} is not a valid 0x-address: ${addr.slice(0, 80)}`);
  }
}

export function assertAmountUsdc(amount: string): void {
  if (!DECIMAL_USDC_RE.test(amount)) {
    throw new ShipmentOrderError(`amountUsdc must be decimal USDC: ${amount}`);
  }
}

/**
 * 212-2/212-5: validate caller-supplied handoff roles (write side).
 * Strict schema — unknown slots/keys fail loudly (audit M-3),
 * addresses normalize to lowercase, roles must name >=1 participant
 * and one address can't carry two types. custodian must equal the
 * counterparty (audit H-2) — it IS the custody receiver; the other
 * slots may legitimately be third parties.
 */
export function parseHandoffRoles(
  roles: ParticipantRoles,
  counterparty: string,
): ParticipantRoles {
  const check = ParticipantRolesWriteSchema.safeParse(roles);
  if (!check.success) {
    const detail = check.error.issues
      .map((i) => `${i.path.join(".") || "roles"} ${i.message}`)
      .join("; ")
      .slice(0, 200); // M-4: bound attacker-influenced text
    throw new ShipmentOrderError(`invalid handoff roles: ${detail}`);
  }
  for (const [slot, role] of Object.entries(check.data)) {
    if (role) assertAddress(role.address, `roles.${slot}.address`);
  }
  if (
    check.data.custodian &&
    check.data.custodian.address.toLowerCase() !== counterparty.toLowerCase()
  ) {
    throw new ShipmentOrderError(
      `roles.custodian ${check.data.custodian.address} ≠ handoff counterparty ${counterparty}`,
    );
  }
  return check.data;
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
      // 212-3/212-5: lift typed participants into the read model.
      // First-event-wins (audit H-3) — the write path rejects repeat
      // handoffs, but never let a later event rewrite roles, and never
      // let a roles-less event clear them. Clone so the hop doesn't
      // alias the event payload object (audit M-5). rolesAssertedBy
      // keeps provenance — roles are self-declared by the actor (H-1).
      if (p.roles && hop.roles === undefined) {
        hop.roles = structuredClone(p.roles);
        hop.rolesAssertedBy = e.actor;
      }
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
