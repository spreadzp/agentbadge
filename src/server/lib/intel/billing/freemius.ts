// EPIC-262 (SLICE-262-21): Freemius adapter — the WP-plugin commerce
// rail. Webhook authenticity: `x-fs-signature` header = HMAC-SHA256
// hex of the raw POST body with the webhook secret. Events arrive as
// JSON {id, type, objects:{...}}; tenant binding via custom field
// `tenant_id` the ops flow stamps on the install.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingSignal, IntelBillingConnector, VerifyResult } from "./types";

const hmacHex = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(payload, "utf8").digest("hex");

const safeEq = (a: string, b: string) => {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

interface FreemiusEvent {
  id?: string | number;
  type?: string;
  created?: string;
  objects?: { install?: Record<string, unknown> };
}

const TYPE_MAP: Record<string, BillingSignal["effect"] | "assign"> = {
  "install.subscription.created": "assign",
  "install.subscription.renewed": { kind: "transition", action: "renew" },
  "install.subscription.payment_failed": { kind: "transition", action: "payment_failed" },
  "install.subscription.canceled": { kind: "transition", action: "cancel" },
};

export function createFreemiusConnector(secret: string): IntelBillingConnector {
  return {
    provider: "freemius",
    verifyAndMap(headers, rawBody): VerifyResult {
      const sig = headers["x-fs-signature"];
      if (!sig || !safeEq(hmacHex(secret, rawBody), sig)) {
        return { ok: false, error: "bad_signature" };
      }
      let event: FreemiusEvent;
      try {
        event = JSON.parse(rawBody) as FreemiusEvent;
      } catch {
        return { ok: false, error: "bad_payload" };
      }
      if (!event.id || !event.type) return { ok: false, error: "bad_payload" };
      const install = event.objects?.install ?? {};
      const tenantId = String(install.tenant_id ?? install.custom_0 ?? "");
      const plan = String(install.plan_title ?? install.plan_name ?? "");
      const occurredAt = event.created ?? new Date().toISOString();
      const mapped = TYPE_MAP[event.type];
      const signal = (effect: BillingSignal["effect"]): BillingSignal => ({
        externalId: `fs_${event.id}`,
        tenantId,
        effect,
        occurredAt,
      });
      if (!mapped) {
        return { ok: true, signals: [signal({ kind: "ignore", reason: `unhandled ${event.type}` })] };
      }
      if (mapped === "assign") {
        if (!tenantId || !plan) return { ok: false, error: "unmapped_event" };
        return { ok: true, signals: [signal({ kind: "assign_plan", planCode: plan.toLowerCase() })] };
      }
      if (!tenantId) return { ok: false, error: "unmapped_event" };
      return { ok: true, signals: [signal(mapped)] };
    },
  };
}
