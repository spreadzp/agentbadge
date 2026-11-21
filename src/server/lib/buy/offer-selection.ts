// SLICE-257-13 (arc-audit C-1/C-2): signing-offer selection +
// deal binding for the counterparty gate.
//
// --max-amount is a ceiling, not a pin — the CLI may sign ANY accepts[]
// entry ≤ ceiling. A deal is provable only when EVERY signable entry
// normalizes to the same terms; a signable entry that differs (or one
// we cannot parse at all) is an offer we did not vet that could be
// signed → unverifiable_challenge, a non-approvable deny. Fingerprint +
// terms-match bind the vetted offer (C2: match per payment).

import {
  dealFingerprint,
  normalizeTerms,
  offeredTermsFromRequirements,
  type NormalizedTerms,
  type OfferedTerms,
} from "@agentbadge/circle-payments";
import type { BuyQuote } from "./gateway";

/** What the deal-binding step derived from the quote's raw challenge. */
export interface DealBinding {
  /** The accepts entry the payment will sign (when unambiguous). */
  offer?: OfferedTerms;
  /** sha256:v1 fingerprint over wallet+url+offer — the permit key. */
  fingerprint?: string;
  /** Why no binding could be derived (unselectable challenge). */
  offerError?: string;
}

export type OfferSelectionError =
  | "no_matching_offer"
  | "ambiguous_offers"
  | "unverifiable_challenge"
  | "uncomparable_offer";

const sameTerms = (a: NormalizedTerms, b: NormalizedTerms): boolean =>
  a.payTo === b.payTo &&
  a.asset === b.asset &&
  a.amount === b.amount &&
  a.network === b.network &&
  a.scheme === b.scheme;

/**
 * Whole-challenge analysis (arc-audit C-1/C-2). The ceiling is
 * maxAmountAtomic; EVERY entry that normalizes at-or-under it is
 * "signable" — the CLI could pick it. The vetted offer = entries
 * exactly at the ceiling; identical duplicates collapse to one deal.
 *
 * Errors: no at-cap entry → no_matching_offer; at-cap entries with
 * distinct terms → ambiguous_offers; a unique vetted deal but ANY
 * signable entry differing in terms (incl. cheaper) OR any entry we
 * cannot normalize while its amount sits under the ceiling →
 * unverifiable_challenge. A v1 flat challenge (no accepts[]) falls
 * back to top-level fields.
 */
export function selectSigningOffer(
  raw: unknown,
  maxAmountAtomic: string,
): { ok: true; offer: OfferedTerms } | { ok: false; error: OfferSelectionError } {
  const r = (raw ?? {}) as Record<string, unknown>;
  // M-2: an unparseable ceiling means the signable set cannot be
  // bounded at all — typed deny, never a raw BigInt throw.
  if (!/^\d{1,78}$/.test(maxAmountAtomic.trim())) {
    return { ok: false, error: "unverifiable_challenge" };
  }
  const ceiling = BigInt(maxAmountAtomic);
  const candidates: unknown[] = Array.isArray(r.accepts) ? r.accepts : [r];
  const signable: { offer: OfferedTerms; norm: NormalizedTerms }[] = [];
  let blind = 0;
  for (const e of candidates) {
    let offer: OfferedTerms;
    try {
      offer = offeredTermsFromRequirements(e as never);
    } catch {
      continue; // no amount field at all — not an offer entry
    }
    let norm: NormalizedTerms;
    try {
      norm = normalizeTerms(offer);
    } catch {
      // We cannot normalize it ⇒ cannot prove the CLI cannot sign it.
      // Blind spot only while a numeric amount sits under the ceiling.
      const rec = e as Record<string, unknown>;
      const amt = rec.amount ?? rec.maxAmountRequired;
      if (
        typeof amt === "string" &&
        /^\d+$/.test(amt.trim()) &&
        BigInt(amt.trim()) <= ceiling
      ) {
        blind += 1;
      }
      continue;
    }
    if (BigInt(norm.amount) <= ceiling) signable.push({ offer, norm });
  }
  const atCap = signable.filter((s) => s.norm.amount === ceiling.toString());
  if (atCap.length === 0) {
    return { ok: false, error: "no_matching_offer" };
  }
  if (new Set(atCap.map((s) => JSON.stringify(s.norm))).size > 1) {
    return { ok: false, error: "ambiguous_offers" };
  }
  const vetted = atCap[0];
  if (blind > 0 || signable.some((s) => !sameTerms(s.norm, vetted.norm))) {
    return { ok: false, error: "unverifiable_challenge" };
  }
  return { ok: true, offer: vetted.offer };
}

/**
 * Derive the deal binding for this quote+wallet — offer + fingerprint.
 * Fingerprint failure (unknown network, bad address) yields offer-only:
 * terms-match still runs, the hold just parks without a fingerprint.
 */
export function bindDeal(quote: BuyQuote, wallet: string): DealBinding {
  const sel = selectSigningOffer(quote.raw, quote.maxAmountAtomic);
  if (!sel.ok) return { offerError: sel.error };
  try {
    return {
      offer: sel.offer,
      fingerprint: dealFingerprint({
        wallet,
        url: quote.url,
        offer: sel.offer,
      }),
    };
  } catch (e) {
    return {
      offer: sel.offer,
      offerError: `fingerprint: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
