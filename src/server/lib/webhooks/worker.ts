/**
 * EPIC-233 (SLICE-233-4): webhook outbox worker — claim → deliver →
 * resolve, env-gated interval in the server process (no cron dep,
 * startBoardOutboxDispatcher/startAiWorker pattern).
 *
 * Backoff: attempts are consumed on CLAIM, so a crash mid-delivery
 * still burns budget (at-most-once attempt accounting, at-least-once
 * delivery). Retry delay = WEBHOOK_BACKOFF_MS[attempts-1] clamped to
 * the tail; exhausting WEBHOOK_MAX_ATTEMPTS → failed (dead-letter,
 * never retried). Fatal outcomes (SSRF redirect) dead-letter on the
 * first attempt.
 *
 * Env: WEBHOOK_WORKER_ENABLED=0 disables; WEBHOOK_WORKER_INTERVAL_MS
 * (5s), WEBHOOK_MAX_ATTEMPTS (5), WEBHOOK_SIGNING_SECRET (signing key —
 * absent → unsigned deliveries, dev only), WEBHOOK_CLAIM_LEASE_MS (60s).
 */

import { getConfig } from "../../../config/env";
import { getDatabase } from "../database";
import { pickRequestInboxStores } from "../request-inbox/db-stores";
import {
  deliverWebhook,
  type WebhookDeliverDeps,
} from "./deliver";
import type { WebhookOutboxStore } from "./types";

export const WEBHOOK_BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000];
const DEFAULT_LIMIT = 25;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_INTERVAL_MS = 5_000;

export interface DrainWebhookDeps extends WebhookDeliverDeps {
  outbox?: WebhookOutboxStore;
  limit?: number;
  maxAttempts?: number;
  leaseMs?: number;
}

export interface WebhookDrainResult {
  processed: number;
  delivered: number;
  requeued: number;
  deadLettered: number;
  errors: string[];
}

const backoffFor = (attempts: number) =>
  WEBHOOK_BACKOFF_MS[
    Math.min(Math.max(attempts - 1, 0), WEBHOOK_BACKOFF_MS.length - 1)
  ]!;

export async function drainWebhookOutbox(
  deps: DrainWebhookDeps = {},
): Promise<WebhookDrainResult> {
  const res: WebhookDrainResult = {
    processed: 0,
    delivered: 0,
    requeued: 0,
    deadLettered: 0,
    errors: [],
  };
  const outbox = deps.outbox ?? pickRequestInboxStores(getDatabase()).webhooks;
  if (!outbox) return res;
  const now = deps.nowMs?.() ?? Date.now();
  const maxAttempts =
    deps.maxAttempts ??
    Number(process.env.WEBHOOK_MAX_ATTEMPTS ?? DEFAULT_MAX_ATTEMPTS);

  const rows = await outbox.claim(
    now,
    deps.limit ?? DEFAULT_LIMIT,
    deps.leaseMs ?? DEFAULT_LEASE_MS,
  );
  const secret =
    deps.secret !== undefined ? deps.secret : process.env.WEBHOOK_SIGNING_SECRET;

  for (const row of rows) {
    res.processed++;
    try {
      const outcome = await deliverWebhook({
        url: row.callbackUrl,
        requestId: row.requestId,
        deliveryId: row.id,
        payload: row.payload,
        deps: { ...deps, secret },
      });
      if (outcome.ok) {
        await outbox.resolve(row.id, { status: "done" });
        res.delivered++;
        continue;
      }
      const err = outcome.error ?? "delivery failed";
      if (outcome.fatal || row.attempts >= maxAttempts) {
        await outbox.resolve(row.id, { status: "failed", lastError: err });
        res.deadLettered++;
        res.errors.push(`${row.id}: ${err}`);
        continue;
      }
      await outbox.resolve(row.id, {
        status: "queued",
        nextAttemptAtMs:
          (deps.nowMs?.() ?? Date.now()) + backoffFor(row.attempts),
        lastError: err,
      });
      res.requeued++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.errors.push(`${row.id}: ${msg}`);
      await outbox.resolve(row.id, {
        status: "queued",
        nextAttemptAtMs: (deps.nowMs?.() ?? Date.now()) + backoffFor(row.attempts),
        lastError: msg,
      });
      res.requeued++;
    }
  }
  return res;
}

let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

/** In-process dispatcher (D-233-5) — started from startBackgroundJobs.
 *  Disable with WEBHOOK_WORKER_ENABLED=0. */
export function startWebhookWorker(): void {
  if (process.env.WEBHOOK_WORKER_ENABLED === "0") return;
  if (_timer) return;
  const intervalMs = Number(
    process.env.WEBHOOK_WORKER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS,
  );
  _timer = setInterval(() => {
    if (_running) return; // overlap guard — a slow drain skips the tick
    _running = true;
    void drainWebhookOutbox()
      .catch((e) => console.error("[webhook-worker] drain error:", e))
      .finally(() => {
        _running = false;
      });
  }, intervalMs);
  _timer.unref?.();
  void getConfig(); // warm config once — same boot pattern as neighbors
}
