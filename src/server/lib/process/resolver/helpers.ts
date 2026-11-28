/**
 * SLICE-236-2: ActorResolver helpers — ref constructors, result
 * constructors, shape regexes, type maps. Extracted to keep
 * actor-resolver.ts under the max-lines lint bound (same pattern
 * as identity/actor-verify.ts).
 */
import type {
  ActorRefType,
  ActorResolutionResult,
  ExternalReference,
} from "./types";

export const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;
/** Canonical agent id: `eip155:<chain>:<registry>:<tokenId>` (EPIC-184). */
export const AGENT_ID_RE = /^eip155:(\d+):0x[0-9a-fA-F]{40}:\d+$/;

export const refKey = (r: ExternalReference) =>
  `${r.namespace}#${r.referenceType}#${r.value}`;

export const walletRef = (chainId: number, w: string): ExternalReference => ({
  namespace: `eip155:${chainId}`,
  referenceType: "wallet",
  value: w,
});

export const agentRef = (chainId: number, agentId: string): ExternalReference => ({
  namespace: `erc8004:eip155:${chainId}`,
  referenceType: "agent-id",
  value: agentId,
});

/** Identity-table type → contract type; unmappable = not confirmed. */
export const ROW_TYPE_MAP: Record<string, ActorRefType> = {
  REGISTERED_AGENT: "AI_AGENT",
  REGISTERED_USER: "HUMAN",
  ORGANIZATION: "ORGANIZATION",
  EXTERNAL_AGENT: "AI_AGENT",
  EXTERNAL_HUMAN: "HUMAN",
};

export const PRINCIPAL_TYPE_MAP: Record<string, ActorRefType> = {
  human: "HUMAN",
  service: "SERVICE",
  break_glass: "HUMAN",
};

export const unresolved = (
  source: string,
  rawActor: string,
  field = "rawActor",
): ActorResolutionResult => ({
  status: "UNRESOLVED",
  source,
  rawActor,
  issues: [{ code: "ACTOR_UNRESOLVED", field }],
});

export const resolved = (
  source: string,
  rawActor: string,
  actorRef: ActorResolutionResult["actorRef"],
): ActorResolutionResult => ({
  status: "RESOLVED",
  source,
  rawActor,
  actorRef,
  issues: [],
});

export const ambiguous = (
  source: string,
  rawActor: string,
): ActorResolutionResult => ({
  status: "AMBIGUOUS",
  source,
  rawActor,
  issues: [{ code: "ACTOR_AMBIGUOUS", field: "rawActor" }],
});

/** Chain embedded in a canonical agentId; undefined if malformed. */
export const agentIdChain = (agentId: string): number | undefined => {
  const m = AGENT_ID_RE.exec(agentId);
  return m ? Number(m[1]) : undefined;
};

/**
 * ERC-8004 record → AI_AGENT ref; the owner wallet rides along as the
 * credential reference — the registry record itself is the confirmed
 * link (D-235-21). Undefined when no chain qualifies the namespaces.
 */
export const agentActorRef = (
  agentId: string,
  owner: string | undefined,
  fallbackChain: number | undefined,
): { type: "AI_AGENT"; externalReferences: ExternalReference[] } | undefined => {
  const chain = agentIdChain(agentId) ?? fallbackChain;
  if (chain === undefined) return undefined;
  const refs: ExternalReference[] = [agentRef(chain, agentId.toLowerCase())];
  if (typeof owner === "string" && WALLET_RE.test(owner)) {
    refs.push(walletRef(chain, owner.toLowerCase()));
  }
  return { type: "AI_AGENT", externalReferences: refs };
};
