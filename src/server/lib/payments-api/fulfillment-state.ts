/**
 * Durable fulfillment-claim state (222-7 audit fixes, extracted to keep
 * fulfillment.ts under the 300-line limit).
 *
 * The payment event log carries FULFILLMENT markers:
 *   claimed → done | unresolved | failed | reclaim
 * Deterministic event ids make `events.append` an atomic cross-instance
 * CAS: a second writer with the same id gets null back.
 */

import {
  getCommerceProduct,
  productCodeForLegacyId,
} from "../commerce-catalog";
import type { FulfillmentEventStore } from "./fulfillment";

export const FULFILLMENT_ENTITY = "FULFILLMENT";
export const FULFILLMENT_ACTOR = "fulfillment-registry";
/** A claimed-without-done marker older than this is a crashed run → retry. */
export const CLAIM_STALE_MS = 10 * 60 * 1000;

export const claimEventId = (paymentId: string) =>
  `fulfill-claim-${paymentId}`;
export const doneEventId = (paymentId: string) =>
  `fulfill-done-${paymentId}`;
/** H-9: deterministic CAS marker — first worker to reclaim a stale
 *  claim wins; concurrent reclaimers dedupe to a single runner. */
export const reclaimEventId = (paymentId: string) =>
  `fulfill-reclaim-${paymentId}`;
/** C-1: deterministic marker for a needs-ops outcome — dedupes,
 *  discoverable by sweeps, and intentionally NOT `done`. */
export const unresolvedEventId = (paymentId: string) =>
  `fulfill-unresolved-${paymentId}`;

/** kind resolution: canonical productCode first, then the legacy kebab
 *  productId mapping (fulfillment.ts nit — legacy ids like
 *  "passport-bronze" resolve to their fulfillmentKind too). */
export function resolveKind(
  input: { productCode: string },
  explicit?: string,
): string {
  if (explicit) return explicit;
  const product =
    getCommerceProduct(input.productCode) ??
    getCommerceProduct(productCodeForLegacyId(input.productCode) ?? "");
  return product?.fulfillmentKind ?? input.productCode;
}

export type DurableState = "done" | "claimed-fresh" | "stale-claim" | "none";

export async function durableState(
  events: FulfillmentEventStore,
  paymentId: string,
  nowMs: number,
): Promise<DurableState> {
  const rows = await events.listByPayment(paymentId);
  let hasClaim = false;
  let hasStaleClaim = false;
  for (const e of rows) {
    if (e.entity !== FULFILLMENT_ENTITY) continue;
    if (e.to === "done") return "done";
    if (e.to === "claimed") {
      if (e.atMs > nowMs - CLAIM_STALE_MS) hasClaim = true;
      else hasStaleClaim = true;
    }
  }
  if (hasClaim) return "claimed-fresh";
  if (hasStaleClaim) return "stale-claim";
  return "none";
}

export function newMarkerId(prefix: string): string {
  return `${prefix}_${globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}
