/**
 * Fulfillment input normalization (extracted from checkout.ts,
 * file-size lint cap).
 *
 * Builds the FulfillmentInput a post-confirmation fulfillment
 * handler expects from a persisted payment row: product binding,
 * buyer ref, catalog-tier (server-side — never client metadata),
 * amount, payment ref.
 */
import type { PaymentServiceStores } from "@agentbadge/payments";
import { getCommerceProduct } from "../commerce-catalog";
import type { FulfillmentInput } from "./fulfillment";

export async function buildFulfillmentInput(
  stores: PaymentServiceStores,
  paymentId: string,
): Promise<FulfillmentInput | null> {
  const row = await stores.payments.getById(paymentId);
  if (!row) return null;
  const payload =
    typeof row.payload === "object" && row.payload !== null
      ? (row.payload as {
          productCode?: unknown;
          metadata?: unknown;
        })
      : {};
  const product = getCommerceProduct(
    typeof payload.productCode === "string"
      ? payload.productCode
      : (row.productId ?? ""),
  );
  return {
    productCode:
      typeof payload.productCode === "string"
        ? payload.productCode
        : (row.productId ?? "unknown"),
    buyerRef: row.customerId ?? row.agentId ?? undefined,
    metadata: {
      // Server-side binding: `tier` comes from the catalog product,
      // never from client metadata (passport-mint handlers require it).
      ...(typeof payload.metadata === "object" &&
      payload.metadata !== null
        ? (payload.metadata as Record<string, unknown>)
        : {}),
      ...(product?.tier ? { tier: product.tier } : {}),
    },
    amountUsd: row.amount,
    paymentRef: row.id,
  };
}
