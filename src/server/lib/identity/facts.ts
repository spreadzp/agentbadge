/**
 * SLICE-225-2 (EPIC-225): reputation fact emitters (D-225-5).
 *
 * Append-only verifiable facts — never an opaque score. Every fact
 * carries `sourceRef` pointing at an auditable record (agreementId,
 * paymentId, verdictId, txHash) so a reader can verify the claim
 * against the source of truth.
 *
 * dedupeKey is computed internally — sha256 of
 * `factType:subjectId:actorWallet:sourceRef` (audit M-7: the raw
 * joined string collided on attacker-controlled delimiters;
 * caller-supplied keys are dropped, audit H-3). Replays (sweeper
 * retries, event re-emits) collapse to a single row via the
 * store's unique key.
 *
 * SLICE-225-6 (audit H-3): an optional `verifySource` port proves
 * the referenced record exists before a fact is appended — wired
 * for `payment:` refs against the payments store. Types without a
 * configured verifier pass through (documented D-225-9). `atMs`
 * may not be future-dated beyond a small clock-skew allowance.
 */
import { createHash } from "node:crypto";
import type { ReputationFactRow, ReputationFactStore } from "@agentbadge/database";
import type { JsonValue } from "@prisma/orm-postgres/target/codec-types";

import { newId } from "../commerce/guards";
import { assertNonEmpty, assertWallet } from "./guards";
import { FACT_TYPES, invalid, type FactType } from "./types";

/** Future-timestamp allowance for `atMs` (clock skew between
 *  producers), audit H-3. */
const FUTURE_SKEW_MS = 60_000;

export interface FactInput {
  actorWallet: string;
  factType: FactType;
  /** taskId / submissionId / evidenceId / paymentId / … */
  subjectId?: string | null;
  /** → auditable record (verifiability anchor, D-225-5). */
  sourceRef: string;
  atMs?: number;
  payload?: JsonValue;
}

/**
 * Source-reference verifier (audit H-3). Return false ⇒ the fact is
 * rejected. The port receives the parsed fact, so a verifier can
 * check existence AND the actor's relation to the record (e.g.
 * payment.customerId === actorWallet).
 */
export type FactSourceVerifier = (input: {
  factType: FactType;
  sourceRef: string;
  subjectId: string | null;
  actorWallet: string;
}) => Promise<boolean>;

export interface FactService {
  /** `null` on dedupe hit (idempotent). */
  emit(input: FactInput): Promise<ReputationFactRow | null>;
  getById(id: string): Promise<ReputationFactRow | null>;
  listByActor(
    actorWallet: string,
    opts?: { factType?: string; limit?: number },
  ): Promise<ReputationFactRow[]>;
  countsByActor(actorWallet: string): Promise<Record<string, number>>;
  // ---- typed emitters for the commerce event hooks ----
  taskCompleted(
    actorWallet: string,
    agreementId: string,
    payload?: JsonValue,
  ): Promise<ReputationFactRow | null>;
  submissionAccepted(
    actorWallet: string,
    submissionId: string,
    payload?: JsonValue,
  ): Promise<ReputationFactRow | null>;
  evidenceSupplied(
    actorWallet: string,
    evidenceId: string,
    payload?: JsonValue,
  ): Promise<ReputationFactRow | null>;
  paymentVerified(
    actorWallet: string,
    paymentId: string,
    payload?: JsonValue,
  ): Promise<ReputationFactRow | null>;
  dispute(
    actorWallet: string,
    agreementId: string,
    payload?: JsonValue,
  ): Promise<ReputationFactRow | null>;
  attestation(
    actorWallet: string,
    attestationId: string,
    payload?: JsonValue,
  ): Promise<ReputationFactRow | null>;
}

export interface FactServiceDeps {
  nowMs?: () => number;
  /** Audit H-3 — proves the sourceRef record exists/relates before
   *  append. Absent ⇒ refs are stored unverified (same as pre-fix;
   *  callers remain the trust boundary). */
  verifySource?: FactSourceVerifier;
}

function dedupeKeyFor(
  factType: FactType,
  subjectId: string | null,
  actorWallet: string,
  sourceRef: string,
): string {
  return createHash("sha256")
    .update(`${factType}${subjectId ?? "-"}${actorWallet}${sourceRef}`)
    .digest("hex");
}

export function createFactService(
  facts: ReputationFactStore,
  deps: FactServiceDeps = {},
): FactService {
  const now = deps.nowMs ?? Date.now;

  async function emit(input: FactInput): Promise<ReputationFactRow | null> {
    const actorWallet = assertWallet(input.actorWallet, "actorWallet");
    if (!FACT_TYPES.includes(input.factType)) {
      throw invalid(`unknown factType ${input.factType}`, {
        field: "factType",
      });
    }
    const sourceRef = assertNonEmpty(input.sourceRef, "sourceRef");
    const atMs = input.atMs ?? now();
    if (atMs > now() + FUTURE_SKEW_MS) {
      throw invalid("atMs may not be future-dated", { field: "atMs" });
    }
    if (deps.verifySource) {
      const ok = await deps.verifySource({
        factType: input.factType,
        sourceRef,
        subjectId: input.subjectId ?? null,
        actorWallet,
      });
      if (!ok) {
        throw invalid(`sourceRef ${sourceRef} failed verification`, {
          field: "sourceRef",
        });
      }
    }
    return facts.append({
      id: newId("rf"),
      actorWallet,
      factType: input.factType,
      subjectId: input.subjectId ?? null,
      sourceRef,
      dedupeKey: dedupeKeyFor(
        input.factType,
        input.subjectId ?? null,
        actorWallet,
        sourceRef,
      ),
      atMs,
      payload: input.payload ?? {},
    });
  }

  return {
    emit,
    getById: (id) => facts.getById(assertNonEmpty(id, "id")),
    listByActor: (actorWallet, opts) =>
      facts.listByActor(assertWallet(actorWallet, "actorWallet"), opts),
    countsByActor: (actorWallet) =>
      facts.countsByActor(assertWallet(actorWallet, "actorWallet")),

    taskCompleted: (actorWallet, agreementId, payload) =>
      emit({
        actorWallet,
        factType: "TASK_COMPLETED",
        subjectId: agreementId,
        sourceRef: `agreement:${agreementId}`,
        payload,
      }),
    submissionAccepted: (actorWallet, submissionId, payload) =>
      emit({
        actorWallet,
        factType: "SUBMISSION_ACCEPTED",
        subjectId: submissionId,
        sourceRef: `submission:${submissionId}`,
        payload,
      }),
    evidenceSupplied: (actorWallet, evidenceId, payload) =>
      emit({
        actorWallet,
        factType: "EVIDENCE_SUPPLIED",
        subjectId: evidenceId,
        sourceRef: `evidence:${evidenceId}`,
        payload,
      }),
    paymentVerified: (actorWallet, paymentId, payload) =>
      emit({
        actorWallet,
        factType: "PAYMENT_VERIFIED",
        subjectId: paymentId,
        sourceRef: `payment:${paymentId}`,
        payload,
      }),
    dispute: (actorWallet, agreementId, payload) =>
      emit({
        actorWallet,
        factType: "DISPUTE",
        subjectId: agreementId,
        sourceRef: `agreement:${agreementId}`,
        payload,
      }),
    attestation: (actorWallet, attestationId, payload) =>
      emit({
        actorWallet,
        factType: "ATTESTATION",
        subjectId: attestationId,
        sourceRef: `attestation:${attestationId}`,
        payload,
      }),
  };
}
