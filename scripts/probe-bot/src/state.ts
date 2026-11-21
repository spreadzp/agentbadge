/**
 * probe-state.db — bun:sqlite store (D-234-38-Q2, Q8).
 *
 * Per-machine state: `locus` (vantage point) is part of case_key —
 * the same case probed from another box is a different observation.
 * probe_case tracks "what is already verified" so runs hit only
 * new/failed/suspect/inconclusive cases (D-234-38-Q12: requeue is
 * manual — `probe requeue` flips a case back to 'new').
 */

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Endpoint, Source, Verdict } from "./types";

/** bun:sqlite is Bun-only — under node/vitest require throws → null
 *  (same pattern as src/server/lib/agent-wallet/approvals-sqlite.ts). */
type SqliteDatabase = InstanceType<typeof import("bun:sqlite").Database>;
const nodeRequire = createRequire(import.meta.url);
export function openBunSqlite(path: string): SqliteDatabase | null {
  try {
    const mod = nodeRequire("bun:sqlite") as typeof import("bun:sqlite");
    return new mod.Database(path);
  } catch {
    return null;
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_STATE_PATH = join(HERE, "..", "probe-state.db");

export function statePath(): string {
  return process.env.PROBE_STATE || DEFAULT_STATE_PATH;
}

export function locus(): string {
  return process.env.PROBE_LOCUS || "local";
}

/** Origin-нормализация target'а для case_key: trailing slash, case. */
export function targetOrigin(target: string): string {
  try {
    return new URL(target).origin;
  } catch {
    return target.replace(/\/+$/, "").toLowerCase();
  }
}

export function caseKey(input: {
  locus: string; target: string; endpoint: string; method: string;
  scenario: string; variantHash: string;
}): string {
  const raw = `${input.locus}|${targetOrigin(input.target)}|${input.endpoint}|${input.method}|${input.scenario}|${input.variantHash}`;
  return createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

export function variantHash(v: {
  method: string; path: string;
  headers?: Record<string, string>; body?: string;
  flow?: { steps: unknown };
}): string {
  const hdrs = Object.keys(v.headers ?? {}).sort().map(k => `${k}=${v.headers![k]}`).join(";");
  const steps = v.flow ? JSON.stringify(v.flow.steps) : "";
  return createHash("sha1").update(`${v.method}|${v.path}|${hdrs}|${v.body ?? ""}|${steps}`).digest("hex").slice(0, 12);
}

export interface CaseRow {
  case_key: string;
  endpoint: string;
  method: string;
  layer: string;
  scenario: string;
  variant_hash: string;
  expected_json: string;
  verdict: Verdict;
  first_run: string;
  last_run: string;
  last_status: number | null;
  request_id: string | null;
  locus: string;
  target: string;
  note: string;
}

export interface EndpointRow {
  path: string;
  method: string;
  source: Source;
  first_seen: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS probe_endpoint(
  path TEXT NOT NULL,
  method TEXT NOT NULL,
  source TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  PRIMARY KEY(path, method, source)
);
CREATE TABLE IF NOT EXISTS probe_case(
  case_key TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  layer TEXT NOT NULL,
  scenario TEXT NOT NULL,
  variant_hash TEXT NOT NULL,
  expected_json TEXT NOT NULL,
  verdict TEXT NOT NULL DEFAULT 'new',
  first_run TEXT,
  last_run TEXT,
  last_status INTEGER,
  request_id TEXT,
  locus TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_case_verdict ON probe_case(verdict);
CREATE INDEX IF NOT EXISTS idx_case_endpoint ON probe_case(endpoint);
CREATE TABLE IF NOT EXISTS probe_run(
  id TEXT PRIMARY KEY,
  started TEXT NOT NULL,
  ended TEXT,
  target TEXT NOT NULL,
  locus TEXT NOT NULL,
  layer TEXT NOT NULL,
  counts_json TEXT NOT NULL DEFAULT '{}',
  report_path TEXT
);
`;

export class ProbeState {
  readonly db: SqliteDatabase;

  private constructor(db: SqliteDatabase) {
    this.db = db;
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** Legacy-строки без target — все до этого были prod-прогонами:
   *  пересчитываем case_key с target=agentbadge.xyz. */
  private migrate(): void {
    const cols = this.db.query(`PRAGMA table_info(probe_case)`).all() as { name: string }[];
    if (cols.some(c => c.name === "target")) return;
    this.db.run(`ALTER TABLE probe_case ADD COLUMN target TEXT NOT NULL DEFAULT ''`);
    const rows = this.db.query(
      `SELECT case_key, endpoint, method, scenario, variant_hash, locus FROM probe_case`,
    ).all() as { case_key: string; endpoint: string; method: string; scenario: string; variant_hash: string; locus: string }[];
    const PROD = "https://agentbadge.xyz";
    for (const r of rows) {
      const nk = caseKey({
        locus: r.locus, target: PROD, endpoint: r.endpoint, method: r.method,
        scenario: r.scenario, variantHash: r.variant_hash,
      });
      this.db.run(`UPDATE probe_case SET case_key=?, target=? WHERE case_key=?`, [nk, PROD, r.case_key]);
    }
  }

  /** null под node/vitest — bun:sqlite недоступен. */
  static open(path = statePath()): ProbeState | null {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = openBunSqlite(path);
    return db ? new ProbeState(db) : null;
  }

  close() { this.db.close(); }

  // ---------- endpoints ----------

  upsertEndpoint(ep: Endpoint): void {
    this.db.run(
      `INSERT INTO probe_endpoint(path, method, source, first_seen)
       VALUES (?,?,?,?)
       ON CONFLICT(path, method, source) DO NOTHING`,
      [ep.path, ep.method, ep.source, new Date().toISOString()],
    );
  }

  listEndpoints(source?: Source): EndpointRow[] {
    const q = source
      ? this.db.query(`SELECT * FROM probe_endpoint WHERE source=? ORDER BY path`)
      : this.db.query(`SELECT * FROM probe_endpoint ORDER BY path`);
    return q.all(...(source ? [source] : [])) as EndpointRow[];
  }

  // ---------- cases ----------

  getCase(key: string): CaseRow | null {
    return (this.db.query(`SELECT * FROM probe_case WHERE case_key=?`).get(key) as CaseRow) ?? null;
  }

  /** Insert case stub if unknown; returns current verdict. */
  ensureCase(c: Omit<CaseRow, "verdict" | "first_run" | "last_run" | "last_status" | "request_id" | "note">): Verdict {
    const existing = this.getCase(c.case_key);
    if (existing) return existing.verdict;
    this.db.run(
      `INSERT INTO probe_case(case_key, endpoint, method, layer, scenario,
        variant_hash, expected_json, verdict, locus, target)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [c.case_key, c.endpoint, c.method, c.layer, c.scenario, c.variant_hash, c.expected_json, "new", c.locus, c.target],
    );
    return "new";
  }

  recordResult(key: string, r: {
    verdict: Verdict; status: number | null; requestId: string | null; note: string;
  }): void {
    const now = new Date().toISOString();
    this.db.run(
      `UPDATE probe_case SET verdict=?, last_run=?,
        first_run=COALESCE(first_run, ?), last_status=?, request_id=?, note=?
       WHERE case_key=?`,
      [r.verdict, now, now, r.status, r.requestId, r.note, key],
    );
  }

  requeue(match: string): number {
    const res = this.db.run(
      `UPDATE probe_case SET verdict='new', note=note||' | requeued'
       WHERE case_key=? OR endpoint LIKE ?`,
      [match, match.includes("%") ? match : `${match}%`],
    );
    return res.changes;
  }

  listCases(opts: { verdict?: Verdict; endpoint?: string; limit?: number } = {}): CaseRow[] {
    const where: string[] = [];
    const args: string[] = [];
    if (opts.verdict) { where.push("verdict=?"); args.push(opts.verdict); }
    if (opts.endpoint) { where.push("endpoint LIKE ?"); args.push(opts.endpoint); }
    const sql = `SELECT * FROM probe_case ${where.length ? "WHERE " + where.join(" AND ") : ""}
                 ORDER BY last_run DESC LIMIT ?`;
    return this.db.query(sql).all(...args, opts.limit ?? 200) as CaseRow[];
  }

  countsByVerdict(): Record<string, number> {
    const rows = this.db.query(`SELECT verdict, COUNT(*) c FROM probe_case GROUP BY verdict`).all() as { verdict: string; c: number }[];
    return Object.fromEntries(rows.map(r => [r.verdict, r.c]));
  }

  /** Сверка одного и того же кейса между target'ами (local↔prod):
   *  группирует по (endpoint,method,scenario,variant_hash,locus),
   *  возвращает только группы, где >1 target. */
  diffByTarget(): CaseRow[][] {
    const groups = this.db.query(
      `SELECT endpoint, method, scenario, variant_hash, locus
       FROM probe_case
       GROUP BY endpoint, method, scenario, variant_hash, locus
       HAVING COUNT(DISTINCT target) > 1`,
    ).all() as Pick<CaseRow, "endpoint" | "method" | "scenario" | "variant_hash" | "locus">[];
    return groups.map(g =>
      this.db.query(
        `SELECT * FROM probe_case
         WHERE endpoint=? AND method=? AND scenario=? AND variant_hash=? AND locus=?
         ORDER BY target`,
      ).all(g.endpoint, g.method, g.scenario, g.variant_hash, g.locus) as CaseRow[],
    );
  }

  // ---------- runs ----------

  startRun(r: { id: string; target: string; locus: string; layer: string }): void {
    this.db.run(
      `INSERT INTO probe_run(id, started, target, locus, layer) VALUES (?,?,?,?,?)`,
      [r.id, new Date().toISOString(), r.target, r.locus, r.layer],
    );
  }

  endRun(id: string, counts: Record<string, number>, reportPath?: string): void {
    this.db.run(
      `UPDATE probe_run SET ended=?, counts_json=?, report_path=? WHERE id=?`,
      [new Date().toISOString(), JSON.stringify(counts), reportPath ?? null, id],
    );
  }
}
