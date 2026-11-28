/**
 * SLICE-236-3: ProcessEventProjection contract-mirror types.
 *
 * Mirrors packages/process-contracts/src/v1/process-event-projection.ts
 * (and asset-ref.ts). The server does NOT link the package (D-235-12) —
 * every emitted projection is conformance-checked package-side with
 * ProcessEventProjectionSchema. Keep these shapes in lockstep with the
 * zod contracts; strict schemas reject extra fields.
 */
import type {
  ActorRef,
  ExternalReference,
} from "../resolver/types";

/** All four projection statuses (D-235-16). */
export type ProjectionStatus =
  | "SUPPORTED"
  | "PARTIAL"
  | "UNSUPPORTED"
  | "AMBIGUOUS";

/** Closed issue-code set — mirror of PROJECTION_ISSUE_CODES. */
export type ProjectionIssueCode =
  | "ACTOR_UNRESOLVED"
  | "ASSET_REF_MISSING"
  | "TYPE_UNKNOWN"
  | "AMBIGUOUS_SOURCE";

export interface ProjectionIssue {
  code: ProjectionIssueCode;
  field?: string;
  message?: string;
}

/**
 * Pointer to the FOREIGN source event — `spec` is the source's own
 * schema id ("econ-events/1"), `id` follows `ev:{source}:{sourceId}:{seq}`
 * (D-235-4); hopIndex/verdictId/domain ids never live here.
 */
export interface ProjectionSourceEvent {
  spec: string;
  id: string;
  source: string;
  sourceId: string;
  seq: number;
}

/** Public asset identity — no UUID, ≥1 external reference (D-235-20). */
export interface AssetRef {
  /** Open namespaced convention `physical.*` / `digital.*`. */
  assetType: string;
  domain: string;
  externalReferences: ExternalReference[];
  contentDigest?: { algorithm: string; value: string };
}

export interface WorkflowRef {
  workflowId: string;
  version: string;
}

export interface ProjectionInterpretation {
  workflowRef?: WorkflowRef;
  /** Namespaced step type — `supply-chain.handoff`. */
  stepType?: string;
  subjectRefs: AssetRef[];
  actorRefs: ActorRef[];
  /** Domain payload (hopIndex, verdictId…) — preserved, NOT universal. */
  domainData?: Record<string, unknown>;
}

export interface ProjectionMapping {
  /** Kebab adapter id — "supply-chain". */
  adapter: string;
  /** Semver — patch=refactor, minor=optional data, major=semantics. */
  version: string;
  status: ProjectionStatus;
  issues: ProjectionIssue[];
}

/**
 * The projection contract (D-235-16): NOT signed, NOT written into
 * EconomicEvent — an interpretation, not a fact. Every non-SUPPORTED
 * status carries ≥1 issue; SUPPORTED carries none.
 */
export interface ProcessEventProjection {
  projectionVersion: "process-event-projection/1";
  sourceEvent: ProjectionSourceEvent;
  interpretation: ProjectionInterpretation;
  mapping: ProjectionMapping;
}
