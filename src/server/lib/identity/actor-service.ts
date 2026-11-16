/**
 * SLICE-225-2 (EPIC-225): actor service — lazy upsert on first
 * action, type resolution precedence, link enrichment.
 *
 * Type precedence (slice contract):
 *   AgentRegistration (active, owner === wallet) → REGISTERED_AGENT
 *   passportTokenId VERIFIED via passports port → REGISTERED_USER
 *   orgId + explicit ORGANIZATION hint           → ORGANIZATION
 *   caller hint.type (EXTERNAL_*)                → hint
 *   previously stored type                       → keep (see below)
 *   fallback                                     → EXTERNAL_AGENT
 *
 * SLICE-225-6 (audit C-1/H-1/M-1): REGISTERED_* types are derived
 * only from VERIFIED sources — a passports port (ownerOf) and the
 * registration registry (active + owner match). Link writes that
 * claim ownership (passportTokenId, agentId) are rejected when the
 * verification port is absent or proves a different owner. Type is
 * recomputed on every write — a lost proof (cleared passport,
 * deregistered agent) downgrades the row; a REGISTERED_* stored
 * type is only kept when its verification port is absent (legacy
 * rows, no way to re-prove).
 *
 * A bare `resolveOrCreate(wallet)` keeps a stored type unless the
 * proof is now disproven — EXTERNAL_* / ORGANIZATION are sticky,
 * REGISTERED_* must hold the underlying link to survive.
 */
import type { ActorRow, ActorStore } from "@agentbadge/database";
import type { JsonValue } from "@prisma/orm-postgres/target/codec-types";

import { assertWallet } from "./guards";
import { invalid, type ActorType } from "./types";

/** Minimal port over the ERC-8004 registration registry (184). */
export interface ActorRegistrationPort {
  list(): Promise<
    ReadonlyArray<{
      agentId: string;
      owner?: string;
      status: string;
    }>
  >;
}

/**
 * Passport ownership verification port (audit C-1). Implementations
 * resolve a passport token id to its owner wallet — onchain
 * `ownerOf`, a local passport store, or a cached index. Absent port
 * ⇒ passportTokenId writes are rejected (fail-closed).
 */
export interface PassportVerificationPort {
  ownerOf(tokenId: string): Promise<string | null>;
}

export interface ActorHints {
  /** Caller-asserted type — EXTERNAL_* or ORGANIZATION only; the
   *  REGISTERED_* types are derived, never asserted (they come from
   *  real registrations/passports). */
  type?: ActorType;
  /** Write requires proof: active registration owned by the wallet. */
  agentId?: string | null;
  /** Write requires proof: passport owned by the wallet (passports
   *  port). */
  passportTokenId?: string | null;
  did?: string | null;
  orgId?: string | null;
  /** Internal tier association — set by trusted internal callers
   *  (passport/grant flows), never via the public enrich surface. */
  tier?: string | null;
  payload?: JsonValue;
}

export interface ActorService {
  /**
   * Lazy upsert (D-225-3): creates the Actor on first action,
   * re-resolves type + merges link hints on later calls. Upsert
   * semantics per link field: `undefined` keeps, `null` clears.
   */
  resolveOrCreate(wallet: string, hints?: ActorHints): Promise<ActorRow>;
  /** Update identity links on an existing actor (or create it). */
  enrich(wallet: string, links: ActorHints): Promise<ActorRow>;
  get(wallet: string): Promise<ActorRow | null>;
  list(opts?: { type?: string; limit?: number }): Promise<ActorRow[]>;
}

export function createActorService(
  actors: ActorStore,
  registrations?: ActorRegistrationPort,
  passports?: PassportVerificationPort,
): ActorService {
  /** Active registration owned by `wallet` (REGISTERED_AGENT proof). */
  async function ownedRegistration(wallet: string) {
    if (!registrations) return undefined;
    const regs = await registrations.list();
    return regs.find(
      (r) =>
        r.status === "active" &&
        typeof r.owner === "string" &&
        r.owner.toLowerCase() === wallet,
    );
  }

  /** Wallet owns `agentId` via an ACTIVE registration (link proof). */
  async function ownsAgent(wallet: string, agentId: string) {
    if (!registrations) return false;
    const regs = await registrations.list();
    return regs.some(
      (r) =>
        r.status === "active" &&
        r.agentId === agentId &&
        typeof r.owner === "string" &&
        r.owner.toLowerCase() === wallet,
    );
  }

  /** Passport `tokenId` is owned by `wallet` (link + type proof). */
  async function passportOwned(wallet: string, tokenId: string) {
    if (!passports) return false;
    const owner = await passports.ownerOf(tokenId);
    return typeof owner === "string" && owner.toLowerCase() === wallet;
  }

  /**
   * Recompute the actor type from verifiable facts (audit M-1 — no
   * one-way ratchet: a lost proof downgrades). A stored REGISTERED_*
   * type survives only while its proof is verifiable — or while its
   * verification port is absent entirely (legacy rows we cannot
   * re-prove; never self-minted post-fix since writes are gated).
   */
  async function resolveType(
    wallet: string,
    existing: ActorRow | null,
    hints: ActorHints,
    passportVerified: boolean,
  ): Promise<ActorType> {
    // 1. REGISTERED_AGENT — live proof via the registry.
    if (await ownedRegistration(wallet)) return "REGISTERED_AGENT";

    // 2. REGISTERED_USER — verified passport.
    if (passportVerified) return "REGISTERED_USER";

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
        // Keep only when the registry isn't wired (cannot re-prove).
        if (!registrations) return stored;
        // Proof gone — downgrade.
      } else if (stored === "REGISTERED_USER") {
        // Keep only when the passport port isn't wired.
        if (!passports && existing.passportTokenId) return stored;
      } else {
        return stored;
      }
    }
    return "EXTERNAL_AGENT";
  }

  async function resolveOrCreate(
    wallet: string,
    hints: ActorHints = {},
  ): Promise<ActorRow> {
    const w = assertWallet(wallet, "wallet");
    if (
      hints.type === "REGISTERED_USER" ||
      hints.type === "REGISTERED_AGENT"
    ) {
      throw invalid(
        "type hint may only be EXTERNAL_* or ORGANIZATION — REGISTERED_* is derived",
        { field: "type" },
      );
    }
    const existing = await actors.getById(w);

    // ----- link write verification (audit C-1 / H-1) -----
    // Ownership claims are proven, not asserted. `null` (clearing a
    // link) is always allowed — it can only remove status.
    let passportVerified = false;
    const effectivePassport =
      hints.passportTokenId !== undefined
        ? hints.passportTokenId
        : (existing?.passportTokenId ?? null);

    if (hints.passportTokenId != null) {
      if (!passports) {
        throw invalid(
          "passportTokenId writes require passport verification — passports port not configured",
          { field: "passportTokenId" },
        );
      }
      if (!(await passportOwned(w, hints.passportTokenId))) {
        throw invalid("passportTokenId is not owned by this wallet", {
          field: "passportTokenId",
        });
      }
      passportVerified = true;
    } else if (effectivePassport && passports) {
      passportVerified = await passportOwned(w, effectivePassport);
    }

    if (hints.agentId != null) {
      if (!registrations) {
        throw invalid(
          "agentId writes require registration verification — registrations port not configured",
          { field: "agentId" },
        );
      }
      if (!(await ownsAgent(w, hints.agentId))) {
        throw invalid("agentId is not an active registration owned by this wallet", {
          field: "agentId",
        });
      }
    }

    if (hints.type === "ORGANIZATION") {
      const orgId =
        hints.orgId !== undefined ? hints.orgId : (existing?.orgId ?? null);
      if (!orgId) {
        throw invalid("type ORGANIZATION requires orgId", {
          field: "orgId",
        });
      }
    }

    const type = await resolveType(w, existing, hints, passportVerified);
    return actors.upsert({
      wallet: w,
      type,
      agentId: hints.agentId,
      passportTokenId: hints.passportTokenId,
      did: hints.did,
      orgId: hints.orgId,
      tier: hints.tier,
      payload: hints.payload ?? existing?.payload ?? {},
    });
  }

  return {
    resolveOrCreate,

    async enrich(wallet, links) {
      // enrich == resolveOrCreate — same upsert semantics; kept as a
      // separate surface for call-site readability.
      return resolveOrCreate(wallet, links);
    },

    async get(wallet) {
      return actors.getById(assertWallet(wallet, "wallet"));
    },

    async list(opts) {
      return actors.list(opts);
    },
  };
}
