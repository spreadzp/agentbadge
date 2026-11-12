/**
 * Legacy Stripe checkout metadata whitelist — extracted from
 * `routes/payment.ts` (file-size lint cap).
 */

/** H-1: keys that must always come from server config — never from
 *  client metadata (paymentId would divert the webhook onto the new
 *  payments path; tier/productId control fulfillment). */
const RESERVED_METADATA_KEYS = new Set([
  "paymentId",
  "productId",
  "productCode",
  "tier",
]);

export function clientSafeMetadata(
  metadata: Record<string, string> | undefined,
): Record<string, string> {
  if (!metadata || typeof metadata !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (RESERVED_METADATA_KEYS.has(k)) continue;
    if (typeof v === "string") out[k] = v;
  }
  return out;
}
