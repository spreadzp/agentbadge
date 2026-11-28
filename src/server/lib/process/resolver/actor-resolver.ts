/**
 * SLICE-236-2: infrastructure ActorResolver (D-235-30, D-236-Q2).
 *
 * Turns a raw `actor` string of an econ-ledger event into a
 * contract-shaped ActorRef, walking the identity rails in
 * strongest-identity order:
 *
 *   SYSTEM registry → ERC-8004 passport → api principal → wallet
 *
 * Rules (R2-8 / D-235-16/21):
 *  - `source` is REQUIRED — format alone never mints an identity; a
 *    0x string in an uncovered source without records is UNRESOLVED.
 *  - Chain context is mandatory for eip155 refs — a wallet (or a
 *    wallet-owned agent) without `ctx.chainId`/defaultChainId stays
 *    UNRESOLVED rather than emitting an unqualified `eip155` ref.
 *  - Two externalReferences in one ActorRef assert a CONFIRMED link
 *    (DB row / registry record) — never an auto-merge (D-235-21).
 *  - AMBIGUOUS only on conflict between DISTINCT entities — rail
 *    shadowing by precedence is not ambiguity (D-236-Q2).
 *  - Offline/absent lookup ports degrade to a miss on that rail —
 *    never a fabricated identity (slice Landmines); outages are
 *    reported via `deps.onWarn`.
 */
import {
  SYSTEM_ACTORS,
  type SystemActorRecord,
} from "../../../../config/system-actors";
import {
  agentActorRef,
  ambiguous,
  PRINCIPAL_TYPE_MAP,
  resolved,
  refKey,
  ROW_TYPE_MAP,
  unresolved,
  WALLET_RE,
  walletRef,
} from "./helpers";
import type {
  ActorLookupPort,
  ActorRef,
  ActorResolutionResult,
  Erc8004RegistryPort,
  ExternalReference,
  PrincipalLookupPort,
} from "./types";

export interface ActorResolverDeps {
  /** Identity actors table (wallet → row). */
  actors?: ActorLookupPort;
  /** ERC-8004 registration registry (agentId → {owner,status}). */
  erc8004?: Erc8004RegistryPort;
  /** Admin operator principals (op_<ulid> → record). */
  principals?: PrincipalLookupPort;
  /** SYSTEM registry — defaults to the 236-1 version-controlled config. */
  systemRegistry?: readonly SystemActorRecord[];
  /** Deployment chain context; per-call ctx.chainId wins. */
  defaultChainId?: number;
  /** Diagnostic sink for lookup outages (default: silent). */
  onWarn?: (message: string, meta?: Record<string, unknown>) => void;
}

export interface ResolveContext {
  /** Chain the event belongs to — qualifies `eip155` namespaces. */
  chainId?: number;
}

export interface ActorResolver {
  resolveActor(
    source: string,
    rawActor: string,
    ctx?: ResolveContext,
  ): Promise<ActorResolutionResult>;
}

export function createActorResolver(
  deps: ActorResolverDeps = {},
): ActorResolver {
  const registry = deps.systemRegistry ?? SYSTEM_ACTORS;
  const warn = (msg: string, meta?: Record<string, unknown>) => {
    try {
      deps.onWarn?.(msg, meta);
    } catch {
      /* diagnostics must never break resolution */
    }
  };

  /** Rail 1 — version-controlled SYSTEM registry (236-1 config). */
  const resolveSystem = (
    source: string,
    rawActor: string,
  ): ActorResolutionResult | undefined => {
    const hits = registry.filter(
      (e) => e.source === source && e.rawActor === rawActor,
    );
    if (hits.length === 0) return undefined;
    const distinct = new Map<string, ActorRef>();
    for (const h of hits) {
      const actorRef: ActorRef = {
        type: h.actorType,
        externalReferences: [
          {
            namespace: "agentbadge:system",
            referenceType: "principal",
            value: h.principal,
          },
        ],
      };
      const k = actorRef.externalReferences.map(refKey).sort().join("|");
      if (!distinct.has(k)) distinct.set(k, actorRef);
    }
    if (distinct.size > 1) return ambiguous(source, rawActor);
    return resolved(source, rawActor, [...distinct.values()][0]!);
  };

  /** Rail 2 — exact ERC-8004 agentId lookup. */
  const resolvePassport = async (
    source: string,
    rawActor: string,
    fallbackChain?: number,
  ): Promise<ActorResolutionResult | undefined> => {
    if (!deps.erc8004) return undefined;
    let rec;
    try {
      rec = await deps.erc8004.get(rawActor);
      const lower = rawActor.toLowerCase();
      if (!rec && lower !== rawActor) rec = await deps.erc8004.get(lower);
    } catch (err) {
      warn("actor-resolver: erc8004 lookup failed", {
        source,
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
    if (!rec) return undefined;
    const actorRef = agentActorRef(rec.agentId, rec.owner, fallbackChain);
    if (!actorRef) return unresolved(source, rawActor, "chainId");
    return resolved(source, rawActor, actorRef);
  };

  /** Rail 3 — admin operator principal; ref on the id, never the key. */
  const resolvePrincipal = async (
    source: string,
    rawActor: string,
  ): Promise<ActorResolutionResult | undefined> => {
    if (!deps.principals) return undefined;
    let p;
    try {
      p = await deps.principals.byId(rawActor);
    } catch (err) {
      warn("actor-resolver: principal lookup failed", {
        source,
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
    if (!p) return undefined;
    const type = PRINCIPAL_TYPE_MAP[p.principalType];
    if (!type) return unresolved(source, rawActor);
    return resolved(source, rawActor, {
      type,
      externalReferences: [
        {
          namespace: "agentbadge:operator",
          referenceType: "principal",
          value: p.id,
        },
      ],
    });
  };

  /** Rail 4 — EVM wallet; requires chain context for eip155 refs. */
  const resolveWallet = async (
    source: string,
    rawActor: string,
    chainId: number,
  ): Promise<ActorResolutionResult> => {
    const w = rawActor.toLowerCase();
    let row = null;
    if (deps.actors) {
      try {
        row = await deps.actors.getById(w);
      } catch (err) {
        warn("actor-resolver: actors lookup failed", {
          source,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // Confirmed agent link on the row — strongest identity.
    if (typeof row?.agentId === "string" && row.agentId.length > 0) {
      const actorRef = agentActorRef(row.agentId, w, chainId);
      return actorRef
        ? resolved(source, rawActor, actorRef)
        : unresolved(source, rawActor, "chainId");
    }
    // Registry-owned wallet → the agent it controls (D-236-Q2).
    let owned: string[] = [];
    if (deps.erc8004) {
      try {
        owned = [
          ...new Set(
            (await deps.erc8004.list())
              .filter(
                (r) =>
                  r.status === "active" &&
                  typeof r.owner === "string" &&
                  r.owner.toLowerCase() === w,
              )
              .map((r) => r.agentId.toLowerCase()),
          ),
        ];
      } catch (err) {
        warn("actor-resolver: erc8004 owner-scan failed", {
          source,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (owned.length > 1) return ambiguous(source, rawActor);
    if (owned.length === 1) {
      const actorRef = agentActorRef(owned[0]!, w, chainId);
      return actorRef
        ? resolved(source, rawActor, actorRef)
        : unresolved(source, rawActor, "chainId");
    }
    // Plain identity row — type confirmed by the table, wallet is the ref.
    if (row) {
      const type = ROW_TYPE_MAP[row.type];
      if (!type) return unresolved(source, rawActor);
      const refs: ExternalReference[] = [walletRef(chainId, w)];
      if (
        typeof row.passportTokenId === "string" &&
        row.passportTokenId.length > 0
      ) {
        refs.unshift({
          namespace: "agentbadge:passport",
          referenceType: "token-id",
          value: row.passportTokenId,
        });
      }
      return resolved(source, rawActor, { type, externalReferences: refs });
    }
    return unresolved(source, rawActor);
  };

  return {
    async resolveActor(source, rawActor, ctx) {
      const chainId = ctx?.chainId ?? deps.defaultChainId;
      const hit = resolveSystem(source, rawActor);
      if (hit) return hit;
      if (WALLET_RE.test(rawActor)) {
        // agentIds are never bare hex — erc8004/principal can't match.
        if (chainId === undefined) {
          return unresolved(source, rawActor, "chainId");
        }
        return resolveWallet(source, rawActor, chainId);
      }
      const byPassport = await resolvePassport(source, rawActor, chainId);
      if (byPassport) return byPassport;
      const byPrincipal = await resolvePrincipal(source, rawActor);
      if (byPrincipal) return byPrincipal;
      return unresolved(source, rawActor);
    },
  };
}
