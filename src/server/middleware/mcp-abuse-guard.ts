/**
 * MCP abuse-guard (EPIC-200, SLICE-200-08, D-200-2).
 *
 * Three layers on /mcp + /mcp/:namespace:
 *
 * 1. Per-IP sliding-window bucket — base shield for anonymous traffic.
 *    The global rateLimitMiddleware only covers REST /mcp*\/tools/:name
 *    paths; the JSON-RPC roots (/mcp, /mcp/:ns/) were unlimited. This
 *    guard covers all MCP traffic.
 *
 * 2. Keyed tier lanes — Bearer agb_ (agentKeyAuth → agentId) gives an
 *    agent:<id> bucket; a DID-verified request (did-auth → verifiedDid)
 *    gives a did:<did> bucket resolved to its passport tier
 *    (bronze→platinum via directoryCache, wiring/mcp-abuse.ts). Both
 *    lanes get their own wider cap, so one busy agent does not eat the
 *    shared IP pool (and vice versa). Self-declared DID headers are NOT
 *    trusted — only signature-verified verifiedDid.
 *
 * 3. Heavy-ops — mutating/big-index tools (see DEFAULT_HEAVY_OPS,
 *    overridable) get a dedicated stricter bucket per lane, plus an
 *    optional x402 gate via setMcpHeavyGate(). The gate is resolved
 *    lazily per request because circleRuntime is wired after the
 *    middleware mounts (index.ts).
 *
 * Goals: 10k agents must not take the server down (backlog MYPROJ-2609).
 * Store: shared RateLimitStore — MemoryStore by default,
 * CacheRateLimitStore when CACHE_ENABLED (multi-replica counters).
 */

import type { Context, MiddlewareHandler, Next } from "hono";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import {
  MemoryStore,
  resolveClientIp,
  type RateLimitEntry,
  type RateLimitStore,
} from "./rate-limit";

// ─── Heavy ops ───────────────────────────────────────────
// Onchain-mutating tools + big-index searches + the future Arc write
// rail (SLICE-200-07). Env MCP_ABUSE_HEAVY_OPS overrides the list.
export const DEFAULT_HEAVY_OPS: readonly string[] = [
  // future Arc write rail
  "arc_send_raw_tx",
  // passport/signing mutations
  "request_passport",
  "upgrade_tier",
  "revoke_passport",
  "sign_transaction",
  "upload_image",
  // marketplace mutations
  "post_task",
  "claim_task",
  "complete_task",
  "deliver_result",
  "verify_result",
  "upload_result",
  "increase_reward",
  "cancel_escrow",
  "prepare_payment",
  "post_task_with_key",
  "claim_task_with_key",
  "complete_task_with_key",
  "deliver_result_with_key",
  // identity/A2A mutations
  "register_agent",
  "send_message",
  // heavy reads on large indexes
  "search_agents",
  "find_agents",
  "search_knowledge",
];

// ─── Config ──────────────────────────────────────────────

export interface McpAbuseGuardOptions {
  /** anonymous per-IP cap per window (default 60) */
  anonMax?: number;
  /** keyed (agb_ bearer) cap per window (default 120) */
  keyedMax?: number;
  /** heavy-op cap per lane per window (default 10) */
  heavyMax?: number;
  /** heavy tool names (default DEFAULT_HEAVY_OPS) */
  heavyOps?: readonly string[];
  /** sliding window in ms (default 60_000) */
  windowMs?: number;
  /** per-tier caps for future passport-tier resolution */
  tierMax?: Record<string, number>;
  /** backing store (default MemoryStore) */
  store?: RateLimitStore;
  /** resolve caller tier (default: c.get("agentTier") ?? "anon") */
  resolveTier?: (c: Context) => string;
}

const DEFAULT_ANON_MAX = 60;
const DEFAULT_KEYED_MAX = 120;
const DEFAULT_HEAVY_MAX = 10;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 10_000;
const MCP_ABUSE_HIT_FLAG = "mcpAbuseHit";

// ─── x402 seam (layer 3b) ────────────────────────────────
// circleRuntime is created after the guard mounts — resolved lazily
// per request, matching the spendEnvelope lazy-getter pattern.
let heavyGate: MiddlewareHandler | undefined;

/** Wire the heavy-op x402 gate after circle payments init. Pass
 *  undefined in tests / feature-off. */
export function setMcpHeavyGate(gate: MiddlewareHandler | undefined): void {
  heavyGate = gate;
}

// ─── Tool-name extraction ────────────────────────────────

const REST_TOOL_RE = /^\/mcp(?:\/[^/?]+)?\/tools\/([^/?]+)/;

function toolNameFromPath(path: string): string | undefined {
  const m = REST_TOOL_RE.exec(path);
  return m ? decodeURIComponent(m[1]) : undefined;
}

/** Read JSON-RPC tools/call name from a cloned request — the clone keeps
 *  the downstream handler's body intact. */
async function toolNameFromBody(c: Context): Promise<string | undefined> {
  if (c.req.method !== "POST") return undefined;
  try {
    const clone = c.req.raw.clone();
    const body = (await clone.json()) as {
      method?: string;
      params?: { name?: string };
    };
    if (body?.method === "tools/call") return body.params?.name;
  } catch {
    /* non-JSON body — nothing to inspect */
  }
  return undefined;
}

// ─── Bucket hit ──────────────────────────────────────────

async function hit(
  store: RateLimitStore,
  key: string,
  windowMs: number,
  now: number,
): Promise<RateLimitEntry> {
  if (store.hit) {
    // Remote store (EPIC-144): atomic INCR+EXPIRE.
    return store.hit(key, windowMs);
  }
  let entry = store.get(key) ?? { count: 0, resetAt: now + windowMs };
  if (entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
  }
  entry.count++;
  store.set(key, entry);
  return entry;
}

// ─── Middleware ──────────────────────────────────────────

export function mcpAbuseGuard(options: McpAbuseGuardOptions = {}): MiddlewareHandler {
  const anonMax = options.anonMax ?? DEFAULT_ANON_MAX;
  const keyedMax = options.keyedMax ?? DEFAULT_KEYED_MAX;
  const heavyMax = options.heavyMax ?? DEFAULT_HEAVY_MAX;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const tierMax = options.tierMax ?? {};
  const heavySet = new Set(options.heavyOps ?? DEFAULT_HEAVY_OPS);
  const store = options.store ?? new MemoryStore();
  const resolveTier = options.resolveTier ?? ((c: Context) => (c.get("agentTier") as string | undefined) ?? "anon");

  let lastSweep = Date.now();
  function maybeSweep(now: number): void {
    if (now - lastSweep >= windowMs) {
      store.sweep(now);
      lastSweep = now;
    }
  }

  function limited(c: Context, entry: RateLimitEntry, max: number, now: number): Response {
    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    c.header("Retry-After", String(retryAfter));
    return errorResponse(c, 429, ErrorCodes.RATE_LIMITED, "Too Many Requests");
  }

  return async (c: Context, next: Next): Promise<Response | void> => {
    // Idempotent per request — Hono's "/mcp/*" also matches "/mcp", so a
    // guard mounted on both patterns would otherwise double-count.
    if (c.get(MCP_ABUSE_HIT_FLAG)) return next();
    c.set(MCP_ABUSE_HIT_FLAG, true);

    const now = Date.now();
    maybeSweep(now);
    if (store.size() > DEFAULT_MAX_ENTRIES) store.sweep(now);

    // Lane: verified DID → did:<did>; keyed agent (agentKeyAuth) →
    // agent:<id>; anonymous → per-IP. Tier-aware lanes use tierMax with
    // keyedMax as floor (verified identity = accountability); anonymous
    // falls back to anonMax. Unverified/self-declared DIDs never elevate.
    const verifiedDid = c.get("verifiedDid") as string | undefined;
    const agentId = c.get("agentId") as string | undefined;
    const tier = resolveTier(c);
    const lane = verifiedDid
      ? `did:${verifiedDid}`
      : agentId
        ? `agent:${agentId}`
        : `ip:${resolveClientIp(c)}`;
    const max =
      verifiedDid || agentId ? (tierMax[tier] ?? keyedMax) : anonMax;


    // Layer 1+2: base lane bucket.
    const base = await hit(store, `mcp:base:${lane}`, windowMs, now);
    const remaining = Math.max(0, max - base.count);
    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(Math.floor(base.resetAt / 1000)));
    if (base.count > max) {
      return limited(c, base, max, now);
    }

    // Layer 3: heavy-op bucket + optional x402 gate.
    const toolName = toolNameFromPath(c.req.path) ?? (await toolNameFromBody(c));
    if (toolName && heavySet.has(toolName)) {
      const heavy = await hit(store, `mcp:heavy:${lane}`, windowMs, now);
      if (heavy.count > heavyMax) {
        return limited(c, heavy, heavyMax, now);
      }
      if (heavyGate) {
        return heavyGate(c, next);
      }
    }

    return next();
  };
}
