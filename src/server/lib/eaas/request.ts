/**
 * SLICE-154-2: request-side helpers for the verdict API —
 * body validation (400 before payment) + sliding-window rate limit
 * (429 before settle). Extracted from routes/eaas-api.ts (max-lines).
 */

import type { Context } from "hono";
import type { Hex } from "viem";
import { getPolicy, UnknownPolicyError, type PolicyFn } from "./policies";
import { assertWebhookUrl, WebhookSsrfError } from "./webhooks";

export const HEX32_RE = /^0x[0-9a-fA-F]{64}$/;

/** readiness-scan дороже — per-policy price override. */
export const EXPENSIVE_POLICIES = new Set(["readiness-scan"]);

/* ------------------------------ rate limiter ------------------------------ */

/** Sliding-window limiter: per-consumer key + global bucket. */
export function createRateLimiter(rpm: number) {
  const hits = new Map<string, number[]>();
  const windowMs = 60_000;
  const check = (key: string, limit: number): boolean => {
    const now = Date.now();
    const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    hits.set(key, arr);
    if (arr.length >= limit) return false;
    arr.push(now);
    return true;
  };
  return {
    /** false = exceeded. key = payer/ip; global checked too. */
    allow(key: string): boolean {
      if (!check("__global__", rpm * 10)) return false;
      return check(key, rpm);
    },
  };
}

export function consumerKey(c: Context): string {
  return (
    c.req.header("x-wallet") ??
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "anon"
  );
}

/* ------------------------------- validation ------------------------------- */

interface VerdictRequestBody {
  policy?: unknown;
  deliverable?: { uri?: unknown; data?: unknown };
  expectedHash?: unknown;
  nonce?: unknown;
  /** SLICE-154-6: async mode — 202 + statusUrl + optional webhook. */
  async?: unknown;
  webhookUrl?: unknown;
}

export interface ParsedVerdictRequest {
  policy: string;
  deliverable: unknown;
  deliverableUri?: string;
  expectedHash?: Hex;
  nonce?: string;
  /** SLICE-154-6: async mode — 202 + statusUrl + optional webhook. */
  async?: boolean;
  webhookUrl?: string;
}

/** Hono context variables: parsed body + settled payment info. */
export interface EaasVariables {
  eaasReq: ParsedVerdictRequest;
  /** Set by requirePayment after successful settle. */
  payment?: { payer?: string; transaction?: string; amount?: string };
  /** SLICE-154-5: chosen billing tier on POST /api/eaas/subscribe. */
  eaasTier?: string;
  /** SLICE-154-5: set when the call rode the subscription quota path. */
  eaasQuota?: { wallet: string; tier: string; quotaLeft: number };
}

function bad(c: Context, error: string): Response {
  return c.json({ error }, 400);
}

export { bad };

export async function parseBody(
  c: Context,
  maxBytes: number,
  registry?: Record<string, PolicyFn>,
): Promise<ParsedVerdictRequest | Response> {
  let body: VerdictRequestBody;
  try {
    body = (await c.req.json()) as VerdictRequestBody;
  } catch {
    return bad(c, "invalid JSON body");
  }

  if (typeof body.policy !== "string" || body.policy.length === 0) {
    return bad(c, "policy is required");
  }
  try {
    getPolicy(body.policy, registry);
  } catch (e) {
    if (e instanceof UnknownPolicyError) {
      return bad(c, `unknown policy "${body.policy}"`);
    }
    throw e;
  }

  const d = body.deliverable;
  if (typeof d !== "object" || d === null) {
    return bad(c, 'deliverable object required: {"uri"|"data"}');
  }
  const hasUri = typeof d.uri === "string" && d.uri.length > 0;
  const hasData = d.data !== undefined;
  if (hasUri === hasData) {
    return bad(c, 'exactly one of deliverable.uri or deliverable.data required');
  }
  if (hasUri) {
    try {
      const u = new URL(d.uri as string);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
    } catch {
      return bad(c, "deliverable.uri must be an http(s) URL");
    }
  }
  if (hasData) {
    const size = new TextEncoder().encode(JSON.stringify(d.data)).length;
    if (size > maxBytes) {
      return bad(c, `deliverable.data exceeds ${maxBytes} bytes`);
    }
  }

  let expectedHash: Hex | undefined;
  if (body.expectedHash !== undefined) {
    if (
      typeof body.expectedHash !== "string" ||
      !HEX32_RE.test(body.expectedHash)
    ) {
      return bad(c, "expectedHash must be a 0x-prefixed 32-byte hex");
    }
    expectedHash = body.expectedHash as Hex;
  }
  if (body.policy === "hash-match" && !expectedHash) {
    return bad(c, "expectedHash required for hash-match policy");
  }

  let nonce: string | undefined;
  if (body.nonce !== undefined) {
    if (typeof body.nonce !== "string" && typeof body.nonce !== "number") {
      return bad(c, "nonce must be a string or number");
    }
    nonce = String(body.nonce);
  }

  // SLICE-154-6: async flag + webhook SSRF check — 400 before payment.
  const async_ = body.async === true;
  let webhookUrl: string | undefined;
  if (body.webhookUrl !== undefined) {
    if (typeof body.webhookUrl !== "string") {
      return bad(c, "webhookUrl must be a string");
    }
    try {
      webhookUrl = assertWebhookUrl(body.webhookUrl).toString();
    } catch (e) {
      return bad(
        c,
        e instanceof WebhookSsrfError ? e.message : "invalid webhookUrl",
      );
    }
    if (!async_) return bad(c, "webhookUrl requires async:true");
  }

  return {
    policy: body.policy,
    deliverable: hasUri ? { uri: d.uri } : { data: d.data },
    deliverableUri: hasUri ? (d.uri as string) : undefined,
    expectedHash,
    nonce,
    ...(async_ ? { async: true } : {}),
    ...(webhookUrl ? { webhookUrl } : {}),
  };
}
