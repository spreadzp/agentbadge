/**
 * offer-and-receipt extension detection (SLICE-258-9, AB-190).
 *
 * specs/extensions/extension-offer-and-receipt.md: a resource server
 * declares signed offers in the payment-requirements response via
 * `extensions["offer-receipt"].info.offers[]` — each offer
 * {format: "eip712"|"jws", payload?, signature, acceptIndex?}.
 * Signed receipts are returned post-payment only, so the offer side is
 * what a payment-free scanner can observe.
 *
 * Presence-detection only (D-258-Q15, C9): we record that the extension
 * is declared and count well-formed offers. Signatures are NOT
 * verified, and the signer↔domain key binding (did:web) is not
 * evaluated — the checker's detail carries both as `not_implemented`.
 */

/** Summary of a declared `offer-receipt` extension — presence only. */
export interface OfferReceiptSummary {
  /** `extensions["offer-receipt"]` key is present in the payload. */
  declared: boolean;
  /** Well-formed offers seen (format + signature present). */
  offers: number;
  /** Unique `format` values across well-formed offers. */
  formats: string[];
  /** Key present but offers[] unusable or partially malformed. */
  malformed?: boolean;
}

const OFFER_FORMATS = new Set(["eip712", "jws"]);

/**
 * Evaluate `extensions["offer-receipt"]` on an already-decoded doc —
 * usable on a live payment-requirements payload or on the x402
 * well-known manifest. Returns null when the extension is not declared.
 */
export function offerReceiptExtensionOf(doc: unknown): OfferReceiptSummary | null {
  if (typeof doc !== "object" || doc === null) return null;
  const extensions = (doc as Record<string, unknown>).extensions;
  if (typeof extensions !== "object" || extensions === null) return null;
  const ext = (extensions as Record<string, unknown>)["offer-receipt"];
  if (ext === undefined) return null;
  if (typeof ext !== "object" || ext === null) {
    return { declared: true, offers: 0, formats: [], malformed: true };
  }
  const info = (ext as Record<string, unknown>).info;
  const offers =
    typeof info === "object" && info !== null
      ? (info as Record<string, unknown>).offers
      : undefined;
  if (!Array.isArray(offers) || offers.length === 0) {
    return { declared: true, offers: 0, formats: [], malformed: true };
  }
  const formats = new Set<string>();
  let good = 0;
  for (const o of offers) {
    if (typeof o !== "object" || o === null) continue;
    const format = (o as Record<string, unknown>).format;
    const signature = (o as Record<string, unknown>).signature;
    if (typeof format === "string" && OFFER_FORMATS.has(format) && typeof signature === "string" && signature) {
      good += 1;
      formats.add(format);
    }
  }
  return {
    declared: true,
    offers: good,
    formats: [...formats],
    ...(good < offers.length ? { malformed: true } : {}),
  };
}

function decodeB64Json(b64: string): unknown | null {
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
  } catch {
    return null;
  }
}

/**
 * Candidate payment-requirements docs from a 402 response, in
 * precedence order: `payment-required` header (base64 JSON) →
 * `www-authenticate` `request="<b64>"` → JSON body.
 */
export function* paymentPayloadDocs(
  headers: Record<string, string>,
  bodyText: string | null,
): Generator<unknown> {
  const pr = headers["payment-required"];
  if (pr) yield decodeB64Json(pr);
  const wwwAuth = headers["www-authenticate"];
  const m = wwwAuth?.match(/request="([^"]+)"/);
  if (m) yield decodeB64Json(m[1]);
  if (bodyText) {
    try {
      yield JSON.parse(bodyText);
    } catch {
      /* body not JSON */
    }
  }
}

/**
 * Extract the offer-and-receipt summary from a 402 response — same
 * decode chain as acceptsFromPaymentPayload.
 */
export function offerReceiptFromPaymentPayload(
  headers: Record<string, string>,
  bodyText: string | null,
): OfferReceiptSummary | null {
  for (const doc of paymentPayloadDocs(headers, bodyText)) {
    const found = offerReceiptExtensionOf(doc);
    if (found) return found;
  }
  return null;
}
