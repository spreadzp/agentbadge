/**
 * EPIC-225 (audit round-3 F-2/F-4/F-10): identity service
 * wiring — single lazy singleton shared by the REST routes
 * (routes/index.ts) and the background sweeper
 * (services/identity-sweeper.ts).
 *
 * Ports:
 * - registrations: `null` when the agent-registration store is
 *   not yet published — UNKNOWN, never "no registrations"
 *   (round-3 F-2; the actor service keeps stored
 *   REGISTERED_AGENT and 503s new agentId writes).
 * - passports: non-numeric tokenId → null (unowned) instead of
 *   BigInt SyntaxError → "unknown" → 503 (round-3 F-10).
 * - verifySource: commerce-backed existence proof for
 *   agreement:/submission:/evidence: refs (round-3 F-4).
 *   attestation: has no store yet — stays deny-by-default.
 */
import { getDatabase } from "../lib/database";
import { getAgentRegistrationStore } from "../lib/agent-registration/store";
import { getMarketplaceOps } from "../lib/marketplace/ops";
import {
  createIdentityService,
  type IdentityService,
  type FactSourceVerifier,
} from "../lib/identity";

let instance: IdentityService | null = null;

const PASSPORT_TOKEN_RE = /^\d{1,78}$/;
/** ERC-721 tokenId is uint256 — values ≥ 2^256 pass the
 *  78-digit regex but make viem's encoder throw (round-4 N-6),
 *  which the caller reads as "unknown" → 503 for a malformed
 *  input. Check the bound before BigInt→viem. */
const UINT256_MAX = 1n << 256n;

/**
 * Commerce-backed verifier for non-payment fact refs.
 *
 * Round-4 N-1: party-of-record is necessary but not sufficient —
 * the fact type binds BOTH the actor's role on the record and the
 * record's state, otherwise any party could mint TASK_COMPLETED on
 * a CANCELLED agreement or SUBMISSION_ACCEPTED on a rejected one:
 *   TASK_COMPLETED      → provider AND agreement.status=COMPLETED
 *   DISPUTE             → any party AND agreement.status=DISPUTED
 *   SUBMISSION_ACCEPTED → provider AND submission.status=ACCEPTED
 *   EVIDENCE_SUPPLIED   → supplier (submission provider, or
 *                         agreement party for agreement-level rows)
 * `payment:` refs already passed the verifyPayment port — the
 * extra verifySource AND (facts.ts) must not deny them here.
 */
const commerceVerifySource: FactSourceVerifier = async ({
  factType,
  sourceRef,
  actorWallet,
}) => {
  const sep = sourceRef.indexOf(":");
  const prefix = sep > 0 ? sourceRef.slice(0, sep) : "";
  const refId = sep > 0 ? sourceRef.slice(sep + 1) : "";
  if (refId === "") return false;
  if (prefix === "payment") return true;
  const commerce = getDatabase().commerce;
  const w = actorWallet.toLowerCase();
  const isParty = (a: {
    buyerWallet?: string | null;
    providerWallet?: string | null;
  }) =>
    a.buyerWallet?.toLowerCase() === w ||
    a.providerWallet?.toLowerCase() === w;

  if (prefix === "agreement") {
    const a = await commerce.agreements.getById(refId);
    if (a === null) return false;
    // N-13: `?.` on every wallet — a null side can never match.
    if (factType === "TASK_COMPLETED")
      return (
        a.providerWallet?.toLowerCase() === w && a.status === "COMPLETED"
      );
    if (factType === "DISPUTE")
      return isParty(a) && a.status === "DISPUTED";
    // Other agreement-anchored fact types: a party on a live row.
    return isParty(a) && a.status !== "CANCELLED";
  }
  if (prefix === "submission") {
    const s = await commerce.submissions.getById(refId);
    if (s === null) return false;
    if (factType === "SUBMISSION_ACCEPTED")
      return (
        s.providerWallet?.toLowerCase() === w && s.status === "ACCEPTED"
      );
    return s.providerWallet?.toLowerCase() === w;
  }
  if (prefix === "evidence") {
    const e = await commerce.evidence.getById(refId);
    if (e === null) return false;
    if (e.submissionId) {
      const s = await commerce.submissions.getById(e.submissionId);
      if (s !== null) return s.providerWallet?.toLowerCase() === w;
    }
    if (e.agreementId) {
      const a = await commerce.agreements.getById(e.agreementId);
      return a !== null && isParty(a);
    }
    return false;
  }
  // attestation: — no backing store yet; deny-by-default (N-3).
  return false;
};

export function getIdentityService(): IdentityService {
  if (instance) return instance;
  instance = createIdentityService({
    identity: getDatabase().identity,
    payments: getDatabase().payments,
    registrations: {
      // Lazy port — wireAgentRegistration publishes the active
      // store AFTER registerApiRoutes; resolve at call time.
      // null = unavailable (round-3 F-2), NOT an empty registry.
      async list() {
        const store = await getAgentRegistrationStore();
        return store === null ? null : store.list();
      },
    },
    passports: {
      // Audit C-1 / v2 N-7 / round-3 F-10: passportTokenId writes
      // must prove ownership — onchain ownerOf via the marketplace
      // ops read. The actor service distinguishes outcomes:
      //   wallet  → "owned"   (proof holds)
      //   null    → "unowned" (lookup ran; different owner / token
      //             missing / non-numeric id)
      //   throw   → "unknown" (transient RPC failure ⇒ 503 on
      //             writes, stored REGISTERED_USER retained).
      // Errors must propagate — catch→null would conflate
      // "lookup failed" with "not the owner".
      async ownerOf(tokenId) {
        if (!PASSPORT_TOKEN_RE.test(tokenId)) return null;
        const id = BigInt(tokenId);
        // N-6: ≥2^256 can never be an onchain token → unowned,
        // not "unknown" (avoids the encoder throw → 503 path).
        if (id >= UINT256_MAX) return null;
        return getMarketplaceOps().passportOwner(id);
      },
    },
    verifySource: commerceVerifySource,
  });
  return instance;
}
