/**
 * EPIC-233 (SLICE-233-4): single-attempt signed POST delivery.
 * Retry scheduling lives in the outbox worker (persisted backoff) —
 * this module is one attempt: SSRF-revalidated redirect hops
 * (redirect: manual, ≤2 hops, EVERY hop re-checked through the intake
 * validator so a 30x cannot smuggle a private target), 10s timeout,
 * receiver body never consumed (size cap = stream cancelled).
 *
 * `fatal` marks permanent failures (SSRF redirect, invalid target)
 * that must NOT burn retry budget — the worker dead-letters them.
 */

import {
  validateCallbackUrl,
  type CallbackUrlCheck,
} from "../request-inbox/callback-url";
import {
  DELIVERY_ID_HEADER,
  REQUEST_ID_HEADER,
  SIGNATURE_HEADER,
  signWebhookBody,
} from "./sign";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 2;

export interface WebhookDeliverDeps {
  /** WEBHOOK_SIGNING_SECRET — absent → unsigned delivery (dev). */
  secret?: string;
  fetchFn?: typeof fetch;
  /** Per-attempt timeout (default 10s). */
  timeoutMs?: number;
  maxRedirects?: number;
  /** Per-hop target re-validation — defaults to the intake validator
   *  (assertSafeTarget + DNS re-resolve). Tests inject a sync check. */
  validateUrl?: (raw: string) => Promise<CallbackUrlCheck>;
  nowMs?: () => number;
}

export interface WebhookDeliveryOutcome {
  ok: boolean;
  statusCode?: number;
  error?: string;
  /** Permanent failure — dead-letter immediately, skip retry budget. */
  fatal?: boolean;
}

export async function deliverWebhook(args: {
  url: string;
  requestId: string;
  deliveryId: string;
  payload: Record<string, unknown>;
  deps?: WebhookDeliverDeps;
}): Promise<WebhookDeliveryOutcome> {
  const deps = args.deps ?? {};
  const validate = deps.validateUrl ?? validateCallbackUrl;
  const check = await validate(args.url);
  if (!check.ok) {
    return { ok: false, error: `invalid target: ${check.reason}`, fatal: true };
  }

  const body = JSON.stringify(args.payload);
  const tsSec = Math.floor((deps.nowMs?.() ?? Date.now()) / 1000);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "AgentBadge-Webhook/1",
    [REQUEST_ID_HEADER]: args.requestId,
    [DELIVERY_ID_HEADER]: args.deliveryId,
  };
  if (deps.secret) {
    headers[SIGNATURE_HEADER] = signWebhookBody(deps.secret, tsSec, body);
  }

  const doFetch = deps.fetchFn ?? fetch;
  let url = new URL(check.url);
  for (let hop = 0; ; hop++) {
    const ctrl = new AbortController();
    const t = setTimeout(
      () => ctrl.abort(),
      deps.timeoutMs ?? FETCH_TIMEOUT_MS,
    );
    try {
      const res = await doFetch(url.toString(), {
        method: "POST",
        headers,
        body,
        redirect: "manual",
        signal: ctrl.signal,
      });
      // Receiver body is never needed — cancel the stream so no
      // response bytes are buffered (size cap by construction).
      void res.body?.cancel();
      if (res.ok) return { ok: true, statusCode: res.status };
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, statusCode: res.status };
        if (hop >= (deps.maxRedirects ?? MAX_REDIRECTS)) {
          return {
            ok: false,
            statusCode: res.status,
            error: "redirect cap",
          };
        }
        const next = await validate(new URL(loc, url).toString());
        if (!next.ok) {
          return {
            ok: false,
            statusCode: res.status,
            error: `redirect target rejected: ${next.reason}`,
            fatal: true,
          };
        }
        url = new URL(next.url);
        continue;
      }
      return { ok: false, statusCode: res.status, error: `HTTP ${res.status}` };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    } finally {
      clearTimeout(t);
    }
  }
}
