/**
 * SLICE-217-2: business stats section for the ops digest.
 *
 * Same window as the traffic digest (`since = now - hours`), read-only
 * `db.orm.public.*` queries, no new repositories (D-217-5). Counts/sums/
 * kinds/states only — never wallet, address or txHash (landmine).
 *
 * `RescueTelemetryEvent` is intentionally skipped: it exists only in
 * @agentbadge/database ≥0.6.2 (sibling source), while the installed
 * node_modules contract is 0.6.1 — add it after the package publish.
 */

import type { PrismaDb } from "@agentbadge/database";
import { param } from "@agentbadge/database";
import {
  aggregatePayLegs,
  type PayLegRow,
} from "./revenue-aggregate";

export type BusinessStats = {
  scans: number;
  spend: {
    total: number;
    amountUsd: number;
    byState: Record<string, number>;
    topKinds: [string, number][];
  };
  eaas: {
    requests: number;
    byStatus: Record<string, number>;
    verdicts: number;
    evalJobs: number;
  };
  ledger: { events: number; amountUsdc: number; byKind: Record<string, number> };
  bounties: { byStatus: Record<string, number>; claims: number };
  board: { cards: number; entries: number };
  a2a: { tasks: number; byStatus: Record<string, number> };
  /** SLICE-242-11: settled-pay rollup (counterparty=PAY_TO). null when
   *  payTo env unset or no pay legs in window — absent, never a fake 0. */
  x402Revenue?: {
    count: number;
    usdc: string;
    topEndpoints: { endpoint: string; count: number; usdc: string }[];
  } | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const sumValues = (by: Record<string, number>) =>
  Object.values(by).reduce((a, b) => a + b, 0);

function topKinds(byKind: Record<string, number>, n: number): [string, number][] {
  return Object.entries(byKind)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

type RawPlan = Parameters<ReturnType<PrismaDb["runtime"]>["query"]>[0];

/** Loose query result — raw rows are opaque; we only touch these keys. */
interface CountRow { c: unknown }
interface GroupRow { k: unknown; c: unknown }
interface AggRow { c: unknown; s: unknown }

const CNT_SPEC = { c: "pg/int4@1" } as const;
const GROUP_SPEC = {
  k: { codecId: "pg/text@1", nullable: true },
  c: "pg/int4@1",
} as const;
const AGG_SPEC = { c: "pg/int4@1", s: "pg/float8@1" } as const;
const LEG_SPEC = {
  kind: "pg/text@1",
  counterparty: { codecId: "pg/text@1", nullable: true },
  amountUsdc: { codecId: "pg/text@1", nullable: true },
  at: "pg/text@1",
  payload: "pg/json@1",
} as const;

/**
 * Pull business aggregates for `createdAt >= cutoffIso`.
 *
 * SLICE-234-2: no `.all()` — every group is a raw-SQL count/groupBy
 * against the table directly (contract ORM `where` is equality-only —
 * range predicates go through `db.raw` + `param`, econ-ledger
 * precedent). One failing query degrades that group to zeroes, never
 * throws — same degraded-zeroes contract as the old `safe()` scan.
 */
export async function collectBusinessStats(
  db: PrismaDb,
  cutoffIso: string,
  opts?: { payTo?: string },
): Promise<BusinessStats> {
  const stats: BusinessStats = {
    scans: 0,
    spend: { total: 0, amountUsd: 0, byState: {}, topKinds: [] },
    eaas: { requests: 0, byStatus: {}, verdicts: 0, evalJobs: 0 },
    ledger: { events: 0, amountUsdc: 0, byKind: {} },
    bounties: { byStatus: {}, claims: 0 },
    board: { cards: 0, entries: 0 },
    a2a: { tasks: 0, byStatus: {} },
  };

  const ts = () => param(cutoffIso, { codecId: "pg/timestamptz-string@1" });
  const num = async (plan: RawPlan): Promise<number> => {
    try {
      const rows = (await db.runtime().query(plan)) as CountRow[];
      return Number(rows[0]?.c ?? 0);
    } catch {
      return 0;
    }
  };
  const group = async (plan: RawPlan): Promise<Record<string, number>> => {
    try {
      const rows = (await db.runtime().query(plan)) as GroupRow[];
      const out: Record<string, number> = {};
      for (const r of rows) out[String(r.k ?? "unknown")] = Number(r.c ?? 0);
      return out;
    } catch {
      return {};
    }
  };
  const agg = async (plan: RawPlan): Promise<{ c: number; s: number }> => {
    try {
      const rows = (await db.runtime().query(plan)) as AggRow[];
      return { c: Number(rows[0]?.c ?? 0), s: Number(rows[0]?.s ?? 0) };
    } catch {
      return { c: 0, s: 0 };
    }
  };
  const legs = async (plan: RawPlan): Promise<PayLegRow[]> => {
    try {
      return (await db.runtime().query(plan)) as PayLegRow[];
    } catch {
      return [];
    }
  };

  const [scans, spendAgg, spendByState, spendByKind, eaasByStatus, verdicts, jobs, econAgg, econByKind, bountyByStatus, claims, cards, entries, a2aByStatus, payLegs] =
    await Promise.all([
      num(db.raw.sql`SELECT count(*)::int AS c FROM "scanResult" WHERE "createdAt" >= ${ts()}`.returnsRow(CNT_SPEC).build()),
      agg(db.raw.sql`SELECT count(*)::int AS c, coalesce(sum("amountUsd"),0)::float8 AS s FROM "spendEvent" WHERE "createdAt" >= ${ts()}`.returnsRow(AGG_SPEC).build()),
      group(db.raw.sql`SELECT "state" AS k, count(*)::int AS c FROM "spendEvent" WHERE "createdAt" >= ${ts()} GROUP BY "state"`.returnsRow(GROUP_SPEC).build()),
      group(db.raw.sql`SELECT "kind" AS k, count(*)::int AS c FROM "spendEvent" WHERE "createdAt" >= ${ts()} GROUP BY "kind"`.returnsRow(GROUP_SPEC).build()),
      group(db.raw.sql`SELECT "status" AS k, count(*)::int AS c FROM "eaasRequest" WHERE "createdAt" >= ${ts()} GROUP BY "status"`.returnsRow(GROUP_SPEC).build()),
      num(db.raw.sql`SELECT count(*)::int AS c FROM "eaasVerdict" WHERE "createdAt" >= ${ts()}`.returnsRow(CNT_SPEC).build()),
      num(db.raw.sql`SELECT count(*)::int AS c FROM "eaasEvalJob" WHERE "createdAt" >= ${ts()}`.returnsRow(CNT_SPEC).build()),
      agg(db.raw.sql`SELECT count(*)::int AS c, coalesce(sum("amountUsdc"),0)::float8 AS s FROM "economicEvent" WHERE "createdAt" >= ${ts()}`.returnsRow(AGG_SPEC).build()),
      group(db.raw.sql`SELECT "kind" AS k, count(*)::int AS c FROM "economicEvent" WHERE "createdAt" >= ${ts()} GROUP BY "kind"`.returnsRow(GROUP_SPEC).build()),
      group(db.raw.sql`SELECT "status" AS k, count(*)::int AS c FROM "bounty" WHERE "createdAt" >= ${ts()} GROUP BY "status"`.returnsRow(GROUP_SPEC).build()),
      num(db.raw.sql`SELECT count(*)::int AS c FROM "bountyClaim" WHERE "createdAt" >= ${ts()}`.returnsRow(CNT_SPEC).build()),
      num(db.raw.sql`SELECT count(*)::int AS c FROM "boardCard" WHERE "createdAt" >= ${ts()}`.returnsRow(CNT_SPEC).build()),
      num(db.raw.sql`SELECT count(*)::int AS c FROM "boardEntry" WHERE "createdAt" >= ${ts()}`.returnsRow(CNT_SPEC).build()),
      group(db.raw.sql`SELECT "status" AS k, count(*)::int AS c FROM "a2ATask" WHERE "createdAt" >= ${ts()} GROUP BY "status"`.returnsRow(GROUP_SPEC).build()),
      // x402 pay legs: same filters as the old client-side path —
      // createdAt >= cutoff (within()) AND at >= cutoff AND kind='pay'
      // AND counterparty=payTo (case-insensitive, ILIKE-equivalent via lower()).
      opts?.payTo
        ? legs(db.raw.sql`SELECT "kind","counterparty","amountUsdc"::text AS "amountUsdc","at","payload" FROM "economicEvent" WHERE "createdAt" >= ${ts()} AND "kind" = 'pay' AND "at" >= ${param(cutoffIso, { codecId: "pg/text@1" })} AND lower("counterparty") = ${param(opts.payTo.toLowerCase(), { codecId: "pg/text@1" })}`.returnsRow(LEG_SPEC).build())
        : Promise.resolve([] as PayLegRow[]),
    ]);

  stats.scans = scans;
  stats.spend = {
    total: spendAgg.c,
    amountUsd: round2(spendAgg.s),
    byState: spendByState,
    topKinds: topKinds(spendByKind, 3),
  };
  stats.eaas = {
    requests: sumValues(eaasByStatus),
    byStatus: eaasByStatus,
    verdicts,
    evalJobs: jobs,
  };
  stats.ledger = {
    events: econAgg.c,
    amountUsdc: round2(econAgg.s),
    byKind: econByKind,
  };
  stats.bounties = { byStatus: bountyByStatus, claims };
  stats.board = { cards, entries };
  stats.a2a = { tasks: sumValues(a2aByStatus), byStatus: a2aByStatus };

  if (opts?.payTo) {
    const roll = aggregatePayLegs(payLegs, { payTo: opts.payTo, since: cutoffIso });
    stats.x402Revenue =
      roll.total.count > 0
        ? {
          count: roll.total.count,
          usdc: roll.total.usdc,
          topEndpoints: roll.byEndpoint.slice(0, 3),
        }
        : null;
  }
  return stats;
}

export function businessIsEmpty(b: BusinessStats): boolean {
  return (
    b.scans === 0 &&
    b.spend.total === 0 &&
    b.eaas.requests === 0 &&
    b.eaas.verdicts === 0 &&
    b.eaas.evalJobs === 0 &&
    b.ledger.events === 0 &&
    b.bounties.claims === 0 &&
    Object.keys(b.bounties.byStatus).length === 0 &&
    b.board.cards === 0 &&
    b.board.entries === 0 &&
    b.a2a.tasks === 0 &&
    !(b.x402Revenue && b.x402Revenue.count > 0)
  );
}

const pairs = (by: Record<string, number>) =>
  Object.entries(by)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join(" ");

/** Plain-text section for reportText / tg-digest --dry-run. */
export function formatBusinessText(b: BusinessStats): string {
  if (businessIsEmpty(b)) return "Business: no activity in window";
  const lines = ["Business:"];
  lines.push(`  scans=${b.scans}`);
  if (b.spend.total > 0) {
    const kinds = b.spend.topKinds.map(([k, v]) => `${k}:${v}`).join(" ");
    lines.push(
      `  spend=${b.spend.total} ($${b.spend.amountUsd.toFixed(2)}) ${pairs(b.spend.byState)}` +
      (kinds ? ` kinds:${kinds}` : ""),
    );
  }
  if (b.eaas.requests > 0 || b.eaas.verdicts > 0)
    lines.push(`  eaas=${b.eaas.requests}req ${pairs(b.eaas.byStatus)} verdicts=${b.eaas.verdicts} eval=${b.eaas.evalJobs}`);
  if (b.ledger.events > 0)
    lines.push(`  ledger=${b.ledger.events} ($${b.ledger.amountUsdc.toFixed(2)}) ${pairs(b.ledger.byKind)}`);
  if (Object.keys(b.bounties.byStatus).length || b.bounties.claims > 0)
    lines.push(`  bounties=${pairs(b.bounties.byStatus)} claims=${b.bounties.claims}`);
  if (b.board.cards || b.board.entries) lines.push(`  board=cards:${b.board.cards} entries:${b.board.entries}`);
  if (b.a2a.tasks > 0) lines.push(`  a2a=${b.a2a.tasks} ${pairs(b.a2a.byStatus)}`);
  if (b.x402Revenue && b.x402Revenue.count > 0) {
    const tops = b.x402Revenue.topEndpoints
      .map((t) => `${t.endpoint}:$${t.usdc}`)
      .join(" ");
    lines.push(
      `  x402=$${b.x402Revenue.usdc} (${b.x402Revenue.count}pays)` +
      (tops ? ` top:${tops}` : ""),
    );
  }
  return lines.join("\n");
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** HTML section appended to the Telegram digest (escHtml'd, <pre>-safe). */
export function formatBusinessTelegram(b: BusinessStats): string {
  const body = businessIsEmpty(b)
    ? "no activity"
    : formatBusinessText(b).split("\n").slice(1).join("\n");
  return `💼 <b>Business</b>\n${esc(body)}`;
}
