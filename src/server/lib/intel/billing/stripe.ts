// EPIC-262 (SLICE-262-21): Stripe adapter — webhook signature is
// `Stripe-Signature: t=<ts>,v1=<hmac>` over `t.rawBody` (HMAC-SHA256,
// endpoint secret). Tenant binding: event metadata {tenant_id, plan}
// — ops stamps it on the payment link/subscription (262-22+ may add
// a billing-ref store for metadata-free events).
import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingSignal, IntelBillingConnector, VerifyResult } from "./types";

const hmacHex = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(payload, "utf8").digest("hex");

const safeEq = (a: string, b: string) => {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

interface StripeEvent {
  id?: string;
  type?: string;
  created?: number;
  data?: { object?: Record<string, unknown> };
}

export function createStripeConnector(secret: string): IntelBillingConnector {
  return {
    provider: "stripe",
    verifyAndMap(headers, rawBody): VerifyResult {
      const sigHeader = headers["stripe-signature"];
      if (!sigHeader) return { ok: false, error: "bad_signature" };
      const parts = Object.fromEntries(
        sigHeader.split(",").map((kv) => kv.split("=", 2) as [string, string]),
      );
      const t = parts.t;
      const v1 = parts.v1;
      if (!t || !v1 || !safeEq(hmacHex(secret, `${t}.${rawBody}`), v1)) {
        return { ok: false, error: "bad_signature" };
      }
      let event: StripeEvent;
      try {
        event = JSON.parse(rawBody) as StripeEvent;
      } catch {
        return { ok: false, error: "bad_payload" };
      }
      if (!event.id || !event.type) return { ok: false, error: "bad_payload" };
      const obj = event.data?.object ?? {};
      const meta = (obj.metadata ?? {}) as Record<string, string>;
      const tenantId = meta.tenant_id ?? meta.tenantId;
      const occurredAt = event.created
        ? new Date(event.created * 1000).toISOString()
        : new Date().toISOString();
      const signal = (effect: BillingSignal["effect"]): BillingSignal => ({
        externalId: event.id!,
        tenantId: tenantId ?? "",
        effect,
        occurredAt,
      });
      switch (event.type) {
        case "checkout.session.completed": {
          const plan = meta.plan;
          if (!tenantId || !plan) return { ok: false, error: "unmapped_event" };
          return { ok: true, signals: [signal({ kind: "assign_plan", planCode: plan })] };
        }
        case "invoice.paid":
          if (!tenantId) return { ok: false, error: "unmapped_event" };
          return { ok: true, signals: [signal({ kind: "transition", action: "payment_recovered" })] };
        case "invoice.payment_failed":
          if (!tenantId) return { ok: false, error: "unmapped_event" };
          return { ok: true, signals: [signal({ kind: "transition", action: "payment_failed" })] };
        case "customer.subscription.deleted":
          if (!tenantId) return { ok: false, error: "unmapped_event" };
          return { ok: true, signals: [signal({ kind: "transition", action: "cancel" })] };
        default:
          // honest ignore — not an error: Stripe sends ~50 event types
          return { ok: true, signals: [signal({ kind: "ignore", reason: `unhandled ${event.type}` })] };
      }
    },
  };
}
