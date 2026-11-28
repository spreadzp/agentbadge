/**
 * SLICE-236-3: adapter helpers — sourceEvent builder + the generic
 * UNSUPPORTED projection (D-236-Q4: no adapter → valid 200-level
 * projection with status UNSUPPORTED + TYPE_UNKNOWN issue).
 */
import type {
  AssetRef,
  ProcessEventProjection,
  ProjectionSourceEvent,
} from "../projections/types";
import type {
  EconomicEventLike,
  ParticipantRoleLike,
} from "./types";

/** `ev:{source}:{sourceId}:{seq}` (D-235-4) — the ledger's own
 *  idempotencyKey is canonical when present. */
export const buildSourceEvent = (
  event: EconomicEventLike,
): ProjectionSourceEvent => ({
  spec: "econ-events/1",
  id:
    event.idempotencyKey ??
    `ev:${event.source}:${event.sourceId}:${event.seq}`,
  source: event.source,
  sourceId: event.sourceId,
  seq: event.seq,
});

/** No mapping for this event → UNSUPPORTED, never a fabricated one.
 *  `adapter`/`version` identify WHO rejected it: a real adapter for a
 *  kind it doesn't map yet, "unmapped"/"0.0.0" when the registry found
 *  no claimant at all. */
export const unsupportedProjection = (
  event: EconomicEventLike,
  adapter: string,
  version: string,
): ProcessEventProjection => ({
  projectionVersion: "process-event-projection/1",
  sourceEvent: buildSourceEvent(event),
  interpretation: { subjectRefs: [], actorRefs: [] },
  mapping: {
    adapter,
    version,
    status: "UNSUPPORTED",
    issues: [
      {
        code: "TYPE_UNKNOWN",
        field: "kind",
        message: `no mapping for ${event.source}/${event.kind}`,
      },
    ],
  },
});

/* ── supply-chain domain builders (236-3/236-4, extracted for the
 *    max-lines bound — pure functions, no ports) ─────────────────── */

/** shipmentId → subject AssetRef (physical.batch, domain supply-chain). */
export const shipmentAssetRef = (shipmentId: string): AssetRef => ({
  assetType: "physical.batch",
  domain: "supply-chain",
  externalReferences: [
    {
      namespace: "agentbadge:supply-chain",
      referenceType: "shipment",
      value: shipmentId,
    },
  ],
});

/** deliverableHash → output AssetRef: digest ref + contentDigest carry
 *  the SAME hash (one source, never re-encoded — Landmine). keccak256
 *  is the codebase's deliverable convention (venue lifecycle keccaks
 *  plain inputs; EaaS artifacts are keccak'd). */
export const deliverableAssetRef = (deliverableHash: string): AssetRef => ({
  assetType: "digital.artifact",
  domain: "supply-chain",
  externalReferences: [
    {
      namespace: "agentbadge:deliverable",
      referenceType: "digest",
      value: deliverableHash,
    },
  ],
  contentDigest: { algorithm: "keccak256", value: deliverableHash },
});

export const ROLE_SLOTS = ["custodian", "operator", "device", "sensor"] as const;

export interface ActorSlot {
  /** issue.field / domainData trace — where the raw string came from. */
  field: string;
  raw: string;
}

/** actor + counterparty + every declared roles slot (dedup happens
 *  on identical RESOLVED refs, not on raw strings). */
export function actorSlots(event: EconomicEventLike): ActorSlot[] {
  const slots: ActorSlot[] = [{ field: "actor", raw: event.actor }];
  if (event.counterparty) {
    slots.push({ field: "counterparty", raw: event.counterparty });
  }
  const roles = event.payload?.roles as
    | Partial<Record<(typeof ROLE_SLOTS)[number], ParticipantRoleLike>>
    | undefined;
  if (roles && typeof roles === "object") {
    for (const slot of ROLE_SLOTS) {
      const addr = roles[slot]?.address;
      if (typeof addr === "string" && addr.length > 0) {
        slots.push({ field: `roles.${slot}`, raw: addr });
      }
    }
  }
  return slots;
}

/** handoff domain payload verbatim — hopIndex is domain semantics
 *  (Landmines), never a universal field. */
export function handoffDomainDataOf(
  event: EconomicEventLike,
): Record<string, unknown> {
  const p = event.payload ?? {};
  const out: Record<string, unknown> = {};
  for (const k of [
    "hopIndex",
    "what",
    "where",
    "why",
    "roles",
    "deliverableHash",
    "proofOfDelivery",
    "evidence",
  ] as const) {
    if (p[k] !== undefined) out[k] = p[k];
  }
  return out;
}

/** deliver domain fields verbatim — the hash itself lives in
 *  subjectRefs+contentDigest, not duplicated here. */
export function deliverDomainDataOf(
  event: EconomicEventLike,
): Record<string, unknown> {
  const p = event.payload ?? {};
  const out: Record<string, unknown> = {};
  for (const k of ["taskRef", "attempt", "evidenceRefs"] as const) {
    if (p[k] !== undefined) out[k] = p[k];
  }
  return out;
}
