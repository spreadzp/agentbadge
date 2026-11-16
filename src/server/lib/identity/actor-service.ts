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
 * proof is now disproven — EXTERNAL_* / ORGANIZATION are sticky
 * (ORGANIZATION additionally requires a non-empty orgId; a cleared
 * orgId downgrades it, audit v2 N-9), REGISTERED_* must hold the
 * underlying link to survive. A transient verification error
 * (ownerOf throws / registry list fails) is UNKNOWN, not "not
 * owned" — it never downgrades a stored REGISTERED_* type and
 * rejects new link writes with 503 (audit v2 N-7). Concurrent
 * writes for the same wallet are serialized per-wallet (v2 N-17).
 */
import type { ActorRow, ActorStore } from "@agentbadge/database";
import type { JsonValue } from "@prisma/orm-postgres/target/codec-types";

import { assertWallet } from "./guards";
import { createActorVerifier, type RegList } from "./actor-verify";
import { IdentityError, invalid, type ActorType } from "./types";

/** Minimal port over the ERC-8004 registration registry (184).
 *  `null` = registry UNAVAILABLE (store not published yet) — the
 *  service treats it as unknown, never as "no registrations"
 *  (audit round-3 F-2). */
export interface ActorRegistrationPort {
  list(): Promise<
    | ReadonlyArray<{
      agentId: string;
      owner?: string;
      status: string;
    }>
    | null
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
   *  real registrations/passports). ORGANIZATION requires a
   *  non-empty orgId (audit v2 N-9). */
  type?: ActorType;
  /** Write requires proof: active registration owned by the wallet. */
  agentId?: string | null;
  /** Write requires proof: passport owned by the wallet (passports
   *  port). */
  passportTokenId?: string | null;
  /** `did:<method>:<id>` shape, ≤256 chars (audit v2 N-9). */
  did?: string | null;
  /** Trimmed non-empty string, ≤128 chars (audit v2 N-9). */
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

/** Bound on agentId/did/orgId/passportTokenId hint strings (v2 N-9). */
const HINT_MAX = 256;
/** `did:<method>:<method-specific-id>` — loose W3C DID shape. */
const DID_RE = /^did:[a-zA-Z0-9]+:[A-Za-z0-9._:%-]{1,240}$/;

export function createActorService(
  actors: ActorStore,
  registrations?: ActorRegistrationPort,
  passports?: PassportVerificationPort,
): ActorService {
  const verify = createActorVerifier(registrations, passports);

  // N-17: per-wallet mutex — concurrent resolveOrCreate for the
  //  same wallet must not interleave type computation + upsert.
  const walletLocks = new Map<string, Promise<unknown>>();
  function withWalletLock<T>(wallet: string, fn: () => Promise<T>) {
    const prev = walletLocks.get(wallet) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    walletLocks.set(
      wallet,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  async function resolveOrCreateInner(
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

    // ----- link field shape guards (audit v2 N-9 / N-13) -----
    const bound = (v: string | null | undefined, field: string) => {
      if (typeof v === "string" && (v.trim() === "" || v.length > HINT_MAX)) {
        throw invalid(`${field} must be a non-empty string ≤ ${HINT_MAX} chars`, {
          field,
        });
      }
      return typeof v === "string" ? v.trim() : v;
    };
    const orgIdNorm = bound(hints.orgId, "orgId");
    const didNorm = bound(hints.did, "did");
    const agentIdNorm = bound(hints.agentId, "agentId");
    const passportNorm = bound(hints.passportTokenId, "passportTokenId");
    if (typeof didNorm === "string" && !DID_RE.test(didNorm)) {
      throw invalid("did must match did:<method>:<id>", { field: "did" });
    }

    // ----- link write verification (audit C-1 / H-1) -----
    // Ownership claims are proven, not asserted. `null` (clearing a
    // link) is always allowed — it can only remove status.
    let passportVerified = false;
    const effectivePassport =
      passportNorm !== undefined
        ? passportNorm
        : (existing?.passportTokenId ?? null);

    // Round-3 F-1: default "unowned" — "unknown" only when a lookup
    // actually ran and failed. A cleared/absent passport is disproof.
    let passportStateOfStored: "owned" | "unowned" | "unknown" = "unowned";
    if (passportNorm != null) {
      if (!passports) {
        throw invalid(
          "passportTokenId writes require passport verification — passports port not configured",
          { field: "passportTokenId" },
        );
      }
      const state = await verify.passportState(w, passportNorm);
      if (state === "unknown") {
        // Audit v2 N-7: a transient lookup failure is not proof
        // of non-ownership — fail the write as unavailable.
        throw new IdentityError(
          "INVALID",
          "passport ownership could not be verified (lookup unavailable)",
          503,
          { field: "passportTokenId" },
        );
      }
      if (state === "unowned") {
        throw invalid("passportTokenId is not owned by this wallet", {
          field: "passportTokenId",
        });
      }
      passportVerified = true;
    } else if (effectivePassport && passports) {
      passportStateOfStored = await verify.passportState(w, effectivePassport);
      passportVerified = passportStateOfStored === "owned";
    }

    // N-7: one registrations.list() per write — the link check
    //  and the type derivation share it. No cross-call caching: a
    //  stale read would let writes race a just-changed registry.
    let regsPromise: Promise<RegList | null> | null = null;
    const listOnce = () => {
      // N-4: a rejecting registry read maps to `null` (unavailable)
      // — the same tri-state as an absent port. Without the catch
      // every write failed 500, including wallets with no agent link.
      regsPromise ??= (registrations?.list() ?? Promise.resolve(null))
        .catch(() => null);
      return regsPromise;
    };

    if (agentIdNorm != null) {
      if (!registrations) {
        throw invalid(
          "agentId writes require registration verification — registrations port not configured",
          { field: "agentId" },
        );
      }
      const agentState = await verify.ownsAgent(w, agentIdNorm, listOnce);
      if (agentState === "unknown") {
        // Round-3 F-2: registry unavailable — not proof of
        // non-ownership; fail the write as unavailable (503).
        throw new IdentityError(
          "INVALID",
          "registration registry unavailable — agentId could not be verified",
          503,
          { field: "agentId" },
        );
      }
      if (agentState === "unowned") {
        throw invalid("agentId is not an active registration owned by this wallet", {
          field: "agentId",
        });
      }
    }

    if (hints.type === "ORGANIZATION") {
      const orgId =
        orgIdNorm !== undefined ? orgIdNorm : (existing?.orgId ?? null);
      if (typeof orgId !== "string" || orgId.trim() === "") {
        throw invalid("type ORGANIZATION requires orgId", {
          field: "orgId",
        });
      }
    }

    const type = await verify.resolveType(
      w,
      existing,
      hints,
      passportVerified,
      passportStateOfStored,
      listOnce,
    );
    return actors.upsert({
      wallet: w,
      type,
      agentId: agentIdNorm,
      passportTokenId: passportNorm,
      did: didNorm,
      orgId: orgIdNorm,
      tier: hints.tier,
      payload: hints.payload ?? existing?.payload ?? {},
    });
  }

  // N-17: every write path serializes the check-compute-upsert
  //  sequence per wallet — concurrent writes must not interleave
  //  type derivation.
  const resolveOrCreateLocked = (wallet: string, hints?: ActorHints) => {
    // Round-3 F-7: validate BEFORE lowercasing — a non-string input
    // must 400, not TypeError→500.
    const w = assertWallet(wallet, "wallet");
    return withWalletLock(w.toLowerCase(), () =>
      resolveOrCreateInner(w, hints),
    );
  };

  return {
    resolveOrCreate: resolveOrCreateLocked,

    async enrich(wallet, links) {
      // enrich == resolveOrCreate — same upsert semantics; kept as a
      // separate surface for call-site readability.
      return resolveOrCreateLocked(wallet, links);
    },

    async get(wallet) {
      return actors.getById(assertWallet(wallet, "wallet"));
    },

    async list(opts) {
      return actors.list(opts);
    },
  };
}
