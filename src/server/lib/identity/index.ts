/**
 * SLICE-225-2 (EPIC-225): identity domain services — the legality +
 * resolution layer over `database.identity` stores (D-225-1 layering:
 * schema/repos in @agentbadge/database, domain in server lib).
 *
 * Wiring: `createIdentityService({ identity: getDatabase().identity })`
 * — the stores bundle is always non-null (in-memory fallback when
 * DATABASE_ENABLED is off). REST surface arrives in SLICE-225-3.
 */
import type { IdentityStores, PaymentStores } from "@agentbadge/database";

import {
  createActorService,
  type ActorRegistrationPort,
  type ActorService,
  type PassportVerificationPort,
} from "./actor-service";
import {
  createEntitlementService,
  type EntitlementService,
} from "./entitlements";
import {
  createFactService,
  type FactService,
  type FactSourceVerifier,
} from "./facts";
import {
  runEntitlementSweep,
  type EntitlementSweepDeps,
  type EntitlementSweepResult,
} from "./sweeper";

export interface IdentityService {
  actors: ActorService;
  entitlements: EntitlementService;
  facts: FactService;
  /**
   * One sweep tick (D-225-4): expire overdue ACTIVE rows, then grant
   * entitlements for CONFIRMED payments with catalog productIds.
   * Requires `payments` dep — throws when absent.
   */
  sweep(opts?: {
    sinceMs?: number;
    lookbackMs?: number;
    maxGrants?: number;
    /** Reversal-feed window size per tick (default 200). */
    maxReversals?: number;
  }): Promise<EntitlementSweepResult>;
}

export interface IdentityServiceDeps {
  identity: IdentityStores;
  /** ERC-8004 registry — type precedence (AgentRegistration →
   *  REGISTERED_AGENT) + agentId link proof. Optional; absent ⇒
   *  registry-derived types and agentId writes are rejected
   *  (fail-closed, audit C-1/H-1). */
  registrations?: ActorRegistrationPort;
  /** Passport ownership lookup (audit C-1). Absent ⇒ passportTokenId
   *  writes are rejected and REGISTERED_USER is unverifiable. */
  passports?: PassportVerificationPort;
  /** db.payments bundle — required for `sweep()`. Also backs the
   *  deny-by-default `verifyPayment` proof for `payment:` fact refs
   *  (audit v2 N-3 — absent ⇒ PAYMENT_VERIFIED facts reject). */
  payments?: PaymentStores;
  /** Custom payment→owner resolution (default: customerId wallet). */
  ownerFor?: EntitlementSweepDeps["ownerFor"];
  /** Existence proof for non-`payment:` fact refs — REQUIRED for
   *  TASK_COMPLETED/SUBMISSION_ACCEPTED/EVIDENCE_SUPPLIED/DISPUTE/
   *  ATTESTATION emits (audit v2 N-3 deny-by-default). */
  verifySource?: FactSourceVerifier;
  /** Custom existence proof for `payment:` refs — defaults to the
   *  payments-store check (exists + CONFIRMED + customerId ===
   *  actorWallet). Overrides that default when provided. */
  verifyPayment?: FactSourceVerifier;
  nowMs?: () => number;
}

export function createIdentityService(
  deps: IdentityServiceDeps,
): IdentityService {
  const { identity, payments, ownerFor } = deps;
  const now = deps.nowMs ?? Date.now;

  const actors = createActorService(
    identity.actors,
    deps.registrations,
    deps.passports,
  );
  // N-12 + round-3 F-5: cheap ensure — an existing actor row is
  // returned untouched (no re-type, no registry/passport RPCs);
  // resolveOrCreate runs only for wallets with no row yet.
  const ensureActor = async (wallet: string) => {
    const existing = await actors.get(wallet);
    return existing ?? actors.resolveOrCreate(wallet);
  };

  const entitlements = createEntitlementService(identity.entitlements, {
    nowMs: now,
    ensureActor,
  });
  const facts = createFactService(identity.facts, {
    nowMs: now,
    ensureActor,
    // N-3 default: prove `payment:` refs against the payments
    // store (exists + CONFIRMED + paid by the fact's actor).
    // Non-payment refs require deps.verifySource — absent ⇒ reject.
    verifyPayment:
      deps.verifyPayment ??
      (payments
        ? async ({ sourceRef, actorWallet }) => {
          const p = await payments.payments.getById(
            sourceRef.slice("payment:".length),
          );
          return (
            p !== null &&
            p.status === "CONFIRMED" &&
            typeof p.customerId === "string" &&
            p.customerId.toLowerCase() === actorWallet
          );
        }
        : undefined),
    verifySource: deps.verifySource,
  });

  // N-4: rotating keyset cursor for the reversal feed — persisted
  // in the service closure across ticks (per-process watermark;
  // restarts re-walk from the oldest row, which is safe).
  let reversalCursor: string | undefined;

  return {
    actors,
    entitlements,
    facts,
    sweep: async (opts = {}) => {
      if (!payments) {
        throw new Error(
          "identity.sweep requires the payments store bundle (deps.payments)",
        );
      }
      const result = await runEntitlementSweep({
        entitlements,
        payments,
        ownerFor,
        nowMs: now,
        reversalCursor,
        sinceMs: opts.sinceMs,
        lookbackMs: opts.lookbackMs,
        maxGrants: opts.maxGrants,
        maxReversals: opts.maxReversals,
      });
      reversalCursor = result.reversalCursor ?? undefined;
      return result;
    },
  };
}

export { IdentityError } from "./types";
export type { IdentityErrorCode } from "./types";
export type {
  ActorHints,
  ActorService,
  PassportVerificationPort,
} from "./actor-service";
export type { GrantInput, GrantResult, EntitlementService } from "./entitlements";
export type { FactInput, FactService, FactSourceVerifier } from "./facts";
export type { EntitlementSweepDeps, EntitlementSweepResult } from "./sweeper";
export {
  ACTOR_TYPES,
  ENTITLEMENT_PRODUCTS,
  ENTITLEMENT_STATUSES,
  FACT_TYPES,
} from "./types";
export type {
  ActorType,
  EntitlementCatalogEntry,
  EntitlementStatus,
  FactType,
} from "./types";
