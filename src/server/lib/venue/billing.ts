/**
 * SLICE-153-5: venue subscription billing + per-venue take rate.
 *
 * Subscription = a record on VenueRecord (D7-153: cheaper than an extra
 * NFT; optional ARC_BV_MINT_PASS can also mint an access pass). Status is
 * derived from subscription.expiresAt vs now + grace window:
 *
 *   none    — never subscribed (legacy/unmetered venue)
 *   active  — expiresAt > now
 *   grace   — expired but within ARC_BV_GRACE_DAYS (default 3)
 *   expired — past grace → new jobs 402; reads/members/admin work
 *
 * In-flight jobs are never blocked: claim/submit/evaluate settle escrow
 * regardless of subscription state (funds must not be stranded).
 *
 * Payments log in the meta lane (venue:billing:<id>), cap 100 — same
 * persistence semantics as the venue registry + admin audit.
 */
import { isAddress } from "viem";
import { logger } from "@agentbadge/passport";

import { getVenueMeta, setVenueMeta } from "./store";
import {
  appendAdminAudit,
  listVenues,
  updateVenue,
  type VenueRecord,
  type VenueSubscription,
} from "./venues";

// ─── Env ─────────────────────────────────────────────────────────

const DAY_SEC = 86_400;

/** Grace window after expiry — in-flight jobs finish, new jobs still OK. */
export function graceDays(): number {
  const n = Number(process.env.ARC_BV_GRACE_DAYS ?? "3");
  return Number.isFinite(n) && n >= 0 ? n : 3;
}

/** Monthly subscription price in atomic USDC (ARC_BV_MONTHLY_USD, $10). */
export function venueMonthlyPriceAtomic(): bigint {
  const raw = process.env.ARC_BV_MONTHLY_USD ?? "10000000";
  return /^[0-9]+$/.test(raw) ? BigInt(raw) : 10_000_000n;
}

/** Subscriber take-rate override (ARC_BV_SUBSCRIBER_TAKE_BPS, default 150). */
export function subscriberTakeBps(): number {
  const n = Number(process.env.ARC_BV_SUBSCRIBER_TAKE_BPS ?? "150");
  return Number.isInteger(n) && n >= 0 && n <= 10_000 ? n : 150;
}

/** Paid amount → subscription seconds (30d = 1 monthly price, min 1 day). */
export function venueSubscriptionDurationSec(amountAtomic: string): number {
  const monthly = Number(venueMonthlyPriceAtomic());
  const paid = Number(BigInt(amountAtomic || "0"));
  if (paid <= 0 || monthly <= 0) return DAY_SEC;
  const days = paid / monthly * 30;
  return Math.max(DAY_SEC, Math.floor(days * DAY_SEC));
}

// ─── Status ──────────────────────────────────────────────────────

export type SubscriptionStatus = "none" | "active" | "grace" | "expired";

export function subscriptionStatus(
  venue: Pick<VenueRecord, "subscription"> | undefined,
  now = Math.floor(Date.now() / 1000),
): SubscriptionStatus {
  const exp = venue?.subscription?.expiresAt;
  if (!exp) return "none";
  if (exp > now) return "active";
  if (exp + graceDays() * DAY_SEC > now) return "grace";
  return "expired";
}

/**
 * New-job gate for business venues: only fully-expired venues are
 * blocked (402). `none` stays unmetered for backward compatibility.
 */
export function subscriptionBlocksWrites(
  venue: Pick<VenueRecord, "kind" | "subscription"> | undefined,
): boolean {
  return venue?.kind === "business" && subscriptionStatus(venue) === "expired";
}

/** True while subscription is active — drives the subscriber take rate. */
export function isSubscribed(
  venue: Pick<VenueRecord, "subscription"> | undefined,
): boolean {
  return subscriptionStatus(venue) === "active";
}

// ─── Payment ledger (meta lane) ──────────────────────────────────

export interface VenuePayment {
  ts: number;
  payer: string;
  amountAtomic: string;
  durationSec: number;
  tx?: string;
  /** SLICE-156-3: cross-chain attribution (CAIP-2 network + rail). */
  sourceChain?: string;
  scheme?: string;
  expiresAtAfter: number;
}

const paymentsKey = (venueId: string) => `venue:billing:${venueId}`;
const PAYMENTS_CAP = 100;

export function listVenuePayments(venueId: string): VenuePayment[] {
  return getVenueMeta<VenuePayment[]>(paymentsKey(venueId)) ?? [];
}

/** SLICE-156-3: payments by source chain for grant reporting ("unknown" = unset). */
export function venuePaymentsByChain(
  venueId: string,
): Record<string, { count: number; amountAtomic: string }> {
  const out: Record<string, { count: number; amount: bigint }> = {};
  for (const p of listVenuePayments(venueId)) {
    const k = p.sourceChain ?? "unknown";
    const acc = (out[k] ??= { count: 0, amount: 0n });
    acc.count++;
    acc.amount += BigInt(p.amountAtomic);
  }
  return Object.fromEntries(
    Object.entries(out).map(([k, v]) => [
      k,
      { count: v.count, amountAtomic: v.amount.toString() },
    ]),
  );
}

function appendVenuePayment(
  venueId: string,
  entry: Omit<VenuePayment, "ts">,
): void {
  const log = [...listVenuePayments(venueId), { ts: Date.now(), ...entry }];
  setVenueMeta(paymentsKey(venueId), log.slice(-PAYMENTS_CAP));
}

// ─── Subscribe ───────────────────────────────────────────────────

export interface SubscribeResult {
  venue: VenueRecord;
  durationSec: number;
  expiresAt: number;
}

/**
 * Extend subscription additively from max(now, expiresAt) — the same
 * mintOrExtend semantics as access-pass-minter. Records the payment in
 * the venue ledger + an admin-audit entry.
 */
export function extendVenueSubscription(args: {
  venueId: string;
  payer: `0x${string}`;
  amountAtomic: string;
  tx?: string;
  /** SLICE-156-3: cross-chain attribution (settle seam forwards). */
  sourceChain?: string;
  scheme?: string;
  venue?: VenueRecord;
}): SubscribeResult | undefined {
  const venue = args.venue;
  if (!venue || !isAddress(args.payer)) return undefined;
  const now = Math.floor(Date.now() / 1000);
  const durationSec = venueSubscriptionDurationSec(args.amountAtomic);
  const base = Math.max(now, venue.subscription?.expiresAt ?? 0);
  const expiresAt = base + durationSec;
  const plan: VenueSubscription["plan"] =
    durationSec >= 300 * DAY_SEC ? "annual" : "monthly";
  const subscription: VenueSubscription = {
    status: "active",
    expiresAt,
    lastPaymentTx: args.tx as `0x${string}` | undefined,
    plan,
  };
  const next = updateVenue(venue.id, { subscription, active: true });
  if (!next) return undefined;
  appendVenuePayment(venue.id, {
    payer: args.payer,
    amountAtomic: args.amountAtomic,
    durationSec,
    tx: args.tx,
    ...(args.sourceChain ? { sourceChain: args.sourceChain } : {}),
    ...(args.scheme ? { scheme: args.scheme } : {}),
    expiresAtAfter: expiresAt,
  });
  appendAdminAudit(venue.id, {
    actor: args.payer,
    field: "subscription.expiresAt",
    old: venue.subscription?.expiresAt,
    new: expiresAt,
  });
  logger.info("venue: subscription extended", {
    venueId: venue.id,
    expiresAt,
    durationSec,
    tx: args.tx,
  });
  return { venue: next, durationSec, expiresAt };
}

// ─── Sweeper ─────────────────────────────────────────────────────

export interface SubscriptionSweepResult {
  scanned: number;
  transitions: { venueId: string; slug: string; from: string; to: string }[];
  skipped?: boolean;
}

/**
 * Daily scan: recompute subscription status for business venues and
 * persist transitions (active→grace→expired) into the stored record —
 * keeps GET /admin stats honest without a read-time recompute.
 * Optional ARC_BV_WEBHOOK_URL gets a JSON POST on every transition.
 */
export async function checkVenueSubscriptions(
  now = Math.floor(Date.now() / 1000),
): Promise<SubscriptionSweepResult> {
  const result: SubscriptionSweepResult = { scanned: 0, transitions: [] };
  const webhook = process.env.ARC_BV_WEBHOOK_URL;
  for (const venue of listVenues({ kind: "business" })) {
    if (!venue.subscription) continue;
    result.scanned++;
    const stored = venue.subscription.status;
    const derived = subscriptionStatus(venue, now);
    if (derived === "none" || derived === stored) continue;
    updateVenue(venue.id, {
      subscription: { ...venue.subscription, status: derived },
    });
    result.transitions.push({
      venueId: venue.id, slug: venue.slug, from: stored, to: derived,
    });
    logger.info("venue: subscription transition", {
      venueId: venue.id, from: stored, to: derived,
    });
    if (webhook) {
      try {
        await fetch(webhook, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "venue.subscription",
            venueId: venue.id,
            slug: venue.slug,
            ownerWallet: venue.ownerWallet,
            from: stored,
            to: derived,
            ts: Date.now(),
          }),
        });
      } catch (e) {
        logger.warn("venue: subscription webhook failed", {
          venueId: venue.id,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
  return result;
}

let sweeperTimer: ReturnType<typeof setTimeout> | null = null;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Daily subscription sweeper (escrow-reconciler pattern), env-gated. */
export function startVenueBillingSweeper(): void {
  if (process.env.ARC_BV_SWEEPER_ENABLED === "false") {
    logger.info("venue billing sweeper disabled (ARC_BV_SWEEPER_ENABLED=false)");
    return;
  }
  if (sweeperTimer) return;
  const tick = async () => {
    try {
      const r = await checkVenueSubscriptions();
      if (r.transitions.length > 0) {
        logger.info("venue billing sweep", {
          scanned: r.scanned, transitions: r.transitions.length,
        });
      }
    } catch (e) {
      logger.error("venue billing sweep error", {
        err: e instanceof Error ? e.message : String(e),
      });
    }
    sweeperTimer = setTimeout(tick, DAY_MS);
  };
  sweeperTimer = setTimeout(tick, 60_000); // first tick 1min after boot
  logger.info("venue billing sweeper started", { intervalMs: DAY_MS });
}

export function stopVenueBillingSweeper(): void {
  if (sweeperTimer) {
    clearTimeout(sweeperTimer);
    sweeperTimer = null;
  }
}
