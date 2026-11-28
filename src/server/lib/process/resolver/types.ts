/**
 * SLICE-236-2: ActorResolver contract-mirror types + identity ports.
 *
 * The server does NOT link @agentbadge/process-contracts (D-235-12):
 * these shapes mirror ActorRef / ActorResolutionResult / ExternalReference
 * from packages/process-contracts/src/v1 and are conformance-checked
 * package-side (tests/actor-resolver.test.ts parses every result with
 * the zod schemas).
 *
 * Identity lookups run through narrow read-only ports — the resolver
 * never touches stores directly, and an absent/unavailable port means
 * "no hit on this rail", never a fabricated identity (slice Landmines).
 */

// ---------- contract-mirror shapes (process-contracts v1) ----------

export interface ExternalReference {
  /** Qualified space, ≥1 colon — `eip155:5042002`, `agentbadge:system`. */
  namespace: string;
  /** Kebab token — `wallet`, `agent-id`, `principal`, `token-id`. */
  referenceType: string;
  value: string;
}

export type ActorRefType =
  | "HUMAN"
  | "ORGANIZATION"
  | "AI_AGENT"
  | "DEVICE"
  | "SERVICE"
  | "SYSTEM";

/** Public actor identity — no UUID; ≥1 external reference (D-235-21). */
export interface ActorRef {
  type: ActorRefType;
  externalReferences: ExternalReference[];
}

export type ActorResolutionStatus = "RESOLVED" | "UNRESOLVED" | "AMBIGUOUS";

/** UNRESOLVED is a status, never an actor type; actorRef only on RESOLVED. */
export interface ActorResolutionResult {
  status: ActorResolutionStatus;
  source: string;
  rawActor: string;
  actorRef?: ActorRef;
  issues: { code: string; field?: string }[];
}

// ---------- identity ports (read-only, all optional) ----------

/**
 * Narrow mirror of the identity actors row (@agentbadge/database
 * ActorRow) — only the fields resolution reads.
 */
export interface ActorIdentityRow {
  /** Identity-domain type — REGISTERED_* / EXTERNAL_* / ORGANIZATION. */
  type: string;
  agentId?: string | null;
  passportTokenId?: string | null;
  did?: string | null;
  orgId?: string | null;
}

/** Actors table — keyed by lowercase EVM wallet (D-225-3). */
export interface ActorLookupPort {
  getById(wallet: string): Promise<ActorIdentityRow | null>;
}

/**
 * ERC-8004 registration — narrow mirror of agent-registration records.
 * `agentId` is the canonical `eip155:<chain>:<registry>:<tokenId>` form;
 * `owner` is the wallet holding the agent NFT (absent = treasury custody).
 */
export interface Erc8004Registration {
  agentId: string;
  owner?: string;
  status: string;
}

export interface Erc8004RegistryPort {
  /** Exact agentId lookup — the id itself is the confirmed identity. */
  get(agentId: string): Promise<Erc8004Registration | undefined>;
  /** Full scan for owner-based resolution of bare wallet strings. */
  list(): Promise<readonly Erc8004Registration[]>;
}

/** Admin operator principal (op_<ulid>) — referenced by id, never by key. */
export interface PrincipalRecord {
  id: string;
  /** "human" | "service" | "break_glass" (AdminPrincipalType). */
  principalType: string;
  status?: string;
}

export interface PrincipalLookupPort {
  byId(id: string): Promise<PrincipalRecord | null>;
}
