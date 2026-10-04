/**
 * SLICE-154-5: EaaS billing tiers — subscription quota store + the
 * pass/quota gate shared by POST /api/eaas/verdicts and
 * POST /api/eaas/jobs/evaluate.
 *
 * Model (D5-154): two billings coexist —
 *   - x402 pay-per-call (154-2/154-3), unchanged;
 *   - tiered subscription: POST /api/eaas/subscribe settles x402, mints an
 *     AccessPassNFT CLASS_EAAS (bit 8) and records an EaasSubscription row.
 *
 * Gate order on a gated call:
 *   valid wallet-sig + onchain hasAccess(w, 8) + active sub record
 *     → quota path (no x402), quotaUsed++ per call;
 *   quota exhausted / no pass / no record → graceful fallback to x402
 *     (subscription is a discount, never a lock-in);
 *   tier policy gate — a tier without the requested policy in its
 *     policies[] gets 402 {error: "policy_requires_pro", upgrade} even
 *     though pay-per-call exists: dApps holding a pass should upgrade,
 *     anonymous callers can still pay per call.
 *
 * Quota window: rolling 30d (resetAt). Renewing early keeps the current
 * window and quotaUsed; subscribing after expiry starts a fresh window.
 */

import type { Context, MiddlewareHandler } from "hono";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { logger } from "@agentbadge/passport";
import { verifyWalletSigRequest, CLASS_EAAS } from "../../middleware/agent-auth";

export const EAAS_QUOTA_WINDOW_SEC = 30 * 86_400;

export interface EaasTierDef {
  /** Verdict/evaluate calls allowed per 30d window. */
  quota: number;
  /** Policy allowlist; ["*"] = all policies. */
  policies: string[];
}

export type EaasTierMap = Record<string, EaasTierDef>;

export interface EaasSubscription {
  /** Consumer wallet, lowercased — primary key. */
  wallet: string;
  /** Tier key into the tiers map ("basic" | "pro" | env-defined). */
  tier: string;
  /** Unix seconds — mirrors the onchain pass expiry. */
  expiresAt: number;
  /** Calls consumed in the current window. */
  quotaUsed: number;
  /** Unix seconds — end of the current rolling quota window. */
  resetAt: number;
  /** x402 settle tx of the last subscribe payment. */
  paymentTx?: string;
  /** AccessPassNFT mintOrExtend tx of the last subscribe. */
  mintTx?: string;
  /** ISO timestamp of last mutation. */
  updatedAt: string;
}

export interface EaasSubscriptionStore {
  name: "json" | "memory" | "db";
  get(wallet: string): EaasSubscription | undefined;
  put(sub: EaasSubscription): void;
  list(): EaasSubscription[];
}

/* --------------------------------- stores --------------------------------- */

interface SubsJsonFile {
  subscriptions: Record<string, EaasSubscription>;
}

function readSubs(path: string): SubsJsonFile {
  if (!existsSync(path)) return { subscriptions: {} };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as SubsJsonFile;
    return { subscriptions: raw.subscriptions ?? {} };
  } catch {
    return { subscriptions: {} };
  }
}

export function createJsonSubscriptionStore(
  path = join(process.cwd(), ".data", "eaas-subscriptions.json"),
): EaasSubscriptionStore {
  return {
    name: "json",
    get(wallet) {
      return readSubs(path).subscriptions[wallet.toLowerCase()];
    },
    put(sub) {
      const data = readSubs(path);
      data.subscriptions[sub.wallet.toLowerCase()] = {
        ...sub,
        wallet: sub.wallet.toLowerCase(),
      };
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(data, null, 2));
    },
    list() {
      return Object.values(readSubs(path).subscriptions);
    },
  };
}

export function createMemorySubscriptionStore(): EaasSubscriptionStore {
  const map = new Map<string, EaasSubscription>();
  return {
    name: "memory",
    get: (w) => map.get(w.toLowerCase()),
    put: (s) => map.set(s.wallet.toLowerCase(), s) as unknown as void,
    list: () => [...map.values()],
  };
}

/* --------------------------------- tiers ---------------------------------- */

/** True when the tier allows `policy` ("*" wildcard or exact match). */
export function tierAllowsPolicy(tier: EaasTierDef, policy: string): boolean {
  return tier.policies.includes("*") || tier.policies.includes(policy);
}

/**
 * Record (or extend) a subscription after a settled subscribe payment.
 * expiresAt extends additively from max(now, prev.expiresAt) — the same
 * mintOrExtend semantics as the pass contract. A fresh/expired record
 * starts a new 30d quota window; a live renewal keeps quotaUsed.
 */
export function recordSubscription(args: {
  store: EaasSubscriptionStore;
  wallet: string;
  tier: string;
  durationSec: number;
  paymentTx?: string;
  mintTx?: string;
  now?: number; // unix sec, injectable for tests
}): EaasSubscription {
  const now = args.now ?? Math.floor(Date.now() / 1000);
  const wallet = args.wallet.toLowerCase();
  const prev = args.store.get(wallet);
  const expired = !prev || prev.expiresAt <= now;
  const base = Math.max(now, prev?.expiresAt ?? 0);
  const sub: EaasSubscription = {
    wallet,
    tier: args.tier,
    expiresAt: base + args.durationSec,
    quotaUsed: expired ? 0 : (prev?.quotaUsed ?? 0),
    resetAt: expired || !prev ? now + EAAS_QUOTA_WINDOW_SEC : prev.resetAt,
    ...(args.paymentTx ? { paymentTx: args.paymentTx } : {}),
    ...(args.mintTx ? { mintTx: args.mintTx } : {}),
    updatedAt: new Date(now * 1000).toISOString(),
  };
  args.store.put(sub);
  logger.info("eaas: subscription recorded", {
    wallet,
    tier: args.tier,
    expiresAt: sub.expiresAt,
    resetAt: sub.resetAt,
    paymentTx: args.paymentTx,
    mintTx: args.mintTx,
  });
  return sub;
}

/* ------------------------------- quota gate ------------------------------- */

export interface EaasQuotaDeps {
  store: EaasSubscriptionStore;
  tiers: EaasTierMap;
  /** Onchain pass check — wiring passes agent-auth checkAccess. */
  hasAccess: (wallet: string, cls: number) => Promise<boolean>;
  now?: () => number; // unix sec
}

export type EaasAccess =
  | { kind: "pay" } // fall through to x402 pay-per-call
  | { kind: "quota"; wallet: string; tier: string; quotaLeft: number }
  | { kind: "deny"; response: Response };

/**
 * Decide whether a gated call rides the subscription quota or the x402
 * payment rail. Pass/quota state is read AFTER body validation and rate
 * limiting (callers mount this between them and the payment middleware).
 */
export async function checkEaasQuotaAccess(
  c: Context,
  policy: string | undefined,
  deps: EaasQuotaDeps,
): Promise<EaasAccess> {
  const wallet = c.req.header("x-wallet");
  const sig = await verifyWalletSigRequest({
    wallet,
    signature: c.req.header("x-sig"),
    timestamp: c.req.header("x-timestamp"),
    method: c.req.method,
    path: c.req.path,
  });
  if (sig === "invalid") {
    return {
      kind: "deny",
      response: c.json({ error: "wallet signature invalid" }, 401),
    };
  }
  if (sig !== "valid" || !wallet) return { kind: "pay" };

  // Valid sig — holder of a CLASS_EAAS pass rides quota, else pay per call.
  const hasPass = await deps.hasAccess(wallet, CLASS_EAAS);
  if (!hasPass) return { kind: "pay" };

  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))();
  const w = wallet.toLowerCase();
  const sub = deps.store.get(w);
  if (!sub || sub.expiresAt <= now) return { kind: "pay" };
  const tier = deps.tiers[sub.tier];
  if (!tier) return { kind: "pay" };

  // Tier policy gate — upgrade hint, not a fallback (AC: 402 for pro-only
  // policies on basic, so subscribers see the upgrade path explicitly).
  if (policy && !tierAllowsPolicy(tier, policy)) {
    return {
      kind: "deny",
      response: c.json(
        {
          error: "policy_requires_pro",
          tier: sub.tier,
          policy,
          upgrade: "POST /api/eaas/subscribe with a pro-tier payment",
        },
        402,
      ),
    };
  }

  // Rolling window reset, then quota check — exhausted falls back to x402.
  if (now >= sub.resetAt) {
    sub.quotaUsed = 0;
    sub.resetAt = now + EAAS_QUOTA_WINDOW_SEC;
  }
  if (sub.quotaUsed >= tier.quota) return { kind: "pay" };

  sub.quotaUsed += 1;
  sub.updatedAt = new Date(now * 1000).toISOString();
  deps.store.put(sub);
  return {
    kind: "quota",
    wallet: w,
    tier: sub.tier,
    quotaLeft: tier.quota - sub.quotaUsed,
  };
}

/**
 * Shared route middleware: subscription quota when it applies, else the
 * x402 `fallback` (usually paymentForPrice(policy)). On the quota path it
 * sets `payment.payer` = wallet and `eaasQuota` = {wallet,tier,quotaLeft}
 * so downstream handlers see a normal consumerWallet.
 */
export function eaasQuotaGate(args: {
  quota: EaasQuotaDeps | undefined;
  policy: (c: Context) => string | undefined;
  fallback: MiddlewareHandler;
}): MiddlewareHandler {
  return async (c, next) => {
    if (!args.quota) return args.fallback(c, next);
    const access = await checkEaasQuotaAccess(c, args.policy(c), args.quota);
    if (access.kind === "deny") return access.response;
    if (access.kind === "quota") {
      c.set("eaasQuota", {
        wallet: access.wallet,
        tier: access.tier,
        quotaLeft: access.quotaLeft,
      });
      c.set("payment", { payer: access.wallet });
      return next();
    }
    return args.fallback(c, next);
  };
}
