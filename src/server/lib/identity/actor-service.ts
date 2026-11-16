/**
 * SLICE-225-2 (EPIC-225): actor service — lazy upsert on first
 * action, type resolution precedence, link enrichment.
 *
 * Type precedence (slice contract):
 *   AgentRegistration (active, owner === wallet) → REGISTERED_AGENT
 *   passportTokenId (hint or stored)             → REGISTERED_USER
 *   orgId + explicit ORGANIZATION hint           → ORGANIZATION
 *   caller hint.type (EXTERNAL_*)                → hint
 *   previously stored type                       → keep
 *   fallback                                     → EXTERNAL_AGENT
 *
 * A bare `resolveOrCreate(wallet)` never downgrades a registered
 * type to EXTERNAL_* — precedence is monotonic (REGISTERED_* >
 * ORGANIZATION > EXTERNAL_*).
 */
import type { ActorRow, ActorStore } from "@agentbadge/database";
import type { JsonValue } from "@prisma/orm-postgres/target/codec-types";

import { assertWallet } from "./guards";
import { invalid, notFound, type ActorType } from "./types";

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

export interface ActorHints {
  /** Caller-asserted type — EXTERNAL_* or ORGANIZATION only; the
   *  REGISTERED_* types are derived, never asserted (they come from
   *  real registrations/passports). */
  type?: ActorType;
  agentId?: string | null;
  passportTokenId?: string | null;
  did?: string | null;
  orgId?: string | null;
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

const REGISTERED_RANK: Record<string, number> = {
  EXTERNAL_HUMAN: 0,
  EXTERNAL_AGENT: 0,
  ORGANIZATION: 1,
  REGISTERED_USER: 2,
  REGISTERED_AGENT: 3,
};

export function createActorService(
  actors: ActorStore,
  registrations?: ActorRegistrationPort,
): ActorService {
  async function resolveType(
    wallet: string,
    existing: ActorRow | null,
    hints: ActorHints,
  ): Promise<ActorType> {
    // Highest precedence: an ACTIVE ERC-8004 registration owned by
    // this wallet → REGISTERED_AGENT.
    if (registrations) {
      const regs = await registrations.list();
      const hit = regs.find(
        (r) =>
          r.status === "active" &&
          typeof r.owner === "string" &&
          r.owner.toLowerCase() === wallet,
      );
      if (hit) return "REGISTERED_AGENT";
    }
    const passportTokenId =
      hints.passportTokenId !== undefined
        ? hints.passportTokenId
        : (existing?.passportTokenId ?? null);
    if (passportTokenId) return "REGISTERED_USER";

    const hinted = hints.type;
    if (hinted === "ORGANIZATION") return "ORGANIZATION";
    if (hinted === "EXTERNAL_HUMAN") return "EXTERNAL_HUMAN";
    if (hinted === "EXTERNAL_AGENT") return "EXTERNAL_AGENT";
    // REGISTERED_* hints are ignored — they must be proven.

    // Keep a previously-stored type — but never below the stored
    // rank (a REGISTERED_* row never silently downgrades).
    if (existing) return existing.type as ActorType;
    return "EXTERNAL_AGENT";
  }

  async function resolveOrCreate(
    wallet: string,
    hints: ActorHints = {},
  ): Promise<ActorRow> {
    const w = assertWallet(wallet, "wallet");
    if (
      hints.type !== undefined &&
      (hints.type === "REGISTERED_USER" ||
        hints.type === "REGISTERED_AGENT")
    ) {
      throw invalid(
        "type hint may only be EXTERNAL_* or ORGANIZATION — REGISTERED_* is derived",
        { field: "type" },
      );
    }
    const existing = await actors.getById(w);
    const type = await resolveType(w, existing, hints);
    const merged =
      existing && REGISTERED_RANK[type] < REGISTERED_RANK[existing.type]
        ? (existing.type as ActorType)
        : type;
    return actors.upsert({
      wallet: w,
      type: merged,
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

export { notFound };
