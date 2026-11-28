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
 * Interpretation for `deliver` (SLICE-236-4):
 *   stepType    "supply-chain.deliver"
 *   subjectRefs the submitted deliverable — AssetRef
 *               {digital.artifact, agentbadge:deliverable, digest,
 *               <deliverableHash>} + contentDigest {keccak256} — one
 *               source hash, never re-encoded (Landmine)
 *   actorRefs   event.actor (submitter) + event.counterparty when
 *               present — a deliver without counterparty is legal
 *               (board emits none)
 *   domainData  taskRef/attempt/evidenceRefs verbatim
 *
 * Interpretation for `verify` (SLICE-236-5):
 *   stepType    "supply-chain.verify"
 *   subjectRefs the verified thing — batch AssetRef from shipmentId
 *               and/or deliverable AssetRef from deliverableHash;
 *               neither → PARTIAL + ASSET_REF_MISSING
 *   actorRefs   event.actor (evaluator) + event.counterparty
 *   domainData  verdict fields verbatim (outcome/verdictId/score/
 *               criteriaDigest/policyRef/evidenceHash/…) +
 *               commitmentPotential when outcome=pass ∧ policyRef —
 *               the projection only FLAGS transition data; accepting
 *               it is the 237 central service's call (Landmine)
 *
 * Claim scope: `supply_chain` (every kind) + `venue` `deliver`/`verify`
 * — the dogfood's work product is submitted and judged through the job
 * venue (backfill lands both as venue events). market/board
 * deliveries/verdicts are other domains' processes — UNSUPPORTED until
 * their adapters exist (D-236-Q4).
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
import type { EconomicEventLike, ProcessAdapter } from "./types";
import {
  actorSlots,
  buildSourceEvent,
  deliverableAssetRef,
  deliverDomainDataOf,
  handoffDomainDataOf,
  shipmentAssetRef,
  unsupportedProjection,
  verifyDomainDataOf,
} from "./helpers";

export const SUPPLY_CHAIN_ADAPTER_ID = "supply-chain";
/** 0.3.0 — 236-5 added the verify kind mapping (MINOR: new optional
 *  emitted data per the versioning rule above). */
export const SUPPLY_CHAIN_ADAPTER_VERSION = "0.3.0";

const STEP_HANDOFF = "supply-chain.handoff";
const STEP_DELIVER = "supply-chain.deliver";
const STEP_VERIFY = "supply-chain.verify";

export interface SupplyChainAdapterDeps {
  /** 236-2 infrastructural resolver. */
  resolver: ActorResolver;
  /** Deployment chain context — forwarded as resolve ctx. */
  chainId?: number;
}

export function createSupplyChainAdapter(
  deps: SupplyChainAdapterDeps,
): ProcessAdapter {
  const { resolver } = deps;
  const ctx = { chainId: deps.chainId };

  /** Resolve every declared actor slot through the 236-2 resolver —
   *  dedup on identical RESOLVED refs; AMBIGUOUS/UNRESOLVED → issues. */
  async function resolveActorSlots(event: EconomicEventLike) {
    const issues: ProjectionIssue[] = [];
    const actorRefs = new Map<string, ActorRef>();
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
    return { issues, actorRefs: [...actorRefs.values()] };
  }

  function finalize(
    event: EconomicEventLike,
    stepType: string,
    subjectRefs: AssetRef[],
    actorRefs: ActorRef[],
    issues: ProjectionIssue[],
    domainData: Record<string, unknown>,
  ): ProcessEventProjection {
    const status = issues.some((i) => i.code === "AMBIGUOUS_SOURCE")
      ? "AMBIGUOUS"
      : issues.length > 0
        ? "PARTIAL"
        : "SUPPORTED";
    return {
      projectionVersion: "process-event-projection/1",
      sourceEvent: buildSourceEvent(event),
      interpretation: {
        stepType,
        subjectRefs,
        actorRefs,
        domainData,
      },
      mapping: {
        adapter: SUPPLY_CHAIN_ADAPTER_ID,
        version: SUPPLY_CHAIN_ADAPTER_VERSION,
        status,
        issues,
      },
    };
  }

  async function projectHandoff(
    event: EconomicEventLike,
  ): Promise<ProcessEventProjection> {
    const issues: ProjectionIssue[] = [];
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

    const { issues: actorIssues, actorRefs } = await resolveActorSlots(event);
    issues.push(...actorIssues);
    return finalize(
      event,
      STEP_HANDOFF,
      subjectRefs,
      actorRefs,
      issues,
      handoffDomainDataOf(event),
    );
  }

  /** SLICE-236-4: deliver → output deliverable AssetRef (D-235-23).
   *  deliverableHash is schema-required but read-side we never trust
   *  raw payloads — absent/invalid → PARTIAL + ASSET_REF_MISSING. */
  async function projectDeliver(
    event: EconomicEventLike,
  ): Promise<ProcessEventProjection> {
    const issues: ProjectionIssue[] = [];
    const subjectRefs: AssetRef[] = [];

    const dh = event.payload?.deliverableHash;
    if (typeof dh === "string" && dh.length > 0) {
      subjectRefs.push(deliverableAssetRef(dh));
    } else {
      issues.push({
        code: "ASSET_REF_MISSING",
        field: "payload.deliverableHash",
      });
    }

    const { issues: actorIssues, actorRefs } = await resolveActorSlots(event);
    issues.push(...actorIssues);
    return finalize(
      event,
      STEP_DELIVER,
      subjectRefs,
      actorRefs,
      issues,
      deliverDomainDataOf(event),
    );
  }

  /** SLICE-236-5: verify → verification interpretation (D-235-23).
   *  The subject is whatever the verdict is on — the batch (shipmentId)
   *  and/or the deliverable (deliverableHash); neither → PARTIAL. */
  async function projectVerify(
    event: EconomicEventLike,
  ): Promise<ProcessEventProjection> {
    const issues: ProjectionIssue[] = [];
    const subjectRefs: AssetRef[] = [];

    const p = event.payload ?? {};
    const shipmentId = p.shipmentId;
    if (typeof shipmentId === "string" && shipmentId.length > 0) {
      subjectRefs.push(shipmentAssetRef(shipmentId));
    }
    const dh = p.deliverableHash;
    if (typeof dh === "string" && dh.length > 0) {
      subjectRefs.push(deliverableAssetRef(dh));
    }
    if (subjectRefs.length === 0) {
      issues.push({
        code: "ASSET_REF_MISSING",
        field: "payload.shipmentId",
      });
    }

    const { issues: actorIssues, actorRefs } = await resolveActorSlots(event);
    issues.push(...actorIssues);
    return finalize(
      event,
      STEP_VERIFY,
      subjectRefs,
      actorRefs,
      issues,
      verifyDomainDataOf(event),
    );
  }

  return {
    id: SUPPLY_CHAIN_ADAPTER_ID,
    version: SUPPLY_CHAIN_ADAPTER_VERSION,
    handles: (event) =>
      event.source === "supply_chain" ||
      (event.source === "venue" &&
        (event.kind === "deliver" || event.kind === "verify")),
    async project(event) {
      if (event.kind === "handoff") return projectHandoff(event);
      if (event.kind === "deliver") return projectDeliver(event);
      if (event.kind === "verify") return projectVerify(event);
      return unsupportedProjection(
        event,
        SUPPLY_CHAIN_ADAPTER_ID,
        SUPPLY_CHAIN_ADAPTER_VERSION,
      );
    },
  };
}
