/**
 * SLICE-154-6: async verdict requests — enqueue → background run →
 * webhook fan-out (KeeperHub-126 callback pattern: upfront payment,
 * status polling + push delivery).
 *
 * A row is created BEFORE the worker starts (202 contract) and updated
 * terminal-side: "done" carries the artifact, "failed" carries the error.
 * `enqueueAsyncRequest` is fire-and-forget for the route but returns the
 * completion promise so tests can await deterministically.
 */
import type { Context } from "hono";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { logger } from "@agentbadge/passport";
import type { VerdictArtifact } from "./verdict";
import type { EaasMetrics } from "./metrics";
import type { WebhookDeliverDeps } from "./webhooks";
import { deliverWebhook } from "./webhooks";

export interface EaasAsyncRequest {
  id: string;
  kind: "verdict" | "job-eval";
  status: "pending" | "done" | "failed";
  wallet?: string;
  webhookUrl?: string;
  artifact?: VerdictArtifact;
  error?: string;
  /** Webhook attempts spent (0 when delivered without retries). */
  attempts: number;
  /** Webhook delivery outcome — pending while delivering, absent w/o webhook. */
  webhookStatus?: "pending" | "delivered" | "failed";
  createdAt: string;
  completedAt?: string;
}

export interface EaasRequestStore {
  put(req: EaasAsyncRequest): void;
  get(id: string): EaasAsyncRequest | undefined;
  update(
    id: string,
    patch: Partial<
      Pick<
        EaasAsyncRequest,
        "status" | "artifact" | "error" | "attempts" | "webhookStatus" | "completedAt"
      >
    >,
  ): void;
  /** Status counters for /api/eaas/status. */
  counts(): Record<EaasAsyncRequest["status"], number>;
}

/* ---------------------------------- JSON ---------------------------------- */

interface ReqFile {
  requests: Record<string, EaasAsyncRequest>;
}

function readReqFile(path: string): ReqFile {
  if (!existsSync(path)) return { requests: {} };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as ReqFile;
    return { requests: raw.requests ?? {} };
  } catch {
    return { requests: {} };
  }
}

function writeReqFile(path: string, data: ReqFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

export function createJsonRequestStore(
  path = join(process.cwd(), ".data", "eaas-requests.json"),
): EaasRequestStore {
  return {
    put(req) {
      const data = readReqFile(path);
      data.requests[req.id] = req;
      writeReqFile(path, data);
    },
    get(id) {
      return readReqFile(path).requests[id];
    },
    update(id, patch) {
      const data = readReqFile(path);
      const cur = data.requests[id];
      if (!cur) return;
      data.requests[id] = { ...cur, ...patch };
      writeReqFile(path, data);
    },
    counts() {
      const c: Record<EaasAsyncRequest["status"], number> = {
        pending: 0,
        done: 0,
        failed: 0,
      };
      for (const r of Object.values(readReqFile(path).requests)) c[r.status]++;
      return c;
    },
  };
}

export function createMemoryRequestStore(): EaasRequestStore {
  const map = new Map<string, EaasAsyncRequest>();
  return {
    put: (req) => void map.set(req.id, req),
    get: (id) => map.get(id),
    update: (id, patch) => {
      const cur = map.get(id);
      if (cur) map.set(id, { ...cur, ...patch });
    },
    counts: () => {
      const c = { pending: 0, done: 0, failed: 0 };
      for (const r of map.values()) c[r.status]++;
      return c;
    },
  };
}

/* --------------------------------- enqueue -------------------------------- */

export interface EaasAsyncDeps {
  store: EaasRequestStore;
  metrics: EaasMetrics;
  /** Webhook delivery knobs — secret/backoff; fetchFn injectable in tests. */
  webhook: WebhookDeliverDeps;
  /** Async run budget (ARC_EAAS_ASYNC_TIMEOUT_S). */
  timeoutSec: number;
}

/**
 * Creates the request row and starts the run in the background.
 * Returns the row + a `done` promise for tests / internal joins.
 */
export function enqueueAsyncRequest(args: {
  deps: EaasAsyncDeps;
  kind: EaasAsyncRequest["kind"];
  wallet?: string;
  webhookUrl?: string;
  run: () => Promise<VerdictArtifact>;
}): { request: EaasAsyncRequest; done: Promise<void> } {
  const { deps } = args;
  const request: EaasAsyncRequest = {
    id: `req_${randomBytes(8).toString("hex")}`,
    kind: args.kind,
    status: "pending",
    ...(args.wallet ? { wallet: args.wallet } : {}),
    ...(args.webhookUrl ? { webhookUrl: args.webhookUrl } : {}),
    ...(args.webhookUrl ? { webhookStatus: "pending" as const } : {}),
    attempts: 0,
    createdAt: new Date().toISOString(),
  };
  deps.store.put(request);

  const done = (async () => {
    const t0 = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("async timeout")),
          deps.timeoutSec * 1000,
        );
      });
      const artifact = await Promise.race([args.run(), timeout]);
      deps.store.update(request.id, {
        status: "done",
        artifact,
        completedAt: new Date().toISOString(),
      });
      deps.metrics.observeVerdict(Date.now() - t0);

      if (request.webhookUrl) {
        const res = await deliverWebhook({
          url: request.webhookUrl,
          requestId: request.id,
          artifact,
          deps: deps.webhook,
        });
        deps.store.update(request.id, {
          attempts: res.attempts,
          webhookStatus: res.ok ? "delivered" : "failed",
        });
        deps.metrics.observeWebhook(res.ok);
        if (!res.ok) {
          logger.warn("eaas: webhook delivery failed", {
            requestId: request.id,
            url: request.webhookUrl,
            error: res.error,
          });
        }
      }
    } catch (e) {
      deps.store.update(request.id, {
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
        completedAt: new Date().toISOString(),
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();

  return { request, done };
}

/**
 * Shared "202 + enqueue" responder for verdicts/jobs routes.
 * null = sync mode (caller continues); Response = async handled
 * (202) or rejected (400 when the feature isn't wired).
 */
export function respondAsync(
  c: Context,
  deps: EaasAsyncDeps | undefined,
  opts: {
    isAsync?: boolean;
    kind: EaasAsyncRequest["kind"];
    wallet?: string;
    webhookUrl?: string;
    run: () => Promise<VerdictArtifact>;
  },
): Response | null {
  if (!opts.isAsync) return null;
  if (!deps) return c.json({ error: "async mode not enabled" }, 400);
  const { request } = enqueueAsyncRequest({
    deps,
    kind: opts.kind,
    ...(opts.wallet ? { wallet: opts.wallet } : {}),
    ...(opts.webhookUrl ? { webhookUrl: opts.webhookUrl } : {}),
    run: opts.run,
  });
  return c.json(
    {
      requestId: request.id,
      statusUrl: `/api/eaas/requests/${request.id}`,
    },
    202,
  );
}
