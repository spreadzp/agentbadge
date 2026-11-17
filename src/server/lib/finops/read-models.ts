/**
 * EPIC-226 / SLICE-226-2 — admin FinOps read models (D-226-5: on-demand
 * aggregation — no materialized tables at v1 volume).
 *
 * - `listPayments` — dashboard feed (filters + pagination); provider
 *   comes from the payment's CONFIRMED attempt (else latest attempt).
 * - `getPaymentDetail` — payment + attempts roll-up + receipts +
 *   events + refunds + audit trail for the detail screen.
 * - `tracePayment` — payment → product/attempt/receipt/event/usage/
 *   agreement trace ("every payment to its business operation").
 * - `finReport` — gross/net, fees, by-provider/product/network,
 *   refunds; payments counted ONCE at their terminal transition;
 *   RECORD_ONLY commerce mirrors are reported separately, never as
 *   revenue.
 */

import type { Database, PaymentAttemptRow } from "@agentbadge/database";

import {
  FINOPS_DEFAULT_PER_PAGE,
  FINOPS_MAX_PER_PAGE,
  type PaymentDetail,
  type PaymentListFilter,
  type PaymentListItem,
  type PaymentListResult,
  type PaymentTrace,
} from "./types";

/** Confirmed attempt for the payment, else the newest attempt. */
function canonicalAttempt(
  attempts: readonly PaymentAttemptRow[],
): PaymentAttemptRow | null {
  return (
    attempts.find((a) => a.status === "CONFIRMED") ?? attempts[0] ?? null
  );
}

/**
 * Resolve display labels for actor ids — actor-registry name when the
 * row exists, raw wallet/id otherwise (D-226-8: graceful degradation).
 */
export async function actorLabels(
  db: Database,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const raw of new Set(ids.filter((v): v is string => !!v))) {
    const actor = await db.identity.actors.getById(raw.toLowerCase());
    const payload = (actor?.payload ?? null) as Record<
      string,
      unknown
    > | null;
    const label =
      (typeof payload?.["name"] === "string" && payload["name"]) ||
      (typeof payload?.["displayName"] === "string" &&
        payload["displayName"]) ||
      (typeof payload?.["label"] === "string" && payload["label"]) ||
      actor?.agentId ||
      raw;
    out.set(raw, label);
  }
  return out;
}

/**
 * Dashboard feed — newest first. `provider` filters via the attempts
 * store (a payment has no provider column) applied before pagination.
 * `hasMore` is exact — the candidate set is bounded at v1 volume.
 */
export async function listPayments(
  db: Database,
  filter: PaymentListFilter = {},
): Promise<PaymentListResult> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(
    Math.max(1, filter.perPage ?? FINOPS_DEFAULT_PER_PAGE),
    FINOPS_MAX_PER_PAGE,
  );
  const payments = await db.payments.payments.list({
    status: filter.status,
    statuses: filter.statuses,
    purpose: filter.purpose,
    productId: filter.productId,
    customerId: filter.customerId,
    agentId: filter.agentId,
    sinceMs: filter.sinceMs,
    untilMs: filter.untilMs,
  });
  // Attempts grouped once — provider filter + per-item roll-up.
  const attempts = await db.payments.attempts.list(
    filter.provider !== undefined ? { provider: filter.provider } : {},
  );
  const byPayment = new Map<string, PaymentAttemptRow[]>();
  for (const a of attempts) {
    const list = byPayment.get(a.paymentId) ?? [];
    list.push(a);
    byPayment.set(a.paymentId, list);
  }
  const filtered =
    filter.provider === undefined
      ? payments
      : payments.filter((p) => byPayment.has(p.id));
  const start = (page - 1) * perPage;
  const items: PaymentListItem[] = filtered
    .slice(start, start + perPage)
    .map((p) => {
      const att = canonicalAttempt(byPayment.get(p.id) ?? []);
      return {
        id: p.id,
        reference: p.reference,
        status: p.status,
        amount: p.amount,
        currency: p.currency ?? "USD",
        purpose: p.purpose,
        customerId: p.customerId ?? null,
        agentId: p.agentId ?? null,
        productId: p.productId ?? null,
        provider: att?.provider ?? null,
        network: att?.network ?? null,
        transactionHash: att?.transactionHash ?? null,
        createdAtMs: p.createdAtMs,
      };
    });
  return {
    items,
    page,
    perPage,
    hasMore: start + items.length < filtered.length,
  };
}

/** Detail screen — full roll-up + audit trail; null when missing. */
export async function getPaymentDetail(
  db: Database,
  paymentId: string,
): Promise<PaymentDetail | null> {
  const payment = await db.payments.payments.getById(paymentId);
  if (!payment) return null;
  const [attempts, receipts, events, refunds, adminActions] =
    await Promise.all([
      db.payments.attempts.listByPayment(paymentId),
      db.payments.receipts.listByPayment(paymentId),
      db.payments.events.listByPayment(paymentId),
      db.finops.refundIntents.listByPayment(paymentId),
      db.finops.adminActions.listBySubject("payment", paymentId),
    ]);
  attempts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const att = canonicalAttempt(attempts);
  return {
    payment,
    attempts,
    receipts,
    events,
    refunds,
    adminActions,
    provider: att?.provider ?? null,
    network: att?.network ?? null,
  };
}

/**
 * Payment → business-operation trace: product, attempts, receipts,
 * events, usage records, and the linked commerce agreement/task when
 * the payment is referenced by a commerce mirror.
 */
export async function tracePayment(
  db: Database,
  paymentId: string,
): Promise<PaymentTrace | null> {
  const detail = await getPaymentDetail(db, paymentId);
  if (!detail) return null;
  const { payment } = detail;
  const [product, usageRecords, commerceMirrors] = await Promise.all([
    payment.productId
      ? db.payments.products.getById(payment.productId)
      : Promise.resolve(null),
    db.payments.usageRecords.listByPayment(paymentId),
    // RECORD_ONLY mirrors link to real payments via `paymentId`.
    db.commerce.payments.list({}),
  ]);
  const mirror =
    commerceMirrors.find((c) => c.paymentId === payment.id) ?? null;
  let taskId: string | null = null;
  if (mirror?.agreementId) {
    const agreement = await db.commerce.agreements.getById(
      mirror.agreementId,
    );
    taskId = agreement?.taskId ?? null;
  }
  return {
    payment,
    product: product
      ? { id: product.id, code: product.code, name: product.name }
      : null,
    attempts: detail.attempts,
    receipts: detail.receipts,
    events: detail.events,
    usageRecords,
    related: {
      taskId,
      agreementId: mirror?.agreementId ?? null,
      orderId: payment.orderId ?? null,
    },
  };
}

/**
 * Confirmed attempt for the payment, else the newest attempt —
 * exported for the reports module's provider attribution.
 */
export { canonicalAttempt };
