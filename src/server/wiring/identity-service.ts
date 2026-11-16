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

/** Commerce-backed verifier for non-payment fact refs. */
const commerceVerifySource: FactSourceVerifier = async ({
  sourceRef,
  actorWallet,
}) => {
  const sep = sourceRef.indexOf(":");
  const prefix = sep > 0 ? sourceRef.slice(0, sep) : "";
  const refId = sep > 0 ? sourceRef.slice(sep + 1) : "";
  if (refId === "") return false;
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
    return a !== null && isParty(a);
  }
  if (prefix === "submission") {
    const s = await commerce.submissions.getById(refId);
    return s !== null && s.providerWallet.toLowerCase() === w;
  }
  if (prefix === "evidence") {
    const e = await commerce.evidence.getById(refId);
    if (e === null) return false;
    if (e.submissionId) {
      const s = await commerce.submissions.getById(e.submissionId);
      if (s !== null) return s.providerWallet.toLowerCase() === w;
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
        return getMarketplaceOps().passportOwner(BigInt(tokenId));
      },
    },
    verifySource: commerceVerifySource,
  });
  return instance;
}
