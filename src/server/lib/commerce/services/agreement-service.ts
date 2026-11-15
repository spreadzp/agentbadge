/**
 * Agreement service — read surface only in v1. Agreements are created by
 * offer.accept (single-round, D-224-9) and complete via submission review
 * ACCEPTED or cancel via task.cancel. DISPUTED is reserved (D-224-5).
 */
import type { CommerceAgreementRow } from "@agentbadge/database";

import type { CommerceCtx } from "./ctx";

export interface AgreementService {
  get(agreementId: string): Promise<CommerceAgreementRow | null>;
  getByTaskId(taskId: string): Promise<CommerceAgreementRow | null>;
  getByOfferId(offerId: string): Promise<CommerceAgreementRow | null>;
}

export function createAgreementService(ctx: CommerceCtx): AgreementService {
  const { stores } = ctx;
  return {
    get: (id) => stores.agreements.getById(id),
    getByTaskId: (taskId) => stores.agreements.getByTaskId(taskId),
    getByOfferId: (offerId) => stores.agreements.getByOfferId(offerId),
  };
}
