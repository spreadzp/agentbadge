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
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function countBy<T>(rows: T[], key: (r: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function topKinds(byKind: Record<string, number>, n: number): [string, number][] {
  return Object.entries(byKind)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

/** Loose row shape — orm rows are opaque models; we only touch these. */
interface BizRow {
  createdAt?: unknown;
  state?: unknown;
  status?: unknown;
  kind?: unknown;
  amountUsd?: unknown;
  amountUsdc?: unknown;
}

/**
 * Pull business aggregates for `createdAt >= cutoffIso`. Each model is
 * scanned with `.all()` and filtered client-side — same pattern as
 * forensics-edge-repository.listWindow; business volumes are far below
 * http_traffic (landmine: revisit with SQL count/groupBy if they grow).
 * A single model failure degrades that group to zeroes, never throws.
 */
export async function collectBusinessStats(
  db: PrismaDb,
  cutoffIso: string,
): Promise<BusinessStats> {
  const pub = db.orm.public;
  const within = (r: BizRow) => String(r.createdAt) >= cutoffIso;
  const stats: BusinessStats = {
    scans: 0,
    spend: { total: 0, amountUsd: 0, byState: {}, topKinds: [] },
    eaas: { requests: 0, byStatus: {}, verdicts: 0, evalJobs: 0 },
    ledger: { events: 0, amountUsdc: 0, byKind: {} },
    bounties: { byStatus: {}, claims: 0 },
    board: { cards: 0, entries: 0 },
    a2a: { tasks: 0, byStatus: {} },
  };

  // `.all()` yields AsyncIterableResult (thenable) — awaiting gives rows.
  const safe = async (fn: () => PromiseLike<unknown[]>): Promise<BizRow[]> => {
    try {
      return ((await fn()) as BizRow[]).filter(within);
    } catch {
      return [];
    }
  };

  const [scans, spends, reqs, verdicts, jobs, events, bounties, claims, cards, entries, tasks] =
    await Promise.all([
      safe(() => pub.ScanResult.all()),
      safe(() => pub.SpendEvent.all()),
      safe(() => pub.EaasRequest.all()),
      safe(() => pub.EaasVerdict.all()),
      safe(() => pub.EaasEvalJob.all()),
      safe(() => pub.EconomicEvent.all()),
      safe(() => pub.Bounty.all()),
      safe(() => pub.BountyClaim.all()),
      safe(() => pub.BoardCard.all()),
      safe(() => pub.BoardEntry.all()),
      safe(() => pub.A2ATask.all()),
    ]);

  stats.scans = scans.length;
  stats.spend = {
    total: spends.length,
    amountUsd: round2(spends.reduce((s, r) => s + Number(r.amountUsd ?? 0), 0)),
    byState: countBy(spends, (r) => String(r.state ?? "unknown")),
    topKinds: topKinds(countBy(spends, (r) => String(r.kind ?? "unknown")), 3),
  };
  stats.eaas = {
    requests: reqs.length,
    byStatus: countBy(reqs, (r) => String(r.status ?? "unknown")),
    verdicts: verdicts.length,
    evalJobs: jobs.length,
  };
  stats.ledger = {
    events: events.length,
    amountUsdc: round2(events.reduce((s, r) => s + Number(r.amountUsdc ?? 0), 0)),
    byKind: countBy(events, (r) => String(r.kind ?? "unknown")),
  };
  stats.bounties = {
    byStatus: countBy(bounties, (r) => String(r.status ?? "unknown")),
    claims: claims.length,
  };
  stats.board = { cards: cards.length, entries: entries.length };
  stats.a2a = {
    tasks: tasks.length,
    byStatus: countBy(tasks, (r) => String(r.status ?? "unknown")),
  };
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
    b.a2a.tasks === 0
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
