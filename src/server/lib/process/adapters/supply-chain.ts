/**
 * SLICE-236-3: supply-chain adapter — handoff → ProcessEventProjection
 * (D-235-23, mapping order Handoff → Deliver → Verify).
 *
 * The adapter reads the live ledger event and INTERPRETS it — it never
 * rewrites econ-events/1 (D-235-6) and never blocks the write path
 * (read-side, after the ledger).
 *
 * Interpretation for `handoff`:
 *   stepType    "supply-chain.handoff"
 *   subjectRefs the shipped batch — AssetRef
 *               {agentbadge:supply-chain, shipment, <shipmentId>}
 *   actorRefs   every party address resolved through the 236-2
 *               ActorResolver: event.actor (hander-offer),
 *               event.counterparty (receiver) and each declared
 *               payload.roles slot (custodian/operator/device/sensor)
 *   domainData  hopIndex + epcis/roles/evidence verbatim — domain
 *               semantics preserved, never universalized
 *
 * Status: SUPPORTED when every party resolves; PARTIAL on
 * ACTOR_UNRESOLVED / ASSET_REF_MISSING; AMBIGUOUS only on a
 * distinct-entity conflict. Labels/role types are self-declared
 * (D-212-3) — they ride domainData, never shape identity.
 *
 * Versioning (D-235-26): refactorings that keep output semantics are
 * PATCH; newly emitted optional data (e.g. a new kind mapping) is
 * MINOR; a change in interpretation semantics is MAJOR/new version —
 * old projections are never rewritten (D-236-Q3).
 */
import { refKey } from "../resolver/helpers";
import type { ActorResolver } from "../resolver/actor-resolver";
import type { ActorRef } from "../resolver/types";
import type {
  AssetRef,
  ProcessEventProjection,
  ProjectionIssue,
} from "../projections/types";
import type {
  EconomicEventLike,
  ParticipantRoleLike,
  ProcessAdapter,
} from "./types";
import {
  buildSourceEvent,
  unsupportedProjection,
} from "./helpers";

export const SUPPLY_CHAIN_ADAPTER_ID = "supply-chain";
export const SUPPLY_CHAIN_ADAPTER_VERSION = "0.1.0";

const STEP_HANDOFF = "supply-chain.handoff";
const ROLE_SLOTS = ["custodian", "operator", "device", "sensor"] as const;

export interface SupplyChainAdapterDeps {
  /** 236-2 infrastructural resolver. */
  resolver: ActorResolver;
  /** Deployment chain context — forwarded as resolve ctx. */
  chainId?: number;
}

/** shipmentId → subject AssetRef (physical.batch, domain supply-chain). */
const shipmentAssetRef = (shipmentId: string): AssetRef => ({
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

interface ActorSlot {
  /** issue.field / domainData trace — where the raw string came from. */
  field: string;
  raw: string;
}

/** actor + counterparty + every declared roles slot (dedup happens
 *  on identical RESOLVED refs, not on raw strings). */
function actorSlots(event: EconomicEventLike): ActorSlot[] {
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

/** Domain payload verbatim — hopIndex is domain semantics (Landmines),
 *  never a universal field. */
function domainDataOf(event: EconomicEventLike): Record<string, unknown> {
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

export function createSupplyChainAdapter(
  deps: SupplyChainAdapterDeps,
): ProcessAdapter {
  const { resolver } = deps;
  const ctx = { chainId: deps.chainId };

  async function projectHandoff(
    event: EconomicEventLike,
  ): Promise<ProcessEventProjection> {
    const issues: ProjectionIssue[] = [];
    const actorRefs = new Map<string, ActorRef>();
    const subjectRefs: AssetRef[] = [];

    const shipmentId = event.payload?.shipmentId;
    if (typeof shipmentId === "string" && shipmentId.length > 0) {
      subjectRefs.push(shipmentAssetRef(shipmentId));
    } else {
      issues.push({
        code: "ASSET_REF_MISSING",
        field: "payload.shipmentId",
      });
    }

    for (const slot of actorSlots(event)) {
      const res = await resolver.resolveActor(event.source, slot.raw, ctx);
      if (res.status === "RESOLVED" && res.actorRef) {
        const k = res.actorRef.externalReferences
          .map(refKey)
          .sort()
          .join("|");
        if (!actorRefs.has(k)) actorRefs.set(k, res.actorRef);
      } else if (res.status === "AMBIGUOUS") {
        issues.push({
          code: "AMBIGUOUS_SOURCE",
          field: slot.field,
          message: slot.raw,
        });
      } else {
        issues.push({
          code: "ACTOR_UNRESOLVED",
          field: slot.field,
          message: slot.raw,
        });
      }
    }

    const status = issues.some((i) => i.code === "AMBIGUOUS_SOURCE")
      ? "AMBIGUOUS"
      : issues.length > 0
        ? "PARTIAL"
        : "SUPPORTED";

    return {
      projectionVersion: "process-event-projection/1",
      sourceEvent: buildSourceEvent(event),
      interpretation: {
        stepType: STEP_HANDOFF,
        subjectRefs,
        actorRefs: [...actorRefs.values()],
        domainData: domainDataOf(event),
      },
      mapping: {
        adapter: SUPPLY_CHAIN_ADAPTER_ID,
        version: SUPPLY_CHAIN_ADAPTER_VERSION,
        status,
        issues,
      },
    };
  }

  return {
    id: SUPPLY_CHAIN_ADAPTER_ID,
    version: SUPPLY_CHAIN_ADAPTER_VERSION,
    handles: (event) => event.source === "supply_chain",
    async project(event) {
      if (event.kind === "handoff") return projectHandoff(event);
      return unsupportedProjection(
        event,
        SUPPLY_CHAIN_ADAPTER_ID,
        SUPPLY_CHAIN_ADAPTER_VERSION,
      );
    },
  };
}
