// SLICE-155-6: spend alert events — cap_denied / failed /
// release_late / low_balance. Stored in a lightweight append
// store (memory ring + optional JSON persistence, ledger-style);
// emitted via a module singleton so enforcer/hooks can fire from
// anywhere without plumbing. Webhook delivery: POST JSON with
// 154-6 backoff (t=0, 1s, 10s, 60s), fire-and-forget.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { logger } from "@agentbadge/passport";
import type { AgentWalletRecord } from "./registry";
import type { SpendLedger, SpendEntry } from "./ledger";

export type SpendAlertType =
  | "spend.cap_denied"
  | "spend.velocity_denied"
  | "spend.kind_denied"
  | "wallet.suspended_deny"
  | "wallet.suspended"
  | "wallet.resumed"
  | "approval.requested"
  | "approval.consumed"
  | "approval.expired"
  | "spend.failed"
  | "spend.release_late"
  | "wallet.low_balance";

export interface SpendAlertEvent {
  id: string;
  type: SpendAlertType;
  wallet: `0x${string}`;
  venueId?: string;
  at: number;
  data: Record<string, unknown>;
}

export interface SpendAlertStore {
  name: "memory" | "json" | "db";
  add(ev: SpendAlertEvent): void;
  list(opts?: {
    type?: string;
    wallet?: string;
    venueId?: string;
    since?: number;
    limit?: number;
  }): SpendAlertEvent[];
}

const MAX_ALERTS = 2_000;
const newAlertId = () =>
  `ev_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

function matchAlert(e: SpendAlertEvent, o: {
  type?: string; wallet?: string; venueId?: string; since?: number;
}): boolean {
  if (o.type && e.type !== o.type) return false;
  if (o.wallet && e.wallet.toLowerCase() !== o.wallet.toLowerCase())
    return false;
  if (o.venueId !== undefined && e.venueId !== o.venueId) return false;
  if (o.since !== undefined && e.at < o.since) return false;
  return true;
}

export function createMemorySpendAlertStore(): SpendAlertStore {
  const events: SpendAlertEvent[] = [];
  return {
    name: "memory",
    add(ev) {
      events.push(ev);
      if (events.length > MAX_ALERTS) events.splice(0, events.length - MAX_ALERTS);
    },
    list(opts = {}) {
      return events.filter((e) => matchAlert(e, opts))
        .sort((a, b) => b.at - a.at)
        .slice(0, opts.limit ?? 50);
    },
  };
}

const ALERTS_PATH = join(".data", "agent-wallet-alerts.json");

export function createJsonSpendAlertStore(
  path = ALERTS_PATH,
): SpendAlertStore {
  let events: SpendAlertEvent[] = [];
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, "utf-8"));
      if (Array.isArray(raw)) events = raw;
    } catch {
      /* corrupt → fresh */
    }
  }
  const persist = () => {
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(events.slice(-MAX_ALERTS)));
    } catch (e) {
      logger.warn("agent-wallet: alert store persist failed", {
        err: e instanceof Error ? e.message : String(e),
      });
    }
  };
  return {
    name: "json",
    add(ev) {
      events.push(ev);
      if (events.length > MAX_ALERTS) {
        events = events.slice(-MAX_ALERTS);
      }
      persist();
    },
    list(opts = {}) {
      return events.filter((e) => matchAlert(e, opts))
        .sort((a, b) => b.at - a.at)
        .slice(0, opts.limit ?? 50);
    },
  };
}

/* ----------------------------- emit path --------------------- */

export interface SpendAlertDeps {
  store: SpendAlertStore;
  /** Global alert webhook (AGENT_WALLET_ALERT_WEBHOOK_URL). */
  webhookUrl?: string;
  fetchFn?: typeof fetch;
  /** Injectable sleep — tests run instantly. */
  sleep?: (ms: number) => Promise<void>;
}

let alerts: SpendAlertDeps | null = null;

export function initSpendAlerts(deps: SpendAlertDeps | null): void {
  alerts = deps;
}

export function getSpendAlertStore(): SpendAlertStore | null {
  return alerts?.store ?? null;
}

export const ALERT_BACKOFF_MS = [1_000, 10_000, 60_000];

/** Fire an alert event: store + best-effort webhook w/ retry. */
export function emitSpendAlert(
  type: SpendAlertType,
  wallet: `0x${string}`,
  data: Record<string, unknown>,
  venueId?: string,
): SpendAlertEvent | null {
  if (!alerts) return null;
  const ev: SpendAlertEvent = {
    id: newAlertId(),
    type,
    wallet,
    ...(venueId ? { venueId } : {}),
    at: Date.now(),
    data,
  };
  alerts.store.add(ev);
  logger.warn("agent-wallet alert", { type, wallet, venueId, ...data });
  if (alerts.webhookUrl) {
    const fetcher = alerts.fetchFn ?? fetch;
    const sleep = alerts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
    const url = alerts.webhookUrl;
    void (async () => {
      for (const [i, wait] of [0, ...ALERT_BACKOFF_MS].entries()) {
        if (i > 0) await sleep(wait);
        try {
          const r = await fetcher(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event: type, ...ev }),
          });
          if (r.ok) return;
        } catch {
          /* retry */
        }
      }
      logger.warn("agent-wallet: alert webhook exhausted retries", { type, wallet });
    })();
  }
  return ev;
}

/* ------------------------- stale reserves -------------------- */

/** Reserved entries older than `staleMs` → spend.release_late
 *  (deduped by data.entryId). Returns newly emitted events.
 *  Async since SLICE-155-11 (db-backed ledger). */
export async function detectStaleReserves(opts: {
  ledger: SpendLedger;
  wallets: AgentWalletRecord[];
  staleMs: number;
  store?: SpendAlertStore;
  now?: number;
}): Promise<SpendAlertEvent[]> {
  const now = opts.now ?? Date.now();
  const store = opts.store ?? alerts?.store;
  if (!store) return [];
  const seen = new Set(
    store.list({ type: "spend.release_late", limit: MAX_ALERTS })
      .map((e) => e.data.entryId as string),
  );
  const out: SpendAlertEvent[] = [];
  for (const rec of opts.wallets) {
    if (!rec.active) continue;
    for (const e of await opts.ledger.listByWallet(rec.address)) {
      if (e.state !== "reserved") continue;
      if (now - e.at < opts.staleMs) continue;
      if (seen.has(e.id)) continue;
      const ev = emitSpendAlert(
        "spend.release_late",
        e.wallet,
        {
          entryId: e.id,
          amountUsd: e.amountUsd,
          kind: e.kind,
          refId: e.refId,
          ageMs: now - e.at,
        },
        rec.venueId,
      );
      if (ev) out.push(ev);
    }
  }
  return out;
}

/** Aggregate helper for stats endpoints — groups settled entries. */
export function aggregateSpend(entries: SpendEntry[]): {
  totalUsd: number;
  byKind: Record<string, number>;
  byAgent: Record<string, number>;
} {
  const byKind: Record<string, number> = {};
  const byAgent: Record<string, number> = {};
  let totalUsd = 0;
  for (const e of entries) {
    if (e.state !== "settled") continue;
    totalUsd += e.amountUsd;
    byKind[e.kind] = (byKind[e.kind] ?? 0) + e.amountUsd;
    byAgent[e.wallet.toLowerCase()] =
      (byAgent[e.wallet.toLowerCase()] ?? 0) + e.amountUsd;
  }
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    totalUsd: round(totalUsd),
    byKind: Object.fromEntries(
      Object.entries(byKind).map(([k, v]) => [k, round(v)]),
    ),
    byAgent: Object.fromEntries(
      Object.entries(byAgent).map(([k, v]) => [k, round(v)]),
    ),
  };
}
