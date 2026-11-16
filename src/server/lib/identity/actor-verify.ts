/**
 * SLICE-225-6 (EPIC-225): actor verification helpers — extracted
 * from actor-service.ts to keep it under the max-lines lint bound.
 * Pure functions over the registration/passport ports; the caller
 * supplies a per-write memoized `listOnce` so link checks and type
 * derivation share one registry read.
 */
import type { ActorRow } from "@agentbadge/database";

import type { ActorType } from "./types";
import type {
  ActorHints,
  ActorRegistrationPort,
  PassportVerificationPort,
} from "./actor-service";

export type RegEntry = {
  agentId: string;
  owner?: string;
  status: string;
};
export type RegList = ReadonlyArray<RegEntry> | null;

/** Tri-state for registry lookups (audit round-3 F-2): a port that
 *  is present but UNAVAILABLE (store not yet published, list()
 *  returned null) is "unknown" — never "unowned". Unknown keeps a
 *  stored REGISTERED_AGENT and rejects new agentId writes with 503. */
export type RegState = "available" | "unavailable";

export interface ActorVerifier {
  /** Active registration owned by `wallet` (REGISTERED_AGENT proof).
   *  `undefined` on unavailable registry too — no proof either way. */
  ownedRegistration(
    wallet: string,
    listOnce: () => Promise<RegList>,
  ): Promise<RegEntry | undefined>;
  /**
   * Wallet owns `agentId` via an ACTIVE registration (link proof) —
   * tri-state like passportState: "unknown" when the registry is
   * unavailable (reject the write as 503, never as unowned).
   */
  ownsAgent(
    wallet: string,
    agentId: string,
    listOnce: () => Promise<RegList>,
  ): Promise<"owned" | "unowned" | "unknown">;
  /**
   * Passport `tokenId` ownership proof — tri-state (audit v2 N-7):
   *   "owned"   — onchain owner === wallet
   *   "unowned" — lookup succeeded, owner differs / token missing
   *   "unknown" — the lookup itself failed (RPC hiccup): NOT
   *               "unowned". Unknown never downgrades a stored
   *               REGISTERED_USER and rejects new link writes
   *               with 503 rather than silently dropping proof.
   */
  passportState(
    wallet: string,
    tokenId: string,
  ): Promise<"owned" | "unowned" | "unknown">;
  /**
   * Recompute the actor type from verifiable facts (audit M-1 — no
   * one-way ratchet: a lost proof downgrades). A stored REGISTERED_*
   * type survives only while its proof is verifiable — or while its
   * verification port is absent entirely (legacy rows we cannot
   * re-prove; never self-minted post-fix since writes are gated).
   */
  resolveType(
    wallet: string,
    existing: ActorRow | null,
    hints: ActorHints,
    passportVerified: boolean,
    passportStateOfStored?: "owned" | "unowned" | "unknown",
    listOnce?: () => Promise<RegList>,
  ): Promise<ActorType>;
}

export function createActorVerifier(
  registrations?: ActorRegistrationPort,
  passports?: PassportVerificationPort,
): ActorVerifier {

  async function ownedRegistration(
    wallet: string,
    listOnce: () => Promise<RegList>,
  ) {
    if (!registrations) return undefined;
    const regs = await listOnce();
    if (regs === null) return undefined;
    return regs.find(
      (r) =>
        r.status === "active" &&
        typeof r.owner === "string" &&
        r.owner.toLowerCase() === wallet,
    );
  }

  async function ownsAgent(
    wallet: string,
    agentId: string,
    listOnce: () => Promise<RegList>,
  ): Promise<"owned" | "unowned" | "unknown"> {
    if (!registrations) return "unknown";
    const regs = await listOnce();
    if (regs === null) return "unknown";
    return regs.some(
      (r) =>
        r.status === "active" &&
        r.agentId === agentId &&
        typeof r.owner === "string" &&
        r.owner.toLowerCase() === wallet,
    )
      ? "owned"
      : "unowned";
  }

  async function passportState(
    wallet: string,
    tokenId: string,
  ): Promise<"owned" | "unowned" | "unknown"> {
    if (!passports) return "unknown";
    try {
      const owner = await passports.ownerOf(tokenId);
      return typeof owner === "string" && owner.toLowerCase() === wallet
        ? "owned"
        : "unowned";
    } catch {
      return "unknown";
    }
  }

  async function resolveType(
    wallet: string,
    existing: ActorRow | null,
    hints: ActorHints,
    passportVerified: boolean,
    passportStateOfStored: "owned" | "unowned" | "unknown" = "unowned",
    listOnce: () => Promise<RegList> = async () =>
      (await registrations?.list().catch(() => null)) ?? null,
  ): Promise<ActorType> {
    // 1. REGISTERED_AGENT — live proof via the registry.
    if (await ownedRegistration(wallet, listOnce)) return "REGISTERED_AGENT";

    // 2. REGISTERED_USER — verified passport.
    if (passportVerified) return "REGISTERED_USER";

    // 2b. Stored REGISTERED_* beats an explicit hint while its
    //     proof is merely UNKNOWN — an EXTERNAL/ORGANIZATION hint
    //     must not self-downgrade during a registry/RPC blip
    //     (round-4 N-5). Mirrors the step-4 unknown-keep rules.
    if (existing) {
      const stored = existing.type as ActorType;
      if (
        stored === "REGISTERED_AGENT" &&
        (!registrations || (await listOnce()) === null)
      )
        return stored;
      if (
        stored === "REGISTERED_USER" &&
        ((!passports && !!existing.passportTokenId) ||
          passportStateOfStored === "unknown")
      )
        return stored;
    }

    // 3. Explicit hints (ORGANIZATION requires orgId — validated by
    //    the caller before resolveType runs).
    const hinted = hints.type;
    if (hinted === "ORGANIZATION") return "ORGANIZATION";
    if (hinted === "EXTERNAL_HUMAN") return "EXTERNAL_HUMAN";
    if (hinted === "EXTERNAL_AGENT") return "EXTERNAL_AGENT";
    // REGISTERED_* hints are ignored — they must be proven.

    // 4. Previously stored type.
    if (existing) {
      const stored = existing.type as ActorType;
      if (stored === "REGISTERED_AGENT") {
        // Keep when the registry isn't wired (cannot re-prove) OR
        // when it is unavailable — unknown is not disproof (F-2).
        if (!registrations) return stored;
        if ((await listOnce()) === null) return stored;
        // Proof gone — downgrade.
      } else if (stored === "REGISTERED_USER") {
        // Keep when the passport port isn't wired (legacy rows),
        // OR when the check just ran as UNKNOWN — a transient RPC
        // error is not proof of loss (audit v2 N-7).
        if (!passports && existing.passportTokenId) return stored;
        if (passportStateOfStored === "unknown") return stored;
        // "unowned" — proof gone, downgrade.
      } else if (stored === "ORGANIZATION") {
        // Audit v2 N-9: orgId is self-asserted but required — a
        // row whose orgId was cleared (or trimmed to nothing)
        // drops the type with the field.
        const effOrg =
          hints.orgId !== undefined ? hints.orgId : existing.orgId;
        if (typeof effOrg === "string" && effOrg.trim() !== "") {
          return stored;
        }
        // fall through — orgId gone, downgrade.
      } else {
        return stored;
      }
    }
    return "EXTERNAL_AGENT";
  }

  return {
    ownedRegistration,
    ownsAgent,
    passportState,
    resolveType,
  };
}
