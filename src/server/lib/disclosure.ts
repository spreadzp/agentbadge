/**
 * SLICE-181-4: disclosure fields for unilateral platform decisions.
 *
 * When a response carries a decision the requester did not control
 * (e.g. an evaluator rejecting a venue job deliverable), the body MUST
 * disclose who decided, on what basis, and how to appeal. This is the
 * transparency counterpart of the no-charge-on-refusal contract.
 *
 * Appeal target: /contact fallback (O3 — a dedicated dispute endpoint may
 * replace it later; the field name is the contract, not the URL).
 */

export interface DisclosureOpts {
  /** Who made the decision: "platform" | "evaluator" | "moderator". */
  decidedBy: string;
  /** How to appeal — route path, mailto: or URL. */
  appeal: string;
  /** Short machine-readable basis for the decision. */
  basis: string;
}

export interface DisclosureField {
  decided_by: string;
  appeal: string;
  basis: string;
}

export const DISCLOSURE_APPEAL_FALLBACK = "/contact";

/**
 * Returns `body` plus a `disclosure` field describing the unilateral
 * decision it carries. Pure: does not mutate the input object.
 */
export function withDisclosure<T extends Record<string, unknown>>(
  body: T,
  opts: DisclosureOpts,
): T & { disclosure: DisclosureField } {
  return {
    ...body,
    disclosure: {
      decided_by: opts.decidedBy,
      appeal: opts.appeal,
      basis: opts.basis,
    },
  };
}

/**
 * Compact form for `BuiltAction.extra` — returns `{ disclosure: {...} }`
 * ready to spread into a route response.
 */
export function disclosureExtra(
  decidedBy: string,
  basis: string,
  appeal = DISCLOSURE_APPEAL_FALLBACK,
): { disclosure: DisclosureField } {
  return {
    disclosure: { decided_by: decidedBy, appeal, basis },
  };
}
