/**
 * EPIC-233 (SLICE-233-4, O1 finalized): webhook signature scheme —
 *   X-AgentBadge-Signature: t=<unix-seconds>,v1=<hmac-sha256-hex>
 * computed over `<t>.<raw-body>` with the platform key
 * (WEBHOOK_SIGNING_SECRET). Timestamped payload binds the signature to
 * a delivery instant so replays outside the tolerance window fail at
 * the receiver. `verifyWebhookSignature` is the receiver-side check —
 * shipped for tests and for consumers verifying deliveries.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "X-AgentBadge-Signature";
export const REQUEST_ID_HEADER = "X-AgentBadge-Request-Id";
export const DELIVERY_ID_HEADER = "X-AgentBadge-Delivery-Id";
export const SIGNATURE_TOLERANCE_SEC = 300;

export function signWebhookBody(
  secret: string,
  tsSec: number,
  body: string,
): string {
  const v1 = createHmac("sha256", secret)
    .update(`${tsSec}.${body}`)
    .digest("hex");
  return `t=${tsSec},v1=${v1}`;
}

export function verifyWebhookSignature(
  secret: string,
  header: string,
  body: string,
  nowSec: number,
  toleranceSec = SIGNATURE_TOLERANCE_SEC,
): boolean {
  const parts = new Map(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i), kv.slice(i + 1)] as const;
    }),
  );
  const t = parts.get("t");
  const v1 = parts.get("v1");
  if (!t || !v1) return false;
  const tsSec = Number(t);
  if (!Number.isFinite(tsSec) || Math.abs(nowSec - tsSec) > toleranceSec) {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(`${tsSec}.${body}`)
    .digest();
  const got = Buffer.from(v1, "hex");
  return expected.length === got.length && timingSafeEqual(expected, got);
}
