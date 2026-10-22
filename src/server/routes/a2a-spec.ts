/**
 * A2A v1.0 protocol surface (EPIC-203, SLICE-203-5).
 *
 * Mounted at /a2a (routes/index.ts):
 *   GET  /a2a/challenge              — issue one-shot nonce for EIP-191 sign
 *   POST /a2a                        — JSON-RPC 2.0 (SendMessage, GetTask, …)
 *   POST /a2a/message:send           — REST binding
 *   GET  /a2a/tasks  /a2a/tasks/{id} — list / get (caller-scoped)
 *   POST /a2a/tasks/{id}:cancel      — cancel
 *   POST /a2a/tasks/{id}:subscribe   — SSE resubscribe
 *
 * Legacy HCS mailbox keeps old paths + /a2a/hcs/* aliases (a2a.ts).
 *
 * Auth: EIP-191 `agentbadge-action:v1` challenge (X-Agent-Id/X-Wallet/
 * X-Sig/X-Timestamp/X-Nonce). Verified passport-tier → durable
 * PostgresTaskStore; unverified → anonymous tier (RedisTaskStore, TTL,
 * stricter rate limit). This file wires server deps only — all protocol
 * logic lives in packages/a2a.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { describeRoute } from "hono-openapi";
import {
  ArcAnchorWriter,
  InMemoryTaskStore,
  PostgresAnchorStore,
  createA2AHonoApp,
  FallbackExecutor,
  PostgresTaskStore,
  RedisNonceStore,
  RedisTaskStore,
  RoutingAgentExecutor,
  ScanAgentExecutor,
  type A2AHonoApp,
} from "@agentbadge/a2a";
import { logger } from "@agentbadge/passport/logger";

import { getCache } from "../lib/cache";
import { getDatabase } from "../lib/database";
import { agentCard } from "../lib/a2a-spec-card";
import { getArcEventLogWriter } from "../lib/fx-delta/arc-writer";

const A2A_SPEC_TAGS = ["A2A v1.0"];

const NONCE_TTL_SEC = 300;
const ANON_TTL_SEC = 3600;

const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// AgentCard shape moved to lib/a2a-spec-card.ts (SLICE-203-7, max-lines).
// /.well-known/agent-card.json is served by the discovery-manifest
// pipeline (agent-discovery/agent-card.ts → generated static) — keep the
// handler card and the public card consistent.

let app: A2AHonoApp | null = null;

/** Lazy singleton — builds stores/executor on first request. */
export function getA2ASpecApp(): A2AHonoApp {
  if (!app) {
    const cache = getCache();
    const db = getDatabase().db;

    // Passport tier requires Postgres; degrade to in-memory when DB off
    // (dev without DATABASE_ENABLED) — anonymous tier is always Redis-backed.
    if (!db) {
      logger.warn(
        "a2a-spec: DATABASE disabled — passport tier degrades to in-memory store",
      );
    }
    const passportStore = db
      ? new PostgresTaskStore(db)
      : new InMemoryTaskStore();
    const anonymousStore = new RedisTaskStore(cache, {
      ttlSec: ANON_TTL_SEC,
    });

    const executor = new RoutingAgentExecutor(
      new ScanAgentExecutor({
        scan: async (domain: string) => {
          const { scanDomain } = await import(
            "../../agent-readiness/scanner/orchestrator"
          );
          return scanDomain(`https://${domain}`);
        },
      }),
      new FallbackExecutor(),
    );

    app = createA2AHonoApp({
      agentCard: agentCard(),
      executor,
      passportStore,
      anonymousStore,
      cache,
      nonceStore: new RedisNonceStore(cache, { ttlSec: NONCE_TTL_SEC }),
      anonLimit: envInt("A2A_ANON_LIMIT", 1),
      authLimit: envInt("A2A_AUTH_LIMIT", 60),
      // SLICE-203-8: ext mailbox — passport tier only; without Postgres
      // the /ext/* routes simply aren't mounted.
      mailboxStore:
        passportStore instanceof PostgresTaskStore ? passportStore : undefined,
      extLimit: envInt("A2A_EXT_LIMIT", 120),
    });

    // SLICE-203-6: Arc anchor — Merkle-batch emitTopic("a2a", manifest).
    // Env-gated A2A_ANCHOR_ENABLED (default off); needs DATABASE + a writer
    // key (ARC_PRIVATE_KEY/FXDELTA_ANCHOR_KEY). Best-effort: emit failure
    // leaves rows pending and retries on the next flush — never fails tasks.
    anchorWriter =
      db && process.env.A2A_ANCHOR_ENABLED === "true"
        ? new ArcAnchorWriter({
            store: new PostgresAnchorStore(db),
            emit: async (topic, manifestJson) => {
              const w = getArcEventLogWriter();
              if (!w) throw new Error("no Arc writer key configured");
              return w.writer(manifestJson, topic);
            },
            enabled: true,
            batchSize: envInt("A2A_ANCHOR_BATCH_SIZE", 20),
            maxAgeMs: envInt("A2A_ANCHOR_MAX_AGE", 600) * 1000,
            warn: (msg, meta) => logger.warn(msg, meta),
          })
        : null;
    if (anchorWriter) {
      // Age-path flush trigger (N-path also fired post-request below).
      setInterval(() => anchorWriter?.maybeFlush(), 60_000).unref();
      logger.info("a2a-spec: Arc anchor enabled", {
        batchSize: envInt("A2A_ANCHOR_BATCH_SIZE", 20),
      });
    }
  }
  return app;
}

let anchorWriter: ArcAnchorWriter | null = null;

/** Read-side accessor for tests/ops. */
export function getA2AAnchorWriter(): ArcAnchorWriter | null {
  return anchorWriter;
}

/**
 * Hono sub-app mounting the spec surface + OpenAPI descriptions.
 * `describeRoute` documents each path; `forward` delegates the raw request
 * into the adapter sub-app with the `/a2a` mount prefix stripped.
 */
export const a2aSpecRoutes = new Hono();

// SLICE-203-6 N-threshold trigger: after every spec request, best-effort
// anchor flush (no-op when gated off / below thresholds / no writer).
a2aSpecRoutes.use("*", async (c, next) => {
  await next();
  anchorWriter?.maybeFlush();
});

const forward = async (c: Context) => {
  const url = new URL(c.req.url);
  const innerPath = url.pathname.replace(/^\/a2a/, "") || "/";
  const forwarded = new Request(`${url.origin}${innerPath}${url.search}`, {
    method: c.req.raw.method,
    headers: c.req.raw.headers,
    body: ["GET", "HEAD"].includes(c.req.raw.method)
      ? undefined
      : c.req.raw.body,
    // @ts-expect-error undici requires duplex for streaming request bodies
    duplex: "half",
  });
  return getA2ASpecApp().hono.fetch(forwarded);
};

const restDoc = (summary: string, description: string) =>
  describeRoute({
    tags: A2A_SPEC_TAGS,
    summary,
    description,
    responses: {
      200: { description: "Success — `application/a2a+json`" },
      404: { description: "Task not found or not accessible to caller" },
      429: { description: "Rate limit exceeded (tier-scoped)" },
    },
  });

a2aSpecRoutes.get(
  "/challenge",
  describeRoute({
    tags: A2A_SPEC_TAGS,
    summary: "Issue one-shot A2A auth nonce",
    description:
      "Returns a nonce + unix timestamp. The client builds the canonical " +
      "`agentbadge-action:v1` challenge itself (agentId/method/path/" +
      "body_sha256/timestamp/nonce), signs it EIP-191, and sends the " +
      "X-Agent-Id/X-Wallet/X-Sig/X-Timestamp/X-Nonce headers.",
    responses: { 200: { description: "Nonce + timestamp issued" } },
  }),
  forward,
);

a2aSpecRoutes.post(
  "/",
  describeRoute({
    tags: A2A_SPEC_TAGS,
    summary: "A2A JSON-RPC 2.0 endpoint",
    description:
      "Spec methods: SendMessage, GetTask, ListTasks, CancelTask, " +
      "task resubscribe (SSE), push-notification config. " +
      "`A2A-Version: 1.0` header on responses.",
    responses: { 200: { description: "JSON-RPC result" } },
  }),
  forward,
);

a2aSpecRoutes.post(
  "/message:send",
  restDoc(
    "Send message (REST binding)",
    "Equivalent of JSON-RPC SendMessage. Signed requests (EIP-191 headers + " +
      "ERC-8004 owner match) run at passport tier with durable Postgres " +
      "tasks; unsigned/invalid → anonymous tier, Redis-only TTL tasks.",
  ),
  forward,
);

a2aSpecRoutes.get(
  "/tasks",
  restDoc(
    "List tasks",
    "Caller-scoped list: ?contextId&status&pageSize&pageToken filters. " +
      "Passport and anonymous tiers see only their own scope.",
  ),
  forward,
);

a2aSpecRoutes.get(
  "/tasks/:id",
  restDoc("Get task", "Single task by id within the caller's scope."),
  forward,
);

a2aSpecRoutes.post(
  "/tasks/:id",
  restDoc(
    "Task verb: :cancel / :subscribe",
    "POST /a2a/tasks/{id}:cancel → canceled task. " +
      "POST /a2a/tasks/{id}:subscribe → SSE stream of task events.",
  ),
  forward,
);

// SLICE-203-8 ext mailbox (AgentBadge extension, not A2A spec).
// Passport tier only; anonymous → 403. X-Robots-Tag: noindex inside.
const extDoc = (summary: string, description: string) =>
  describeRoute({
    tags: A2A_SPEC_TAGS,
    summary,
    description: `AgentBadge extension — ${description} ` +
      "Requires EIP-191 signed headers (passport tier, own ext rate bucket).",
    responses: {
      200: { description: "Success — `application/a2a+json`" },
      403: { description: "Anonymous tier — passport required" },
      404: { description: "Not found or not addressed to caller" },
      429: { description: "Rate limit exceeded" },
    },
  });
const ext = (path: string, summary: string, description: string, method: "get" | "post") =>
  a2aSpecRoutes[method](path, extDoc(summary, description), forward);

ext(
  "/ext/inbox", "Ext mailbox: inbox",
  "Messages TO the signed agentId. Filters: ?unread=1&since=<ISO>&from=<agentId>&pageSize&pageToken.",
  "get",
);
ext(
  "/ext/outbox", "Ext mailbox: outbox",
  "Messages FROM the signed agentId (same filters as inbox).", "get",
);
ext(
  "/ext/unread", "Ext mailbox: unread",
  "Unread messages TO the signed agentId — {count, messages[]}.", "get",
);
ext(
  "/ext/messages/:id", "Ext mailbox: mark-read",
  "POST /a2a/ext/messages/{id}:read — sets readAt; foreign/unknown ids → 404.",
  "post",
);
