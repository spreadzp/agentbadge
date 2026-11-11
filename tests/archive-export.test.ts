/**
 * SLICE-217-6 tests: buildExport core + privacy guard.
 *
 *  - http_traffic + raw:true → throw ERR_RAW_IP_FORBIDDEN (privacy)
 *  - aggregates never contain raw ip/ua keys (recursive key scan)
 *  - pathGlob wildcard filter
 *  - status / client filters
 *  - gzip threshold: small → plain .json, big → .json.gz
 *  - caption format "#archive stream=… dates rows=N"
 *  - empty window → rows=0, valid export
 *  - forensics_edge raw rows allowed (public on-chain data)
 */
import { describe, it, expect } from "vitest";
import { gunzipSync } from "node:zlib";

import {
  buildExport,
  ERR_RAW_IP_FORBIDDEN,
} from "../src/server/lib/report/archive-export";
import type { TrafficRow } from "../src/server/lib/report/traffic-format";

const W = { from: Date.parse("2026-11-03T00:00:00Z"), to: Date.parse("2026-11-10T00:00:00Z") };

const row = (p: Partial<TrafficRow["payload"]>, createdAt = "2026-11-05T10:00:00Z"): TrafficRow => ({
  payload: { method: "GET", path: "/", status: 200, ...p },
  createdAt,
});

/** In-memory event facade matching the events.list paging contract. */
const trafficEvents = (rows: TrafficRow[]) => ({
  async list(opts: { type?: string; limit?: number; offset?: number }) {
    const all = rows
      .map((r, i) => ({ type: "http_traffic", payload: r.payload, createdAt: r.createdAt, id: `t${i}` }))
      .filter(() => opts.type === "http_traffic");
    return all.slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? all.length));
  },
});

/** Recursively collect every key in a JSON structure. */
const allKeys = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) for (const x of v) allKeys(x, out);
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      allKeys(x, out);
    }
  }
  return out;
};

describe("buildExport — SLICE-217-6", () => {
  it("http_traffic + raw:true → ERR_RAW_IP_FORBIDDEN (privacy guard)", async () => {
    await expect(
      buildExport({ events: trafficEvents([]) }, W, { stream: "http_traffic", raw: true }),
    ).rejects.toThrow(ERR_RAW_IP_FORBIDDEN);
  });

  it("http_traffic aggregates contain no ip/ua/user-agent keys", async () => {
    const res = await buildExport(
      { events: trafficEvents([row({ ip: "1.2.3.4", ua: "Mozilla/5.0 Safari", path: "/a" })]) },
      W,
      { stream: "http_traffic" },
    );
    const keys = allKeys(res.json).map((k) => k.toLowerCase());
    for (const k of keys) {
      expect(k).not.toMatch(/ip|user-agent|^ua$/);
    }
    // raw UA string must not appear anywhere in the serialized export
    expect(JSON.stringify(res.json)).not.toContain("Mozilla");
    expect(JSON.stringify(res.json)).not.toContain("1.2.3.4");
    expect(res.rowCount).toBe(1);
  });

  it("pathGlob /wp-* matches wp paths only (case-sensitive)", async () => {
    const res = await buildExport(
      {
        events: trafficEvents([
          row({ path: "/wp-login.php" }),
          row({ path: "/wp-admin/x" }),
          row({ path: "/api/health" }),
          row({ path: "/WP-fake" }),
        ]),
      },
      W,
      { stream: "http_traffic", pathGlob: "/wp-*" },
    );
    expect(res.rowCount).toBe(2);
    const json = JSON.stringify(res.json);
    expect(json).toContain("/wp-login.php");
    expect(json).not.toContain("/api/health");
    expect(json).not.toContain("/WP-fake");
  });

  it("status and client filters apply to source rows", async () => {
    const res = await buildExport(
      {
        events: trafficEvents([
          row({ status: 404, ua: "GPTBot/1.0" }),
          row({ status: 200, ua: "GPTBot/1.0" }),
          row({ status: 404, ua: "Mozilla/5.0" }),
        ]),
      },
      W,
      { stream: "http_traffic", status: 404, client: "GPTBot" },
    );
    expect(res.rowCount).toBe(1);
  });

  it("small export → .json plain; >200KB → .json.gz with valid gzip", async () => {
    const small = await buildExport(
      { events: trafficEvents([row({ path: "/x" })]) },
      W,
      { stream: "http_traffic" },
    );
    expect(small.filename).toMatch(/^http-traffic_2026-11-03_2026-11-10\.json$/);
    expect(small.data).toBeInstanceOf(Uint8Array);
    expect(() => JSON.parse(Buffer.from(small.data).toString("utf8"))).not.toThrow();

    const many = Array.from({ length: 4000 }, (_, i) =>
      row({ path: `/long-path-segment-${i}/with-padding-to-inflate-payload` }),
    );
    const big = await buildExport(
      { events: trafficEvents(many) },
      W,
      { stream: "http_traffic" },
    );
    expect(big.filename).toMatch(/\.json\.gz$/);
    const plain = gunzipSync(Buffer.from(big.data)).toString("utf8");
    expect(() => JSON.parse(plain)).not.toThrow();
    expect(big.bytes).toBe(big.data.byteLength);
    expect(big.rowCount).toBe(4000);
  });

  it("caption carries #archive tag, stream, window dates, rows", async () => {
    const res = await buildExport(
      { events: trafficEvents([row({}), row({})]) },
      W,
      { stream: "http_traffic" },
    );
    expect(res.caption).toBe(
      "#archive stream=http_traffic 2026-11-03..2026-11-10 rows=2",
    );
  });

  it("empty window → rows=0 valid export (no throw)", async () => {
    const res = await buildExport(
      { events: trafficEvents([]) },
      W,
      { stream: "http_traffic" },
    );
    expect(res.rowCount).toBe(0);
    expect(res.caption).toContain("rows=0");
    expect(res.filename).toMatch(/\.json$/);
  });

  it("forensics_edge → raw rows exported (public on-chain data)", async () => {
    const edge = {
      id: "e1",
      chain: "5042",
      payer: "0xAAA",
      seller: "0xBBB",
      amountAtomic: 1_000_000n,
      txHash: "0xtx1",
      blockNumber: 100n,
      source: "chain",
      ts: 1_762_700_000n,
      createdAt: "2026-11-05T10:00:00Z",
    };
    const forensics = { scan: async () => [edge] };
    const res = await buildExport(
      { events: trafficEvents([]), forensics },
      W,
      { stream: "forensics_edge", raw: true, chain: "5042" },
    );
    expect(res.rowCount).toBe(1);
    const parsed = JSON.parse(Buffer.from(res.data).toString("utf8")) as {
      edges: Array<{ payer: string; txHash: string }>;
    };
    expect(parsed.edges[0]!.payer).toBe("0xAAA");
    expect(parsed.edges[0]!.txHash).toBe("0xtx1");
  });

  it("forensics_edge without scan dep → throws", async () => {
    await expect(
      buildExport({ events: trafficEvents([]) }, W, { stream: "forensics_edge" }),
    ).rejects.toThrow();
  });

  it("event stream aggregates by type", async () => {
    const events = {
      async list(opts: { type?: string; limit?: number; offset?: number }) {
        const all = [
          { type: "x402_paid", payload: { v: 1 }, createdAt: "2026-11-05T10:00:00Z", id: "a" },
          { type: "x402_paid", payload: { v: 2 }, createdAt: "2026-11-05T11:00:00Z", id: "b" },
          { type: "other", payload: {}, createdAt: "2026-11-05T12:00:00Z", id: "c" },
        ].filter((e) => !opts.type || e.type === opts.type);
        return all.slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? all.length));
      },
    };
    const res = await buildExport({ events }, W, { stream: "event", type: "x402_paid" });
    expect(res.rowCount).toBe(2);
    const parsed = JSON.parse(Buffer.from(res.data).toString("utf8")) as {
      byType: Record<string, number>;
    };
    expect(parsed.byType["x402_paid"]).toBe(2);
  });
});
