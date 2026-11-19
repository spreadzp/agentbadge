/**
 * SLICE-224-2 (EPIC-224): commerce domain services — the legality +
 * authz layer over `database.commerce` stores (D-224-2 layering:
 * schema/repos in @agentbadge/database, domain in server lib).
 *
 * Wiring: `createCommerceService(getDatabase().commerce)` — the stores
 * bundle is always non-null (in-memory fallback when DATABASE_ENABLED
 * is off). REST surface arrives in SLICE-224-3.
 */
import type { CommerceEventRow, CommerceStores } from "@agentbadge/database";

import { CommerceEventEmitter } from "./events";
import type { CommerceHooks } from "./services/ctx";
import type { CommerceSettlementBridge } from "./settlement-bridge";
import { createAgreementService, type AgreementService } from "./services/agreement-service";
import { createEvidenceService, type EvidenceService } from "./services/evidence-service";
import { createOfferService, type OfferService } from "./services/offer-service";
import { createPaymentService, type PaymentService } from "./services/payment-service";
import { createSubmissionService, type SubmissionService } from "./services/submission-service";
import { createTaskService, type TaskService } from "./services/task-service";

export interface CommerceService {
  tasks: TaskService;
  offers: OfferService;
  agreements: AgreementService;
  submissions: SubmissionService;
  evidence: EvidenceService;
  payments: PaymentService;
  events: {
    list(opts?: {
      entityType?: string;
      limit?: number;
    }): Promise<CommerceEventRow[]>;
    listByEntity(
      entityType: string,
      entityId: string,
    ): Promise<CommerceEventRow[]>;
  };
}

export function createCommerceService(
  stores: CommerceStores,
  opts?: {
    hooks?: CommerceHooks;
    /** SLICE-227-5 settlement seam — wired on prod via
     *  createCommerceSettlementBridge; absent → pure commerce. */
    settlement?: CommerceSettlementBridge;
  },
): CommerceService {
  const ctx = {
    stores,
    emit: new CommerceEventEmitter(stores.events),
    hooks: opts?.hooks,
    settlement: opts?.settlement,
  };
  return {
    tasks: createTaskService(ctx),
    offers: createOfferService(ctx),
    agreements: createAgreementService(ctx),
    submissions: createSubmissionService(ctx),
    evidence: createEvidenceService(ctx),
    payments: createPaymentService(ctx),
    events: {
      list: (opts) => stores.events.list(opts),
      listByEntity: (entityType, entityId) =>
        stores.events.listByEntity(entityType, entityId),
    },
  };
}

export { CommerceError } from "./types";
export type { CommerceErrorCode } from "./types";
