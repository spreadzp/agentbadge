/**
 * SLICE-154-6: webhook delivery — POST VerdictArtifact to a consumer URL.
 *
 * - SSRF hygiene (EPIC-85): https only, no localhost/private ranges —
 *   assertSafeTarget rejects literal IPs (incl. hex/octal/decimal forms);
 *   hostnames are additionally resolved+pinned by the delivery fetch
 *   (redirect: manual + revalidation, cap 2 hops).
 * - Signature: X-Verdict-Signature = HMAC-SHA256(body, secret) hex when
 *   ARC_EAAS_WEBHOOK_SECRET is configured; X-Verdict-Id always sent.
 * - Retries: attempts at t=0 then 1s, 10s, 60s (4 tries total).
 * fetchFn/sleep/backoff are injectable so tests run instantly.
 */
import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import type { VerdictArtifact } from "./verdict";
import {
  assertSafeTarget,
  isBlockedIp,
} from "../../../agent-readiness/scanner/ssrf/ip-guard";

export const WEBHOOK_BACKOFF_MS = [1_000, 10_000, 60_000];
const MAX_REDIRECTS = 2;
const FETCH_TIMEOUT_MS = 10_000;

export class WebhookSsrfError extends Error {
  constructor(url: string, reason: string) {
    super(`webhook URL rejected: ${reason}`);
    this.name = "WebhookSsrfError";
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
]);

/**
 * Synchronous URL gate used at request validation (400 before payment).
 * Throws WebhookSsrfError on: non-https, localhost names, private/blocked
 * literal IPs (incl. encoded forms). DNS-resolved private IPs are also
 * rejected inside deliverWebhook (async check) — belt & suspenders.
 */
export function assertWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookSsrfError(raw, "invalid URL");
  }
  if (url.protocol !== "https:") {
    throw new WebhookSsrfError(raw, "https only");
  }
  const host = url.hostname.toLowerCase();
  if (
    BLOCKED_HOSTNAMES.has(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new WebhookSsrfError(raw, "localhost/internal host");
  }
  try {
    assertSafeTarget(host);
  } catch {
    throw new WebhookSsrfError(raw, "private/blocked IP literal");
  }
  return url;
}

/** DNS resolution guard — hostname must not resolve to a private IP. */
async function assertResolvedSafe(url: URL): Promise<void> {
  const host = url.hostname;
  // Literal IPs were validated synchronously; only resolve real hostnames.
  if (/^[\d.:]+$/.test(host) || host === "") return;
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch (e) {
    throw new WebhookSsrfError(
      url.toString(),
      `DNS lookup failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  for (const { address } of addrs) {
    if (isBlockedIp(address)) {
      throw new WebhookSsrfError(
        url.toString(),
        `resolves to private IP ${address}`,
      );
    }
  }
}

export interface WebhookDeliverDeps {
  /** ARC_EAAS_WEBHOOK_SECRET — HMAC-SHA256 over the JSON body. */
  secret?: string;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Delays BEFORE retries 2..N (default WEBHOOK_BACKOFF_MS → 4 attempts). */
  backoffMs?: number[];
  /** Per-attempt timeout (default 10s). */
  timeoutMs?: number;
  /** Test hook — skip DNS resolution check. */
  skipDns?: boolean;
}

export interface WebhookResult {
  ok: boolean;
  attempts: number;
  statusCode?: number;
  error?: string;
}

const sleepDefault = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

async function postOnce(
  url: URL,
  body: string,
  headers: Record<string, string>,
  deps: WebhookDeliverDeps,
  redirectsLeft: number,
): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
  const doFetch = deps.fetchFn ?? fetch;
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
      if (res.ok) return { ok: true, statusCode: res.status };
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, statusCode: res.status };
        if (hop >= redirectsLeft) {
          return { ok: false, statusCode: res.status, error: "redirect cap" };
        }
        url = assertWebhookUrl(new URL(loc, url).toString());
        continue; // revalidated target, same body/headers
      }
      return {
        ok: false,
        statusCode: res.status,
        error: `HTTP ${res.status}`,
      };
    } catch (e) {
      if (e instanceof WebhookSsrfError) throw e; // SSRF on redirect = fatal
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    } finally {
      clearTimeout(t);
    }
  }
}

/**
 * POST {requestId, artifact} to `url` with X-Verdict-Id /
 * X-Verdict-Signature. Throws WebhookSsrfError only for URL violations —
 * network failures return {ok:false} after the backoff schedule.
 */
export async function deliverWebhook(args: {
  url: string;
  requestId: string;
  artifact: VerdictArtifact;
  deps: WebhookDeliverDeps;
}): Promise<WebhookResult> {
  const url = assertWebhookUrl(args.url);
  if (!args.deps.skipDns) await assertResolvedSafe(url);

  const body = JSON.stringify({
    requestId: args.requestId,
    artifact: args.artifact,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Verdict-Id": args.artifact.verdictId,
    "X-Eaas-Request-Id": args.requestId,
  };
  if (args.deps.secret) {
    headers["X-Verdict-Signature"] = createHmac("sha256", args.deps.secret)
      .update(body)
      .digest("hex");
  }

  const sleep = args.deps.sleep ?? sleepDefault;
  const backoff = args.deps.backoffMs ?? WEBHOOK_BACKOFF_MS;
  const maxAttempts = backoff.length + 1;

  let last: { ok: boolean; statusCode?: number; error?: string } = {
    ok: false,
    error: "no attempts",
  };
  let attempts = 0;
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await sleep(backoff[i - 1]!);
    attempts++;
    last = await postOnce(url, body, headers, args.deps, MAX_REDIRECTS);
    if (last.ok) return { ok: true, attempts, statusCode: last.statusCode };
  }
  return { ok: false, attempts, statusCode: last.statusCode, error: last.error };
}
