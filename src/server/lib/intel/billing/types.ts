// EPIC-262 (SLICE-262-21): billing connector — provider-agnostic
// webhook signal. Adapters verify + translate provider payloads;
// handleBillingSignal applies them to the 19b lifecycle. The
// entitlement layer never sees provider shapes.
import type { TransitionAction } from "../entitlement";

export interface BillingSignal {
  /** provider event id — dedupe key (webhooks retry) */
  externalId: string;
  /** tenant the event applies to — from provider metadata */
  tenantId: string;
  /** normalized lifecycle effect */
  effect:
    | { kind: "assign_plan"; planCode: string }
    | { kind: "transition"; action: TransitionAction }
    | { kind: "ignore"; reason: string };
  occurredAt: string; // ISO
}

export type VerifyResult =
  | { ok: true; signals: BillingSignal[] }
  | { ok: false; error: "bad_signature" | "bad_payload" | "unmapped_event" };

export interface IntelBillingConnector {
  provider: "stripe" | "freemius";
  /** verify signature over the RAW body + map to signals.
   *  Raw bytes — JSON.parse before verify would break HMAC. */
  verifyAndMap(headers: Record<string, string | undefined>, rawBody: string): VerifyResult;
}
