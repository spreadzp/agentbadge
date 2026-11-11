/**
 * SLICE-217-6: buildExport core + privacy guard (EPIC-217, D-217-8).
 *
 * Window + filters → {json, caption, filename, data, rowCount, bytes}.
 * Shared by the weekly archive worker and every tg-export CLI — the
 * single place where "what may leave our perimeter" is decided.
 *
 * Privacy guard: http_traffic exports AGGREGATES ONLY (status/path/
 * client buckets, hourly, AI-crawler + src counters). Raw IPs and raw
 * UA strings never leave the contour — `raw:true` + http_traffic is a
 * hard error (ERR_RAW_IP_FORBIDDEN). forensics_edge rows are public
 * on-chain data → raw export allowed.
 */

import { gzipSync } from "node:zlib";

import { classifyUa, collectStats, type TrafficRow } from "./traffic-format";
import type { ArchiveWindow } from "./archive-window";

export const ERR_RAW_IP_FORBIDDEN = "ERR_RAW_IP_FORBIDDEN";
/** gzip when the serialized payload exceeds this many bytes. */
export const GZIP_THRESHOLD_BYTES = 200 * 1024;

export type ExportStream = "http_traffic" | "forensics_edge" | "event";

export type ExportFilters = {
  stream: ExportStream;
  /** event.type filter (event stream; narrows the paged scan). */
  type?: string;
  /** payload.status exact match (http_traffic). */
  status?: number;
  /** "/wp-*" wildcard → case-sensitive path match (http_traffic). */
  pathGlob?: string;
  /** UA-class bucket name from classifyUa, e.g. "GPTBot" (http_traffic). */
  client?: string;
  /** chain filter (forensics_edge). */
  chain?: string;
  /** Raw rows allowed only for forensics_edge (public on-chain data). */
  raw?: boolean;
};

export type ExportResult = {
  /** The pre-gzip JSON payload (aggregate or raw rows). */
  json: unknown;
  /** Final wire bytes — gzipped when payload > GZIP_THRESHOLD_BYTES. */
  data: Uint8Array;
  caption: string;
  filename: string;
  rowCount: number;
  bytes: number;
};

/** Minimal event store surface (Store.list paging contract). */
export interface ExportEventStore {
  list(opts: {
    type?: string;
    limit?: number;
    offset?: number;
  }): Promise<Array<{ type: string; payload?: Record<string, unknown> | null; createdAt: string }>>;
}

/** Minimal forensics surface — window scan injected by the caller. */
export interface ExportForensicsSource {
  scan(
    window: ArchiveWindow,
    opts?: { chain?: string },
  ): Promise<
    Array<{
      chain: string;
      txHash: string;
      payer: string;
      seller: string;
      amountAtomic: bigint;
      blockNumber: bigint;
      ts?: bigint;
      createdAt?: string;
    }>
  >;
}

export interface ExportDeps {
  events: ExportEventStore;
  forensics?: ExportForensicsSource;
}

const PAGE = 5000;

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** `*` wildcard → anchored case-sensitive regex (other chars escaped). */
export function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Paged window scan of `http_traffic` events — events.list is
 * newest-first, so paging stops once a row crosses `window.from`.
 */
export async function fetchTrafficRowsInWindow(
  events: ExportEventStore,
  w: ArchiveWindow,
): Promise<TrafficRow[]> {
  const rows: TrafficRow[] = [];
  let done = false;
  for (let offset = 0; !done; offset += PAGE) {
    const page = await events.list({ type: "http_traffic", limit: PAGE, offset });
    if (page.length === 0) break;
    for (const e of page) {
      const ts = Date.parse(e.createdAt);
      if (ts < w.from) {
        done = true;
        break;
      }
      if (ts < w.to) rows.push({ payload: e.payload ?? {}, createdAt: e.createdAt });
    }
    if (page.length < PAGE) break;
  }
  return rows;
}

const applyTrafficFilters = (
  rows: TrafficRow[],
  f: ExportFilters,
): TrafficRow[] => {
  const pathRe = f.pathGlob ? globToRegex(f.pathGlob) : null;
  return rows.filter(({ payload: p }) => {
    if (f.status !== undefined && p.status !== f.status) return false;
    if (pathRe && !pathRe.test(p.path ?? "")) return false;
    if (f.client !== undefined && classifyUa(p.ua) !== f.client) return false;
    return true;
  });
};

const mapToRecord = (m: Map<string, number>): Record<string, number> =>
  Object.fromEntries(m);

/** Aggregate http_traffic rows → privacy-safe JSON (no ip/ua keys). */
const trafficAggregate = (rows: TrafficRow[], w: ArchiveWindow) => {
  const hours = (w.to - w.from) / 3600_000;
  const s = collectStats(rows, hours);
  return {
    window: { from: new Date(w.from).toISOString(), to: new Date(w.to).toISOString() },
    total: s.total,
    byClass: mapToRecord(s.byClass),
    byClient: mapToRecord(s.byUaClass),
    byPath: mapToRecord(s.byPath),
    byClientPath: mapToRecord(s.byPathUa),
    errorTotal: s.errorTotal,
    errors: mapToRecord(s.errors),
    hourly: s.hourly,
    aiCrawlers: s.aiCrawlerBody,
    src: s.srcBody,
  };
};

async function eventAggregate(
  deps: ExportDeps,
  w: ArchiveWindow,
  f: ExportFilters,
): Promise<{ json: unknown; rowCount: number }> {
  const byType = new Map<string, number>();
  let rowCount = 0;
  let done = false;
  for (let offset = 0; !done; offset += PAGE) {
    const page = await deps.events.list({ type: f.type, limit: PAGE, offset });
    if (page.length === 0) break;
    for (const e of page) {
      const ts = Date.parse(e.createdAt);
      if (ts < w.from) {
        done = true;
        break;
      }
      if (ts < w.to) {
        rowCount++;
        byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
      }
    }
    if (page.length < PAGE) break;
  }
  return {
    json: {
      window: { from: new Date(w.from).toISOString(), to: new Date(w.to).toISOString() },
      total: rowCount,
      byType: mapToRecord(byType),
    },
    rowCount,
  };
}

const filenameStream = (stream: ExportStream) => stream.replace(/_/g, "-");

export async function buildExport(
  deps: ExportDeps,
  w: ArchiveWindow,
  f: ExportFilters,
): Promise<ExportResult> {
  // ── Privacy guard (D-217-8): http_traffic never exports raw rows ──
  if (f.stream === "http_traffic" && f.raw === true) {
    throw new Error(`${ERR_RAW_IP_FORBIDDEN}: raw http_traffic export is forbidden — IPs/UAs stay inside the contour`);
  }

  let json: unknown;
  let rowCount: number;

  switch (f.stream) {
    case "http_traffic": {
      const rows = applyTrafficFilters(
        await fetchTrafficRowsInWindow(deps.events, w),
        f,
      );
      json = trafficAggregate(rows, w);
      rowCount = rows.length;
      break;
    }
    case "forensics_edge": {
      if (!deps.forensics) {
        throw new Error("buildExport: forensics_edge requires deps.forensics.scan");
      }
      const edges = await deps.forensics.scan(w, { chain: f.chain });
      json = {
        window: { from: new Date(w.from).toISOString(), to: new Date(w.to).toISOString() },
        edges: edges.map((e) => ({
          chain: e.chain,
          txHash: e.txHash,
          payer: e.payer,
          seller: e.seller,
          amountAtomic: e.amountAtomic.toString(),
          blockNumber: e.blockNumber.toString(),
          ...(e.ts !== undefined ? { ts: e.ts.toString() } : {}),
          ...(e.createdAt !== undefined ? { createdAt: e.createdAt } : {}),
        })),
      };
      rowCount = edges.length;
      break;
    }
    case "event": {
      const r = await eventAggregate(deps, w, f);
      json = r.json;
      rowCount = r.rowCount;
      break;
    }
  }

  const plain = Buffer.from(JSON.stringify(json), "utf8");
  const gzipped = plain.byteLength > GZIP_THRESHOLD_BYTES;
  const data: Uint8Array = gzipped
    ? new Uint8Array(gzipSync(plain))
    : new Uint8Array(plain);

  const dates = `${isoDate(w.from)}_${isoDate(w.to)}`;
  const filename = `${filenameStream(f.stream)}_${dates}.json${gzipped ? ".gz" : ""}`;
  const caption = `#archive stream=${f.stream} ${isoDate(w.from)}..${isoDate(w.to)} rows=${rowCount}`;

  return { json, data, caption, filename, rowCount, bytes: data.byteLength };
}
