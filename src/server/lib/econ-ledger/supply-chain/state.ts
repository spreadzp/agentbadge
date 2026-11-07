/** SLICE-207-7: supply-chain pack — shared state/helpers.
 *  Shipment state is DERIVED from the event log (source=supply_chain,
 *  sourceId=shipmentId) — the log is SoT, never caller input. */

import type { EconEventStored, EconLedgerStore } from "@agentbadge/database";
import {
  ADDRESS,
  buildEconomicEvent,
  type BuildEventInput,
  DECIMAL_USDC,
  type EconomicEvent,
  HandoffPayloadSchema,
  type ShipmentHop,
} from "@agentbadge/econ-events";
import { statusRank, type HopSpec, type HopStatus } from "./types";
import {
  applyAdvisoryFlags,
  type AdvisoryShipmentHop,
} from "./advisory";

export type { AdvisoryShipmentHop, ShipmentAdvisoryFlags } from "./advisory";

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

// ─── Derived state ───────────────────────────────────────────────
/** Derive hop states from the shipment's own event stream (SoT read).
 *  213-5: `opts.light` skips the roles/evidence lifts + advisory
 *  post-pass — guard paths never read claims (audit M-2). */
export async function shipmentState(
  ledger: EconLedgerStore,
  shipmentId: string,
  opts?: { light?: boolean },
): Promise<{ hops: AdvisoryShipmentHop[]; events: EconomicEvent[]; client?: string }> {
  const rows = await ledger.listBySourceId(SHIPMENT_SOURCE, shipmentId);
  const events = rows.map((r: EconEventStored) => r.event);
  const hops = new Map<number, AdvisoryShipmentHop>();
  const light = opts?.light === true;
  let client: string | undefined;
  for (const e of events) {
    if (e.kind === "handoff") {
      // 213-5 (audit H-2): re-parse the stored payload leniently instead
      // of casting — a corrupt/forged payload skips projection instead of
      // flowing unchecked into the read model.
      const parsed = HandoffPayloadSchema.safeParse(e.payload);
      if (!parsed.success) continue;
      const p = parsed.data;
      const hop = hops.get(p.hopIndex) ?? { hopIndex: p.hopIndex, status: "offered" as HopStatus };
      if (statusRank(hop.status) < statusRank("handed_off")) hop.status = "handed_off";
      // 213-5 (audit M-4): claims (roles/evidence) only lift from the
      // canonical per-hop handoff event — seq binds the claim to THIS
      // shipment's plan so a foreign writer's event can't pin provenance.
      const canonical = e.seq === seqFor(p.hopIndex, "handoff");
      // 212-3/212-5: lift typed participants into the read model.
      // First-event-wins (audit H-3) — the write path rejects repeat
      // handoffs, but never let a later event rewrite roles, and never
      // let a roles-less event clear them. Clone so the hop doesn't
      // alias the event payload object (audit M-5). rolesAssertedBy
      // keeps provenance — roles are self-declared by the actor (H-1).
      if (!light && canonical && p.roles && hop.roles === undefined) {
        hop.roles = structuredClone(p.roles);
        hop.rolesAssertedBy = e.actor;
      }
      // 213-3: lift evidence refs the same way — first-event-wins,
      // clone so the hop never aliases the event payload.
      // 213-5 (audit H-1): attach provenance — evidenceAssertedBy mirrors
      // rolesAssertedBy, and per-ref issuerMatchesParty tells a UI whether
      // the self-declared issuer is one of the hop's parties without it
      // having to correlate the raw events array.
      if (!light && canonical && p.evidence && p.evidence.length > 0 && hop.evidence === undefined) {
        const parties = new Set([e.actor.toLowerCase(), (e.counterparty ?? "").toLowerCase()]);
        hop.evidence = p.evidence.map((r) => ({
          ...structuredClone(r),
          issuerMatchesParty: parties.has(r.issuer.address.toLowerCase()),
        }));
        hop.evidenceAssertedBy = e.actor;
      }
      hops.set(p.hopIndex, hop);
    } else if (e.kind === "pay" || e.kind === "verify") {
      const p = e.payload as { shipmentId?: string; hopIndex?: number; jobId?: string; outcome?: string };
      const idx = p.hopIndex;
      if (idx === undefined) continue;
      const hop = hops.get(idx) ?? { hopIndex: idx, status: "offered" as HopStatus };
      // 214-3 (D-214-4): verify outcome:"fail" = receiver-dispute stub —
      // flag the hop, never lift to verified; settle refuses while it stands.
      if (e.kind === "verify" && p.outcome === "fail") hop.disputed = true;
      else {
        const stage = e.kind === "pay" ? "paid" : "verified";
        if (statusRank(hop.status) < statusRank(stage)) hop.status = stage;
      }
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
  // 214-2 (D-214-1): advisory flag post-pass — skipped in light mode
  // like the claims lifts (guard paths never read them).
  if (!light) applyAdvisoryFlags(hops);
  return { hops: [...hops.values()].sort((a, b) => a.hopIndex - b.hopIndex), events, client };
}

export const hopStatus = (hops: ShipmentHop[], idx: number): HopStatus =>
  hops.find((h) => h.hopIndex === idx)?.status ?? "offered";

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
