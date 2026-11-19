/**
 * SLICE-226-3 — admin FinOps mutations behind adminAuth.
 *
 *   POST /admin/finance/payments/:id/review            {operator, evidence?}
 *   POST /admin/finance/payments/:id/retry-verification {operator, evidence?}
 *   POST /admin/finance/payments/:id/refund
 *        {operator, reason, mode: stripe|intent, payee?, amount?, evidence?}
 * Refund completion + exception ops live in finops-ops.ts.
 * All effects flow through lib/finops domain services — operator is
 * mandatory and every action is audited.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { getDatabase } from "../../lib/database";
import { getStripeClient, isStripeConfigured } from "../../lib/stripe-client";
import {
  createRefundIntent,
  fail,
  markExternalReviewed,
  resolveStripeRefund,
  retryVerification,
  reviewPayment,
  stripeRefund,
} from "../../lib/finops/index";
import type { StripeRefundClient } from "../../lib/finops/types";
import { adminAuth } from "../../middleware/adminAuth";
import type { FinopsRouteDeps } from "./helpers";
import { parseEvidence, readBody, respond } from "./helpers";

const TAG = { tags: ["Admin FinOps"] };

export function createFinopsActionRoutes(
  deps: FinopsRouteDeps = {},
): Hono {
  const routes = new Hono();
  const getDb = deps.getDb ?? getDatabase;
  const stripe: StripeRefundClient | null =
    deps.stripeClient !== undefined
      ? deps.stripeClient
      : isStripeConfigured()
        ? (getStripeClient() as unknown as StripeRefundClient)
        : null;

  routes.post(
    "/admin/finance/payments/:id/review",
    describeRoute({
      ...TAG,
      summary: "Mark payment reviewed",
      responses: {
        200: { description: "AdminAction recorded" },
        400: { description: "Missing operator / oversized evidence" },
        401: { description: "Unauthorized" },
        404: { description: "Payment not found" },
      },
    }),
    adminAuth,
    async (c) => {
      const b = await readBody(c);
      const res = await reviewPayment(
        getDb(),
        c.req.param("id"),
        typeof b.operator === "string" ? b.operator : "",
        parseEvidence(b.evidence),
      );
      return respond(c, res);
    },
  );

  routes.post(
    "/admin/finance/payments/:id/retry-verification",
    describeRoute({
      ...TAG,
      summary: "Record a verification retry for the payment's open attempts",
      responses: {
        200: { description: "AdminAction + retryable attempts" },
        400: { description: "Missing operator" },
        401: { description: "Unauthorized" },
        404: { description: "Payment not found" },
      },
    }),
    adminAuth,
    async (c) => {
      const b = await readBody(c);
      const res = await retryVerification(
        getDb(),
        c.req.param("id"),
        typeof b.operator === "string" ? b.operator : "",
        parseEvidence(b.evidence),
      );
      return respond(c, res);
    },
  );

  routes.post(
    "/admin/finance/payments/:id/review-external",
    describeRoute({
      ...TAG,
      summary: "Mark an external/off-chain subject reviewed (evidence required)",
      responses: {
        200: { description: "AdminAction recorded" },
        400: { description: "Missing operator/evidence/subject" },
        401: { description: "Unauthorized" },
      },
    }),
    adminAuth,
    async (c) => {
      const b = await readBody(c);
      // L-11: the path id IS the subject — an audit row attributed to
      // a body-supplied subject while the form posted to another id
      // would mislabel the trail.
      const res = await markExternalReviewed(
        getDb(),
        "payment",
        c.req.param("id"),
        typeof b.operator === "string" ? b.operator : "",
        parseEvidence(b.evidence) ?? b.evidence,
      );
      return respond(c, res);
    },
  );

  routes.post(
    "/admin/finance/payments/:id/refund",
    describeRoute({
      ...TAG,
      summary:
        "Refund a payment — Stripe auto (provider call) or manual intent",
      responses: {
        200: { description: "Stripe refund id or RefundIntent" },
        400: { description: "Missing operator/reason/amount" },
        401: { description: "Unauthorized" },
        404: { description: "Payment not found" },
        409: { description: "Payment not CONFIRMED" },
        503: { description: "Stripe/refund path not configured" },
      },
    }),
    adminAuth,
    async (c) => {
      const b = await readBody(c);
      const operator =
        typeof b.operator === "string" ? b.operator : "";
      const modeRaw = typeof b.mode === "string" ? b.mode : "intent";
      if (modeRaw !== "stripe" && modeRaw !== "intent") {
        return respond(
          c,
          fail("BAD_INPUT", "mode must be stripe|intent"),
        );
      }
      if (modeRaw === "stripe") {
        // H3: Stripe refunds are always full-amount — a caller-supplied
        // amount/payee is silently ignored today; reject instead.
        if (
          (typeof b.amount === "string" && b.amount.trim() !== "") ||
          (typeof b.payee === "string" && b.payee.trim() !== "")
        ) {
          return respond(
            c,
            fail(
              "BAD_INPUT",
              "stripe refunds are full-amount — amount/payee are not accepted",
            ),
          );
        }
        if (!stripe) {
          return c.json(
            {
              error: {
                code: "PROVIDER_ERROR",
                message: "Stripe is not configured (STRIPE_SECRET_KEY)",
              },
            },
            503,
          );
        }
        const res = await stripeRefund(
          getDb(),
          {
            paymentId: c.req.param("id"),
            operator,
            ...(typeof b.reason === "string" && b.reason.trim() !== ""
              ? { reason: b.reason }
              : {}),
            evidence: parseEvidence(b.evidence),
          },
          stripe,
        );
        return respond(c, res);
      }
      const res = await createRefundIntent(getDb(), {
        paymentId: c.req.param("id"),
        operator,
        payee: typeof b.payee === "string" ? b.payee : "",
        amount: typeof b.amount === "string" ? b.amount : "",
        reason: typeof b.reason === "string" ? b.reason : "",
        ...(typeof b.currency === "string" && b.currency.trim() !== ""
          ? { currency: b.currency }
          : {}),
        evidence: parseEvidence(b.evidence),
      });
      return respond(c, res, 201);
    },
  );

  routes.post(
    "/admin/finance/payments/:id/refund-resolution",
    describeRoute({
      ...TAG,
      summary:
        "Resolve an UNCERTAIN Stripe refund — operator confirms out-of-band whether it landed",
      responses: {
        200: { description: "Terminal audit row written" },
        400: { description: "Missing operator/evidence" },
        401: { description: "Unauthorized" },
        409: { description: "No open refund initiation" },
      },
    }),
    adminAuth,
    async (c) => {
      const b = await readBody(c);
      // `landed` must be explicit — silently defaulting to "not
      // landed" would release the in-flight lock on a guess.
      const landed =
        b.landed === true || b.landed === "true" || b.landed === "on"
          ? true
          : b.landed === false || b.landed === "false"
            ? false
            : undefined;
      if (landed === undefined) {
        return respond(
          c,
          fail("BAD_INPUT", "landed must be true|false"),
        );
      }
      const res = await resolveStripeRefund(getDb(), {
        paymentId: c.req.param("id"),
        operator: typeof b.operator === "string" ? b.operator : "",
        landed,
        evidence: parseEvidence(b.evidence) ?? b.evidence,
      });
      return respond(c, res);
    },
  );

  return routes;
}
