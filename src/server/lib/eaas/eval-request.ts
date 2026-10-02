/**
 * SLICE-154-3/6: evaluate-request validation — extracted from
 * routes/eaas-jobs-api.ts (max-lines). Runs before rate-limit/allowlist:
 * malformed input and unsafe webhook URLs get 400 ahead of any payment.
 */
import type { Context } from "hono";
import { isAddress } from "viem";
import type { Hex } from "viem";
import type { EaasContract } from "./contracts";
import { bad, HEX32_RE } from "./request";
import { assertWebhookUrl, WebhookSsrfError } from "./webhooks";

/** Parsed+validated evaluate request stashed for the post-payment handler. */
export interface EvalInput {
  rec: EaasContract;
  jobId: bigint;
  policy?: string;
  expectedHash?: Hex;
  deliverableUri?: string;
  /** SLICE-154-6: async delivery — 202 + statusUrl + optional webhook. */
  async?: boolean;
  webhookUrl?: string;
}

/** Validate the evaluate body → parsed input | Response(400). */
export function validateEvaluate(
  body: unknown,
  c: Context,
): ({ contract: string } & Omit<EvalInput, "rec">) | Response {
  if (typeof body !== "object" || body === null) {
    return bad(c, "invalid JSON body");
  }
  const b = body as Record<string, unknown>;
  if (typeof b.contract !== "string" || !isAddress(b.contract)) {
    return bad(c, "contract (0x…) required");
  }
  if (typeof b.jobId !== "string" && typeof b.jobId !== "number") {
    return bad(c, "jobId required");
  }
  let jobId: bigint;
  try {
    jobId = BigInt(b.jobId);
  } catch {
    return bad(c, "jobId must be an integer");
  }
  if (b.policy !== undefined && typeof b.policy !== "string") {
    return bad(c, "policy must be a POLICY_REGISTRY key");
  }
  if (b.expectedHash !== undefined) {
    if (typeof b.expectedHash !== "string" || !HEX32_RE.test(b.expectedHash)) {
      return bad(c, "expectedHash must be 0x + 64 hex");
    }
  }
  if (b.deliverableUri !== undefined && typeof b.deliverableUri !== "string") {
    return bad(c, "deliverableUri must be a string");
  }
  // SLICE-154-6: async flag + webhook SSRF check — 400 before payment.
  const async_ = b.async === true;
  let webhookUrl: string | undefined;
  if (b.webhookUrl !== undefined) {
    if (typeof b.webhookUrl !== "string") {
      return bad(c, "webhookUrl must be a string");
    }
    try {
      webhookUrl = assertWebhookUrl(b.webhookUrl).toString();
    } catch (e) {
      return bad(
        c,
        e instanceof WebhookSsrfError ? e.message : "invalid webhookUrl",
      );
    }
    if (!async_) return bad(c, "webhookUrl requires async:true");
  }
  return {
    contract: b.contract,
    jobId,
    ...(typeof b.policy === "string" ? { policy: b.policy } : {}),
    ...(typeof b.expectedHash === "string"
      ? { expectedHash: b.expectedHash as Hex }
      : {}),
    ...(typeof b.deliverableUri === "string"
      ? { deliverableUri: b.deliverableUri }
      : {}),
    ...(async_ ? { async: true } : {}),
    ...(webhookUrl ? { webhookUrl } : {}),
  };
}
