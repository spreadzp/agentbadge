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
} from "./actor-service";
import {
  createEntitlementService,
  type EntitlementService,
} from "./entitlements";
import { createFactService, type FactService } from "./facts";
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
  }): Promise<EntitlementSweepResult>;
}

export interface IdentityServiceDeps {
  identity: IdentityStores;
  /** ERC-8004 registry — type precedence (AgentRegistration →
   *  REGISTERED_AGENT). Optional; absent ⇒ registry-derived types
   *  unavailable. */
  registrations?: ActorRegistrationPort;
  /** db.payments bundle — required for `sweep()` only. */
  payments?: PaymentStores;
  /** Custom payment→owner resolution (default: customerId wallet). */
  ownerFor?: EntitlementSweepDeps["ownerFor"];
  nowMs?: () => number;
}

export function createIdentityService(
  deps: IdentityServiceDeps,
): IdentityService {
  const { identity, payments, ownerFor } = deps;
  const now = deps.nowMs ?? Date.now;

  const actors = createActorService(identity.actors, deps.registrations);
  const entitlements = createEntitlementService(identity.entitlements, {
    nowMs: now,
  });
  const facts = createFactService(identity.facts, { nowMs: now });

  return {
    actors,
    entitlements,
    facts,
    sweep: (opts = {}) => {
      if (!payments) {
        throw new Error(
          "identity.sweep requires the payments store bundle (deps.payments)",
        );
      }
      return runEntitlementSweep({
        entitlements,
        payments,
        ownerFor,
        nowMs: now,
        ...opts,
      });
    },
  };
}

export { IdentityError } from "./types";
export type { IdentityErrorCode } from "./types";
export type { ActorHints, ActorService } from "./actor-service";
export type { GrantInput, GrantResult, EntitlementService } from "./entitlements";
export type { FactInput, FactService } from "./facts";
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
