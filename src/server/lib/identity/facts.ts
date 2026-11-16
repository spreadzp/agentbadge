/**
 * SLICE-225-2 (EPIC-225): reputation fact emitters (D-225-5).
 *
 * Append-only verifiable facts — never an opaque score. Every fact
 * carries `sourceRef` pointing at an auditable record (agreementId,
 * paymentId, verdictId, txHash) so a reader can verify the claim
 * against the source of truth.
 *
 * dedupeKey is computed internally — sha256 of the canonical JSON
 * encoding `[factType, subjectId, actorWallet, sourceRef]` (audit
 * M-7/N-2: concatenation without delimiters let distinct inputs
 * collide; caller-supplied keys are dropped, audit H-3). Replays
 * (sweeper retries, event re-emits) collapse to a single row via
 * the store's unique key.
 *
 * SLICE-225-6/7 (audit H-3 / v2 N-3): verification is
 * deny-by-default — every fact must carry a `sourceRef` of the
 * `prefix:id` shape bound to its factType by FACT_SOURCE_PREFIXES;
 * `subjectId`, when given, must equal the id part. `payment:` refs
 * are proven by the `verifyPayment` port (required for PAYMENT_*);
 * any other prefix requires a `verifySource` port. A fact whose
 * prefix has no configured verifier is REJECTED — unverified facts
 * cannot be minted. `atMs` must be a non-negative integer not
 * future-dated beyond a small clock-skew allowance.
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
  /** Audit v2 N-3 — existence proof for `payment:` refs. Required
   *  to emit PAYMENT_VERIFIED facts (wired to the payments store;
   *  verify customerId === actorWallet + CONFIRMED status). */
  verifyPayment?: FactSourceVerifier;
  /** Audit v2 N-3 — existence proof for every OTHER ref prefix
   *  (agreement:, submission:, evidence:, attestation:). Required
   *  for non-payment facts; a custom verifier COMPOSES with the
   *  registry/prefix checks (AND), it never replaces them. */
  verifySource?: FactSourceVerifier;
  /** Audit v2 N-12 — lazy actor upsert before append (FK safety
   *  for fact emitters about actors that have no row yet). Wired
   *  to `actors.resolveOrCreate` in the service bundle. */
  ensureActor?: (wallet: string) => Promise<unknown>;
}

/** factType → required sourceRef prefix (audit v2 N-3 registry).
 *  A sourceRef whose prefix differs — or parses to nothing —
 *  rejects before any verifier runs. */
export const FACT_SOURCE_PREFIXES: Readonly<Record<FactType, string>> = {
  TASK_COMPLETED: "agreement",
  SUBMISSION_ACCEPTED: "submission",
  EVIDENCE_SUPPLIED: "evidence",
  PAYMENT_VERIFIED: "payment",
  DISPUTE: "agreement",
  ATTESTATION: "attestation",
};

function dedupeKeyFor(
  factType: FactType,
  actorWallet: string,
  sourceRef: string,
): string {
  // Canonical JSON encoding — fields can contain `:`/"-" freely;
  // only tuple identity defines the dedupe key (audit v2 N-2).
  // Round-3 F-3: subjectId is DERIVED from sourceRef (always the
  // ref id), so the tuple is [factType, actorWallet, sourceRef] —
  // `emit({sourceRef:"a:X"})` and `emit({sourceRef:"a:X",
  // subjectId:"X"})` can no longer mint two rows.
  return createHash("sha256")
    .update(JSON.stringify([factType, actorWallet, sourceRef]))
    .digest("hex");
}

/** sourceRef charset — no whitespace/control chars (round-3 F-3):
 *  a verifier that trims or case-folds must not be able to mint a
 *  second dedupe key for the same record. */
const SOURCE_REF_BAD = /[\s\x00-\x1f\x7f]/;

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
    // Round-4 N-14: bounded length — an unbounded ref inflates the
    // dedupe key and the stored row for no functional reason.
    if (sourceRef.length > 256) {
      throw invalid("sourceRef exceeds 256 chars", { field: "sourceRef" });
    }
    if (SOURCE_REF_BAD.test(sourceRef)) {
      throw invalid("sourceRef must not contain whitespace or control characters", {
        field: "sourceRef",
      });
    }
    const atMs = input.atMs ?? now();
    if (!Number.isInteger(atMs) || atMs < 0) {
      throw invalid("atMs must be a non-negative integer (epoch ms)", {
        field: "atMs",
      });
    }
    if (atMs > now() + FUTURE_SKEW_MS) {
      throw invalid("atMs may not be future-dated", { field: "atMs" });
    }

    // --- deny-by-default source verification (audit v2 N-3) ---
    // 1. Prefix must match the factType registry entry.
    const sep = sourceRef.indexOf(":");
    const prefix = sep > 0 ? sourceRef.slice(0, sep) : "";
    const refId = sep > 0 ? sourceRef.slice(sep + 1) : "";
    if (prefix !== FACT_SOURCE_PREFIXES[input.factType] || refId === "") {
      throw invalid(
        `sourceRef for ${input.factType} must be ` +
        `"${FACT_SOURCE_PREFIXES[input.factType]}:<id>"`,
        { field: "sourceRef" },
      );
    }
    // 2. subjectId binds to the referenced record — one ref can
    //    only mint facts about ONE subject. The STORED subjectId is
    //    always the ref id (canonical — round-3 F-3).
    if (input.subjectId != null && input.subjectId !== refId) {
      throw invalid("subjectId must equal the sourceRef id", {
        field: "subjectId",
      });
    }
    const subjectId = refId;
    // 3. Existence proof — the verifier for this prefix is
    //    REQUIRED (deny by default); a custom verifySource
    //    composes AND on top of verifyPayment.
    const verifier =
      prefix === "payment" ? deps.verifyPayment : deps.verifySource;
    if (!verifier) {
      throw invalid(
        `sourceRef prefix "${prefix}" has no configured verifier — ` +
        `${input.factType} facts are rejected`,
        { field: "sourceRef" },
      );
    }
    const verified = await verifier({
      factType: input.factType,
      sourceRef,
      subjectId,
      actorWallet,
    });
    if (!verified) {
      throw invalid(`sourceRef ${sourceRef} failed verification`, {
        field: "sourceRef",
      });
    }
    if (prefix === "payment" && deps.verifySource) {
      const extra = await deps.verifySource({
        factType: input.factType,
        sourceRef,
        subjectId,
        actorWallet,
      });
      if (!extra) {
        throw invalid(`sourceRef ${sourceRef} failed verification`, {
          field: "sourceRef",
        });
      }
    }
    // Actor row must exist before append (FK — audit v2 N-12).
    await deps.ensureActor?.(actorWallet);
    return facts.append({
      id: newId("rf"),
      actorWallet,
      factType: input.factType,
      subjectId,
      sourceRef,
      dedupeKey: dedupeKeyFor(input.factType, actorWallet, sourceRef),
      atMs,
      payload: input.payload ?? {},
    });
  }

  // Typed emitters — one factory per (factType, sourceRef prefix);
  // subjectId binds to the ref id (FACT_SOURCE_PREFIXES registry).
  const typed =
    (factType: FactType, prefix: string) =>
      (actorWallet: string, subjectId: string, payload?: JsonValue) =>
        emit({
          actorWallet,
          factType,
          subjectId,
          sourceRef: `${prefix}:${subjectId}`,
          payload,
        });

  return {
    emit,
    getById: (id) => facts.getById(assertNonEmpty(id, "id")),
    listByActor: (actorWallet, opts) =>
      facts.listByActor(assertWallet(actorWallet, "actorWallet"), opts),
    countsByActor: (actorWallet) =>
      facts.countsByActor(assertWallet(actorWallet, "actorWallet")),

    taskCompleted: typed("TASK_COMPLETED", "agreement"),
    submissionAccepted: typed("SUBMISSION_ACCEPTED", "submission"),
    evidenceSupplied: typed("EVIDENCE_SUPPLIED", "evidence"),
    paymentVerified: typed("PAYMENT_VERIFIED", "payment"),
    dispute: typed("DISPUTE", "agreement"),
    attestation: typed("ATTESTATION", "attestation"),
  };
}
