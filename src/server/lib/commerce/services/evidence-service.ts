/**
 * Evidence service — append-only attachments (D-224-11). Anchored to a
 * submission (either party of the parent agreement) or directly to an
 * agreement (either party). No update/delete paths exist on the store.
 */
import type { CommerceEvidenceRow } from "@agentbadge/database";
import { idempotentWrite } from "../../contract-guards";
import {
  assertEvidenceShape,
  assertIdempotencyKey,
  assertWallet,
  newId,
} from "../guards";
import {
  EVIDENCE_TYPES,
  forbidden,
  guardRejected,
  type EvidenceAttachInput,
} from "../types";
import { mustGet, type CommerceCtx } from "./ctx";

export interface EvidenceService {
  attach(
    actorWallet: string,
    input: EvidenceAttachInput,
    idempotencyKey?: string,
    /** H1: sha256 of the signed request body — binds the dedupe entry. */
    bodyFingerprint?: string,
  ): Promise<{ evidence: CommerceEvidenceRow; duplicate: boolean }>;
  listBySubmission(submissionId: string): Promise<CommerceEvidenceRow[]>;
  listByAgreement(agreementId: string): Promise<CommerceEvidenceRow[]>;
}

export function createEvidenceService(ctx: CommerceCtx): EvidenceService {
  const { stores, emit } = ctx;

  return {
    async attach(actorWallet, input, idempotencyKey, bodyFingerprint) {
      const actor = assertWallet(actorWallet, "actorWallet");
      if (idempotencyKey !== undefined) {
        assertIdempotencyKey(idempotencyKey);
        const res = await idempotentWrite(
          "commerce.evidence.attach",
          idempotencyKey,
          async () => {
            const evidence = await doAttach(actor);
            return { status: 201, body: { evidence } };
          },
          {
            owner: actor,
            resource: input.submissionId ?? input.agreementId,
            fingerprint: bodyFingerprint,
          },
        );
        return {
          evidence: (res.body as { evidence: CommerceEvidenceRow }).evidence,
          duplicate: res.duplicate,
        };
      }
      const evidence = await doAttach(actor);
      return { evidence, duplicate: false };

      async function doAttach(actor: string): Promise<CommerceEvidenceRow> {
        if (!EVIDENCE_TYPES.includes(input.type)) {
          throw guardRejected(
            `evidence type must be ${EVIDENCE_TYPES.join("|")}`,
            { type: input.type },
          );
        }
        assertEvidenceShape(input);

        let agreementId: string | null = null;
        if (input.submissionId) {
          const submission = mustGet(
            await stores.submissions.getById(input.submissionId),
            "submission",
            input.submissionId,
          );
          agreementId = submission.agreementId;
        } else if (input.agreementId) {
          agreementId = input.agreementId;
        } else {
          throw guardRejected(
            "evidence requires submissionId or agreementId anchor",
          );
        }
        const agreement = mustGet(
          await stores.agreements.getById(agreementId),
          "agreement",
          agreementId,
        );
        if (
          actor !== agreement.providerWallet &&
          actor !== agreement.buyerWallet
        ) {
          throw forbidden("only agreement parties can attach evidence");
        }
        // Evidence documents live work — closed agreements take nothing.
        if (agreement.status !== "ACTIVE") {
          throw guardRejected(
            `agreement is ${agreement.status} — evidence only on ACTIVE`,
            { agreementId, status: agreement.status },
          );
        }
        const evidence = await stores.evidence.append({
          id: newId("ev"),
          submissionId: input.submissionId ?? null,
          agreementId,
          type: input.type,
          url: input.url ?? null,
          hash: input.hash ?? null,
          content: input.content ?? null,
          metadata: input.metadata ?? null,
          payload: (input.payload ?? {}) as Record<string, never>,
        });
        if (!evidence) throw new Error("evidence id collision");
        await emit.emit({
          entityType: "evidence",
          entityId: evidence.id,
          eventType: "evidence.attached",
          actorWallet: actor,
          payload: {
            submissionId: input.submissionId ?? null,
            agreementId,
            type: input.type,
            attachedBy: actor,
          },
        });
        return evidence;
      }
    },

    listBySubmission: (submissionId) =>
      stores.evidence.listBySubmission(submissionId),
    listByAgreement: (agreementId) =>
      stores.evidence.listByAgreement(agreementId),
  };
}
