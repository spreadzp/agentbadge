/**
 * Supply-chain handoff claim parsers — strict write-side validation of
 * caller-supplied roles (212-2/212-5) and evidence refs (213-2).
 * Extracted from state.ts (213-5, max-lines lint).
 *
 * Both take `unknown` — a typed param invites a lenient pre-parse
 * upstream, which would re-open exactly the bypass the strict schema
 * exists to close.
 */
import {
  EVIDENCE_MAX_PER_EVENT,
  EvidenceWriteListSchema,
  type EvidenceRef,
  ParticipantRolesWriteSchema,
  type ParticipantRoles,
} from "@agentbadge/econ-events";
import { logger } from "@agentbadge/passport/logger";
import { assertAddress, bound, ShipmentOrderError } from "./state";

/**
 * 212-2/212-5: validate caller-supplied handoff roles (write side).
 * Strict schema — unknown slots/keys fail loudly (audit M-3),
 * addresses normalize to lowercase, roles must name >=1 participant
 * and one address can't carry two types. custodian must equal the
 * counterparty (audit H-2) — it IS the custody receiver; the other
 * slots may legitimately be third parties.
 */
export function parseHandoffRoles(
  roles: unknown,
  counterparty: string,
): ParticipantRoles {
  const check = ParticipantRolesWriteSchema.safeParse(roles);
  if (!check.success) {
    const detail = check.error.issues
      .map((i) => `${i.path.join(".") || "roles"} ${i.message}`)
      .join("; ")
      .slice(0, 200); // M-4: bound attacker-influenced text
    throw new ShipmentOrderError(`invalid handoff roles: ${detail}`);
  }
  for (const [slot, role] of Object.entries(check.data)) {
    if (role) assertAddress(role.address, `roles.${slot}.address`);
  }
  if (
    check.data.custodian &&
    check.data.custodian.address.toLowerCase() !== counterparty.toLowerCase()
  ) {
    throw new ShipmentOrderError(
      `roles.custodian ${check.data.custodian.address} ≠ handoff counterparty ${counterparty}`,
    );
  }
  return check.data;
}

/**
 * 213-2: validate caller-supplied handoff evidence refs (write side).
 * Strict schema — unknown keys fail loudly, hash/issuer addresses
 * normalize to lowercase, uri must be http(s)/ipfs/ar, cap <=32 refs
 * (D-213-2). A ref is a LINK, not a fact (D-213-4): issuer is
 * self-declared — issuer.address outside {actor, counterparty} logs an
 * advisory warning but stays VALID (D-213-3); proving the link between
 * issuer and hop parties is a v2 verification concern.
 */
export function parseHandoffEvidence(
  refs: unknown,
  actor: string,
  counterparty: string,
  ctx?: { shipmentId?: string; hopIndex?: number },
): EvidenceRef[] {
  // 213-5 (audit M-3): the 32-cap inside the schema runs AFTER every
  // element is validated — a 100k-element body costs full parse before it
  // fails. Pre-check cardinality first.
  if (!Array.isArray(refs) || refs.length === 0 || refs.length > EVIDENCE_MAX_PER_EVENT) {
    throw new ShipmentOrderError(
      `invalid handoff evidence: expected 1..${EVIDENCE_MAX_PER_EVENT} refs, got ${
        Array.isArray(refs) ? refs.length : "non-array"}`,
    );
  }
  const check = EvidenceWriteListSchema.safeParse(refs);
  if (!check.success) {
    const detail = bound(
      check.error.issues
        .map((i) => `${i.path.join(".") || "evidence"} ${i.message}`)
        .join("; "),
    ); // M-7: sanitize + bound attacker-influenced text
    throw new ShipmentOrderError(`invalid handoff evidence: ${detail}`);
  }
  // 213-5 (audit H-1): advisory is two-sided — an issuer claiming to be
  // the OTHER hop party is a self-attestation attempt, not just a
  // third-party curiosity. One aggregated line per class per request.
  const actorLc = actor.toLowerCase();
  const cpLc = counterparty.toLowerCase();
  const otherParty: number[] = [];
  const thirdParty: number[] = [];
  for (const [i, e] of check.data.entries()) {
    // issuer.address is already lowercase (write-schema transform).
    if (e.issuer.address === actorLc) continue;
    if (e.issuer.address === cpLc) otherParty.push(i);
    else thirdParty.push(i);
  }
  if (otherParty.length > 0) {
    logger.warn("evidence issuer is the counterparty, not the asserting actor (advisory)", {
      shipmentId: ctx?.shipmentId,
      hopIndex: ctx?.hopIndex,
      indexes: otherParty,
      count: otherParty.length,
    });
  }
  if (thirdParty.length > 0) {
    logger.warn("evidence issuer is not a hop party (advisory)", {
      shipmentId: ctx?.shipmentId,
      hopIndex: ctx?.hopIndex,
      indexes: thirdParty,
      count: thirdParty.length,
      actor,
      counterparty,
    });
  }
  return check.data;
}
