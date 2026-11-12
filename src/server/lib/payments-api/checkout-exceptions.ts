/**
 * SLICE-222-4 — checkout → exceptions store read helper (extracted
 * from checkout.ts, file-size lint cap).
 *
 * `null` when the persistence backend predates the exceptions port
 * (in-memory test stores built before 222-4, old npm database pkg).
 */
import type {
  PaymentServiceStores,
  PaymentExceptionKind,
  PaymentExceptionStatus,
} from "@agentbadge/payments";

export interface ListExceptionsOpts {
  status?: PaymentExceptionStatus | (string & {});
  kind?: PaymentExceptionKind | (string & {});
  sinceMs?: number;
  limit?: number;
}

export async function listPaymentExceptions(
  stores: PaymentServiceStores,
  opts: ListExceptionsOpts = {},
) {
  const store = stores.exceptions;
  if (!store) return null;
  return store.list({
    ...(opts.status !== undefined
      ? { status: opts.status as PaymentExceptionStatus }
      : {}),
    ...(opts.kind !== undefined
      ? { kind: opts.kind as PaymentExceptionKind }
      : {}),
    ...(opts.sinceMs !== undefined ? { sinceMs: opts.sinceMs } : {}),
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
  });
}
