/**
 * Fulfillment registry (SLICE-221-3, D-221-4): Map<productCode|kind,
 * handler> invoked with normalized input — never a raw Stripe session.
 *
 * Both rails converge here:
 *  - new API path: webhook confirm → CONFIRMED → dispatchFulfillment with
 *    catalog productCode; kind resolves via the commerce catalog.
 *  - legacy path: fulfillOrder adapts Stripe.Checkout.Session → the same
 *    normalized input (kind resolved from legacy productId).
 *
 * Exactly-once: dedupeKey guards handler invocation in-process (the
 * webhook claim-ledger guards deliveries before dispatch; this guards
 * the handler itself on self-heal re-confirms).
 */

import { getCommerceProduct } from "../commerce-catalog";

export interface FulfillmentInput {
  /** Catalog code (PASSPORT_BRONZE) or legacy productId (passport-bronze). */
  productCode: string;
  /** O2: email or accountId — best-effort buyer reference. */
  buyerRef?: string;
  metadata: Record<string, unknown>;
  email?: string;
  amountUsd?: string;
  /** paymentId or session.id — used in logs/notifications. */
  paymentRef?: string;
}

export type FulfillmentHandler = (input: FulfillmentInput) => Promise<void>;
export type FulfillmentNotifier = (input: FulfillmentInput) => Promise<void>;

const registry = new Map<string, FulfillmentHandler>();
const fulfilledRefs = new Set<string>();
let notifier: FulfillmentNotifier | undefined;

export function registerFulfillmentHandler(
  key: string,
  handler: FulfillmentHandler,
): void {
  registry.set(key, handler);
}

/** Post-fulfillment hook (Discord notify) — set by order-fulfillment. */
export function setFulfillmentNotifier(n: FulfillmentNotifier): void {
  notifier = n;
}

/** Test hook — clears handlers, notifier and the dedupe ledger. */
export function resetFulfillmentRegistry(): void {
  registry.clear();
  fulfilledRefs.clear();
  notifier = undefined;
}

/**
 * Resolve kind → handler → run once per dedupeKey → notify.
 * Returns false when deduped or no handler registered.
 */
export async function dispatchFulfillment(
  input: FulfillmentInput,
  opts: {
    kind?: string;
    dedupeKey?: string;
    registry?: Map<string, FulfillmentHandler>;
    notify?: FulfillmentNotifier | null;
  } = {},
): Promise<boolean> {
  const key = opts.dedupeKey;
  if (key && fulfilledRefs.has(key)) return false;

  const kind =
    opts.kind ??
    getCommerceProduct(input.productCode)?.fulfillmentKind ??
    input.productCode;
  const reg = opts.registry ?? registry;
  const handler = reg.get(kind) ?? reg.get(input.productCode);
  if (!handler) return false;

  if (key) fulfilledRefs.add(key);
  await handler(input);

  const notify = opts.notify === undefined ? notifier : opts.notify;
  await notify?.(input);
  return true;
}
