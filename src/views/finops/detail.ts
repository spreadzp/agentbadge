/**
 * SLICE-226-3 — payment detail + trace page.
 * Manual actions post via HTMX and land in a result slot;
 * non-HTMX clients get JSON from the same endpoints.
 */

import { html } from "hono/html";

import type {
  PaymentDetail,
  PaymentTrace,
} from "../../server/lib/finops/types";
import {
  emptyMsg,
  field,
  finopsShell,
  fmtMs,
  kv,
  resultSlot,
  statusPill,
  submitBtn,
  tableShell,
  td,
} from "./shared";

const RESULT = "finops-detail-result";

/** Summary card — payment facts + canonical attempt linkage. */
const summaryCard = (d: PaymentDetail) => html`
  <div class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
    <div class="mb-2 flex items-center gap-3">
      <span class="font-mono text-lg text-emerald-400"
        >${d.payment.reference}</span
      >
      ${statusPill(d.payment.status)}
      <span class="text-sm text-slate-400"
        >${d.payment.amount} ${d.payment.currency ?? "USD"}</span
      >
    </div>
    <div class="grid gap-1 sm:grid-cols-2">
      ${kv("paymentId", d.payment.id)}
      ${kv("provider", d.provider)}
      ${kv("network", d.network)}
      ${kv("purpose", d.payment.purpose)}
      ${kv("productId", d.payment.productId)}
      ${kv("customerId", d.payment.customerId)}
      ${kv("agentId", d.payment.agentId)}
      ${kv("orderId", d.payment.orderId)}
      ${kv("created", fmtMs(d.payment.createdAtMs))}
      ${kv("updated", fmtMs(d.payment.updatedAtMs))}
    </div>
  </div>
`;

/** Manual action forms — actor is the credential (SLICE-264-7), no
 *  self-declared operator input anymore. */
const actionsCard = (paymentId: string) => html`
  <div class="mb-4 grid gap-3 lg:grid-cols-3">
    <form
      hx-post="/admin/finance/payments/${paymentId}/review"
      hx-target="#${RESULT}"
      hx-swap="innerHTML"
      class="rounded-lg border border-slate-800 bg-slate-900 p-3"
    >
      <div class="mb-2 text-xs font-semibold text-slate-300">
        Mark reviewed
      </div>
      ${field("evidence", "Evidence (JSON, ≤4KB)", {
  placeholder: '{"note":"ok"}',
})}
      <div class="mt-2">${submitBtn("Review")}</div>
    </form>
    <form
      hx-post="/admin/finance/payments/${paymentId}/retry-verification"
      hx-target="#${RESULT}"
      hx-swap="innerHTML"
      class="rounded-lg border border-slate-800 bg-slate-900 p-3"
    >
      <div class="mb-2 text-xs font-semibold text-slate-300">
        Retry verification
      </div>
      <div class="mt-2">${submitBtn("Retry")}</div>
    </form>
    <form
      hx-post="/admin/finance/payments/${paymentId}/refund"
      hx-target="#${RESULT}"
      hx-swap="innerHTML"
      class="rounded-lg border border-slate-800 bg-slate-900 p-3"
    >
      <div class="mb-2 text-xs font-semibold text-slate-300">
        Refund
      </div>
      <label class="block text-xs text-slate-500"
        >Mode
        <select
          name="mode"
          class="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200"
        >
          <option value="stripe">Stripe (auto)</option>
          <option value="intent">Manual intent</option>
        </select>
      </label>
      ${field("reason", "Reason", { required: true })}
      ${field("payee", "Payee wallet (intent only)", {
  placeholder: "0x…",
})}
      ${field("amount", "Amount (intent only)", {
  placeholder: "10.00",
})}
      ${field("evidence", "Evidence (JSON, ≤4KB)")}
      <div class="mt-2">${submitBtn("Refund")}</div>
    </form>
  </div>
  ${resultSlot(RESULT)}
`;

const attemptsTable = (d: PaymentDetail) => {
  if (d.attempts.length === 0) return emptyMsg("No attempts.");
  return tableShell(
    ["Provider", "Status", "Tx", "Network", "Amount", "Created"],
    d.attempts.map(
      (a) => html`<tr>
        ${td(a.provider)}
        ${td(statusPill(a.status), false)}
        ${td(a.transactionHash ?? "—")}
        ${td(a.network ?? "—")}
        ${td(a.amount)}
        ${td(a.createdAt)}
      </tr>`,
    ),
  );
};

const eventsList = (d: PaymentDetail) => {
  if (d.events.length === 0) return emptyMsg("No events.");
  return tableShell(
    ["Entity", "Transition", "Actor", "At"],
    d.events.map(
      (e) => html`<tr>
        ${td(e.entity)}
        ${td(`${e.from} → ${e.to}`)}
        ${td(e.actor)}
        ${td(fmtMs(e.atMs))}
      </tr>`,
    ),
  );
};

const refundsTable = (d: PaymentDetail) => {
  if (d.refunds.length === 0) return emptyMsg("No refund intents.");
  return tableShell(
    ["Intent", "Status", "Amount", "Payee", "Tx", "Operator"],
    d.refunds.map(
      (r) => html`<tr>
        ${td(r.id)}
        ${td(statusPill(r.status), false)}
        ${td(r.amount)}
        ${td(r.payee)}
        ${td(r.txHash ?? "—")}
        ${td(r.operator)}
      </tr>`,
    ),
  );
};

const auditTable = (d: PaymentDetail) => {
  if (d.adminActions.length === 0) return emptyMsg("No admin actions.");
  return tableShell(
    ["Action", "Operator", "At"],
    d.adminActions.map(
      (a) => html`<tr>
        ${td(a.action)}${td(a.principalId ?? a.operator)}${td(a.createdAt)}
      </tr>`,
    ),
  );
};

const traceCard = (t: PaymentTrace | null) => {
  if (!t) return "";
  return html`<div class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
    <div class="mb-2 text-xs font-semibold text-slate-300">Trace</div>
    <div class="grid gap-1 sm:grid-cols-2">
      ${kv("product", t.product ? `${t.product.code} — ${t.product.name}` : null)}
      ${kv("taskId", t.related.taskId)}
      ${kv("agreementId", t.related.agreementId)}
      ${kv("orderId", t.related.orderId)}
      ${kv("usage records", t.usageRecords.length)}
      ${kv("receipts", t.receipts.length)}
    </div>
  </div>`;
};

const section = (title: string, body: unknown) => html`
  <div class="mb-4">
    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
      ${title}
    </div>
    ${body}
  </div>
`;

export const paymentDetailPage = (
  d: PaymentDetail,
  trace: PaymentTrace | null,
) =>
  finopsShell(
    "payments",
    html`
      ${summaryCard(d)} ${actionsCard(d.payment.id)} ${traceCard(trace)}
      ${section("Attempts", attemptsTable(d))}
      ${section("Refund intents", refundsTable(d))}
      ${section("Admin actions", auditTable(d))}
      ${section("Events", eventsList(d))}
    `,
  );
