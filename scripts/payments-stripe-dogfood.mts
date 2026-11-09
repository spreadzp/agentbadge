/**
 * SLICE-220-10: Stripe test-mode live dogfood for @agentbadge/payments.
 *
 * Runs the REAL lifecycle against Stripe test mode (sk_test_*):
 *   createPayment → hosted Checkout Session → (pay 4242 4242 4242 4242)
 *   → verifyPayment (sessions.retrieve) → 9 checks → CONFIRMED + receipt
 *   → refundPayment → REFUNDED (+ edge cases: dedupe, re-confirm, re-refund)
 *
 * No webhooks — confirmation pulls evidence via verifyPayment, as designed.
 * In-memory stores: the whole run lives in ONE process; a JSON transcript
 * (whitelist fields only, test-mode ids are safe to publish) lands in
 * docs/EPICS/220-payment-infrastructure-foundation/evidence/.
 *
 * Env (loaded by bun from hackathon/server/.env):
 *   STRIPE_SECRET_KEY=sk_test_…   REQUIRED, must start with sk_test_
 *   PUBLIC_BASE_URL               checkout success/cancel redirect target
 *
 * Usage:
 *   bun scripts/payments-stripe-dogfood.mts
 *   bun scripts/payments-stripe-dogfood.mts --amount=1.00 --wait=600
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";

import { PaymentService } from "../../../packages/payments/src/service.ts";
import { PaymentProviderRegistry } from "../../../packages/payments/src/registry.ts";
import {
  StripePaymentProvider,
  type StripeLikeClient,
  type StripeSessionLike,
} from "../../../packages/payments/src/stripe-provider.ts";
import { createInMemoryPaymentStores } from "../../../packages/payments/src/memory-stores.ts";

// ---------------------------------------------------------------------------
// Args / env
// ---------------------------------------------------------------------------

const args = new Map(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const eq = a.indexOf("=");
      return eq === -1
        ? [a.slice(2), "true"]
        : [a.slice(2, eq), a.slice(eq + 1)];
    }),
);

const AMOUNT = args.get("amount") ?? "1.00";
const WAIT_SECONDS_RAW = Number(args.get("wait") ?? "600");
const WAIT_SECONDS =
  Number.isFinite(WAIT_SECONDS_RAW) && WAIT_SECONDS_RAW > 0
    ? WAIT_SECONDS_RAW
    : 600;

const SECRET = process.env.STRIPE_SECRET_KEY ?? "";
if (!SECRET.startsWith("sk_test_")) {
  console.error(
    "FATAL: STRIPE_SECRET_KEY must be a test-mode key (sk_test_*). " +
      "Refusing to run against anything else.",
  );
  process.exit(1);
}
const BASE_URL = process.env.PUBLIC_BASE_URL ?? "http://localhost:4021";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = resolve(
  HERE,
  "../../../docs/EPICS/220-payment-infrastructure-foundation/evidence",
);
const RUN_ID = `dogfood-${Date.now()}`;
const TRANSCRIPT_PATH = resolve(EVIDENCE_DIR, `stripe-${RUN_ID}.json`);

// ---------------------------------------------------------------------------
// Transcript — whitelist fields only; no keys, no headers, no secrets.
// ---------------------------------------------------------------------------

const transcript: Record<string, unknown>[] = [];
function log(step: string, data: Record<string, unknown>) {
  const row = { step, at: new Date().toISOString(), ...data };
  transcript.push(row);
  console.log(`[${row.at}] ${step}`, JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Wiring — the real Stripe SDK client satisfies StripeLikeClient
// structurally (D-220: the SDK never enters the pure package).
// ---------------------------------------------------------------------------

const stripe = new Stripe(SECRET, {
  apiVersion: "2025-06-30.basil" as Stripe.LatestApiVersion,
});

// Thin adapter: the SDK's `payment_intent` is `string | PaymentIntent` —
// normalize to the string id our StripeSessionLike expects.
function session(s: Stripe.Checkout.Session): StripeSessionLike {
  return {
    ...s,
    payment_intent:
      typeof s.payment_intent === "string"
        ? s.payment_intent
        : (s.payment_intent?.id ?? null),
  };
}
const stripeLike: StripeLikeClient = {
  checkout: {
    sessions: {
      create: async (p, o) =>
        session(await stripe.checkout.sessions.create(p, o)),
      retrieve: async (id) =>
        session(await stripe.checkout.sessions.retrieve(id)),
    },
  },
  refunds: {
    create: async (p, o) => stripe.refunds.create(p, o),
  },
};

const stores = createInMemoryPaymentStores();
const providers = new PaymentProviderRegistry();
providers.register(
  new StripePaymentProvider({
    client: stripeLike,
    successUrl: `${BASE_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${BASE_URL}/payment/cancel`,
  }),
);
const service = new PaymentService({
  stores,
  providers,
  newId: (p) => `${p}_${randomUUID()}`,
});

const REFERENCE = `${RUN_ID}-${randomUUID().slice(0, 8)}`;

// ---------------------------------------------------------------------------
// 1. createPayment → hosted Checkout Session on the real test-mode rail
// ---------------------------------------------------------------------------

// NOTE: no `network` on fiat rails — Stripe evidence carries no network tag,
// a network expectation would fail check 8 (network_match) → DISPUTED on
// captured funds. network is for onchain rails (eip155:*).
const created = await service.createPayment({
  reference: REFERENCE,
  amount: AMOUNT,
  currency: "USD",
  purpose: "CUSTOM",
  provider: "STRIPE",
  payer: "dogfood@agentbadge.xyz",
  metadata: { productName: "EPIC-220 dogfood (test mode)", slice: "220-10" },
});
// createPayment always returns payment+attempt rows — a rail failure is
// reported via `error`, not a missing row.
if (created.error) {
  console.error("FATAL: rail submission failed:", created.error);
  process.exit(1);
}

const checkoutUrl =
  (created.providerMetadata?.checkoutUrl as string | null | undefined) ??
  null;
log("create", {
  paymentId: created.payment.id,
  paymentStatus: created.payment.status,
  attemptId: created.attempt.id,
  attemptStatus: created.attempt.status,
  providerReference: created.attempt.providerReference ?? null,
  checkoutUrl,
});
if (!checkoutUrl) {
  console.error("FATAL: no checkout URL on the attempt metadata");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Edge — duplicate create: same reference + same fingerprint → deduped
// ---------------------------------------------------------------------------

const dupe = await service.createPayment({
  reference: REFERENCE,
  amount: AMOUNT,
  currency: "USD",
  purpose: "CUSTOM",
  provider: "STRIPE",
  payer: "dogfood@agentbadge.xyz",
  metadata: { productName: "EPIC-220 dogfood (test mode)", slice: "220-10" },
});
log("edge-dedupe", {
  deduped: dupe.deduped === true,
  samePaymentId: dupe.payment?.id === created.payment.id,
});

// Edge — capability guard (H-1, post-audit): a `network` expectation on
// a fiat rail must be REJECTED before any row/dedupe, not verified to
// DISPUTED after capture (the first dogfood run's live bug).
let guardRejected = false;
try {
  await service.createPayment({
    reference: `${REFERENCE}-guard`,
    amount: AMOUNT,
    currency: "USD",
    purpose: "CUSTOM",
    provider: "STRIPE",
    network: "stripe-testmode",
  });
} catch (err) {
  guardRejected = err instanceof Error && /no network/.test(err.message);
}
log("edge-fiat-network-guard", { guardRejected });

const conflict = await service.createPayment({
  reference: REFERENCE,
  amount: "2.00", // different fingerprint — must NOT silently dedupe
  currency: "USD",
  purpose: "CUSTOM",
  provider: "STRIPE",
});
log("edge-fingerprint-conflict", {
  deduped: conflict.deduped, // false — fingerprint mismatch is NOT a retry
  conflict: conflict.conflict ?? null, // message present on mismatch
  error: conflict.error ?? null,
});

// ---------------------------------------------------------------------------
// 3. Wait for the buyer to pay the hosted checkout, then confirm
// ---------------------------------------------------------------------------

console.log("\n=== PAY NOW ===");
console.log(checkoutUrl);
console.log(`Card: 4242 4242 4242 4242, any future expiry, any CVC/ZIP.`);
console.log(`Waiting up to ${WAIT_SECONDS}s for the session to settle…\n`);

let confirmed: Awaited<ReturnType<typeof service.confirmPayment>> | null = null;
const deadline = Date.now() + WAIT_SECONDS * 1000;
try {
  while (Date.now() < deadline) {
    const res = await service.confirmPayment({ attemptId: created.attempt.id });
    if (res.status !== "PENDING") {
      confirmed = res;
      break;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
} catch (err) {
  // A transient rail error must not lose the evidence file.
  log("confirm-error", { error: err instanceof Error ? err.message : String(err) });
  writeTranscript("aborted");
  throw err;
}
if (!confirmed || confirmed.status !== "CONFIRMED") {
  console.error(
    "FATAL: payment not confirmed within the window:",
    confirmed?.status ?? "timeout",
  );
  writeTranscript("aborted");
  process.exit(1);
}
log("confirm", {
  status: confirmed.status,
  deduped: confirmed.deduped === true,
});

const paymentAfter = await service.getPayment(created.payment.id);
const attemptsAfter = await service.listAttempts(created.payment.id);
const receipts = await stores.receipts.listByPayment(created.payment.id);
log("state", {
  paymentStatus: paymentAfter?.status,
  attemptStatus: attemptsAfter[0]?.status,
  receipts: receipts.length,
  receiptExternalRef: receipts[0]?.externalReference ?? null,
  receiptTxHash: receipts[0]?.transactionHash ?? null, // Stripe payment_intent id
});

// ---------------------------------------------------------------------------
// 4. Edge — repeat confirm must not double-fulfill
// ---------------------------------------------------------------------------

const reconfirm = await service.confirmPayment({
  attemptId: created.attempt.id,
});
const receiptsAfterReconfirm = await stores.receipts.listByPayment(
  created.payment.id,
);
log("edge-reconfirm", {
  status: reconfirm.status,
  deduped: reconfirm.deduped === true,
  receipts: receiptsAfterReconfirm.length,
});

// ---------------------------------------------------------------------------
// 5. refundPayment — claim-first, deterministic idempotency key
// ---------------------------------------------------------------------------

const refunded = await service.refundPayment(created.payment.id);
log("refund", { status: refunded.status, refundReference: refunded.refundReference ?? null });

// Exactly-once proof: a sequential re-refund short-circuits on REFUNDED,
// and two CONCURRENT refunds share one deterministic rail key — the rail
// dedupes them. Either way exactly one refund exists on the PaymentIntent.
const rerefund = await service.refundPayment(created.payment.id);
const [concurrentA, concurrentB] = await Promise.all([
  service.refundPayment(created.payment.id),
  service.refundPayment(created.payment.id),
]);
const pi = receipts[0]?.transactionHash;
let railRefundCount: number | null = null;
if (pi) {
  const list = await stripe.refunds.list({ payment_intent: pi, limit: 10 });
  railRefundCount = list.data.length;
}
log("edge-rerefund", {
  status: rerefund.status, // REFUNDED — short-circuit on the terminal state
  concurrent: [concurrentA.status, concurrentB.status],
  railRefundCount, // expect 1 — no second rail charge
});

const final = await service.getPayment(created.payment.id);
log("final", { paymentStatus: final?.status });

writeTranscript("complete");
console.log(`\nTranscript: ${TRANSCRIPT_PATH}`);

function writeTranscript(result: string) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    TRANSCRIPT_PATH,
    JSON.stringify(
      {
        run: RUN_ID,
        reference: REFERENCE,
        rail: "stripe-testmode",
        amount: AMOUNT,
        result,
        steps: transcript,
      },
      null,
      2,
    ),
  );
}
