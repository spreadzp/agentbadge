/**
 * SLICE-217-8 + 217-9 tests: archive-workers wiring.
 *
 *  - daily job: rows → stats → format → sendMessage → {messageId, note}
 *  - weekly job: buildExport → sendDocument with filename/caption
 *  - oversized weekly (>45MB) → fallback alert message, cursor commit OK
 *  - no TG creds / db disabled → no jobs registered
 *  - in-memory cursor fallback when db.archiveCursors absent
 */
import { describe, it, expect, vi } from "vitest";

import {
  buildArchiveJobs,
  resolveArchiveCursors,
  InMemoryArchiveCursorFallback,
} from "../src/server/wiring/archive-workers";
import type { TrafficRow } from "../src/server/lib/report/traffic-format";

const W = { from: Date.parse("2026-11-09T00:00:00Z"), to: Date.parse("2026-11-10T00:00:00Z") };

const trafficEvents = (rows: TrafficRow[]) => ({
  async list(opts: { type?: string; limit?: number; offset?: number }) {
    const all = rows
      .filter(() => opts.type === "http_traffic")
      .map((r, i) => ({ type: "http_traffic", payload: r.payload, createdAt: r.createdAt, id: `t${i}` }));
    return all.slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? all.length));
  },
});

const row = (p: Partial<TrafficRow["payload"]>, createdAt = "2026-11-09T10:00:00Z"): TrafficRow => ({
  payload: { method: "GET", path: "/", status: 200, ...p },
  createdAt,
});

const tg = { token: "tok", chatId: "-100" };

describe("archive-workers — SLICE-217-8/9", () => {
  it("daily job: fetches window rows → stats → sendMessage → returns messageId+note", async () => {
    const sendMessage = vi.fn(async () => 77);
    const sendDocument = vi.fn(async () => 0);
    const jobs = buildArchiveJobs({
      events: trafficEvents([row({ path: "/a" }), row({ path: "/b" })]),
      telegram: tg,
      sendMessage,
      sendDocument,
    });

    const daily = jobs.find((j) => j.stream === "traffic-daily")!;
    expect(daily.kind).toBe("daily");
    const res = await daily.run(W);

    expect(res.messageId).toBe(77);
    expect(res.note).toContain("2");
    const [text, cfg] = sendMessage.mock.calls[0]!;
    expect(cfg).toEqual(tg);
    expect(text).toContain("AgentBadge traffic report");
    expect(text).toContain("2026-11-09"); // window dates, not "now"
  });

  it("weekly job: buildExport → sendDocument(filename, data, caption)", async () => {
    const sendMessage = vi.fn(async () => 0);
    const sendDocument = vi.fn(async () => 99);
    const jobs = buildArchiveJobs({
      events: trafficEvents([row({ path: "/x" }), row({ path: "/y" })]),
      telegram: tg,
      sendMessage,
      sendDocument,
    });

    const weekly = jobs.find((j) => j.stream === "traffic-weekly")!;
    expect(weekly.kind).toBe("weekly");
    const res = await weekly.run(W);

    expect(res.messageId).toBe(99);
    const [cfg, doc] = sendDocument.mock.calls[0]!;
    expect(cfg).toEqual(tg);
    expect(doc.filename).toMatch(/^http-traffic_2026-11-09_2026-11-10\.json$/);
    expect(doc.caption).toContain("#archive");
    expect(doc.caption).toContain("weekly");
    expect(doc.caption).toContain("rows=2");
    expect(JSON.parse(Buffer.from(doc.data).toString("utf8")).total).toBe(2);
  });

  it("oversized weekly → fallback alert message; returns messageId+oversized note (cursor commits)", async () => {
    const sendMessage = vi.fn(async () => 55);
    const sendDocument = vi.fn(async () => 0);
    const huge = Array.from({ length: 300 }, (_, i) =>
      row({ path: `/p${i}`, status: i % 5 ? 200 : 500 }),
    );
    const jobs = buildArchiveJobs({
      events: trafficEvents(huge),
      telegram: tg,
      sendMessage,
      sendDocument,
      oversizeBytes: 1, // force oversized path for the test
    });

    const weekly = jobs.find((j) => j.stream === "traffic-weekly")!;
    const res = await weekly.run(W);

    expect(sendDocument).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [alertText] = sendMessage.mock.calls[0]!;
    expect(alertText).toContain("oversized");
    expect(res.messageId).toBe(55);
    expect(res.note).toContain("oversized");
  });

  it("forensics-weekly: JSONL doc + per-chain counts in caption, own stream", async () => {
    const sendMessage = vi.fn(async () => 0);
    const sendDocument = vi.fn(async () => 66);
    const edge = (chain: string, txHash: string) => ({
      chain, txHash, payer: "0xp", seller: "0xs",
      amountAtomic: 1n, blockNumber: 9n, createdAt: "2026-11-05T00:00:00Z",
    });
    const jobs = buildArchiveJobs({
      events: trafficEvents([]),
      forensics: { scan: async () => [edge("5042", "0xa"), edge("5042", "0xb"), edge("5042002", "0xc")] },
      telegram: tg,
      sendMessage,
      sendDocument,
    });

    const fj = jobs.find((j) => j.stream === "forensics-weekly")!;
    expect(fj.kind).toBe("weekly");
    const res = await fj.run(W);
    expect(res.messageId).toBe(66);
    const [cfg, doc] = sendDocument.mock.calls[0]!;
    expect(cfg).toEqual(tg);
    expect(doc.filename).toMatch(/^forensics-edge_2026-11-09_2026-11-10\.jsonl$/);
    // JSONL: 3 lines = 3 edges
    const lines = Buffer.from(doc.data).toString("utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(() => lines.forEach((l) => JSON.parse(l))).not.toThrow();
    expect(doc.caption).toContain("edges=3");
    expect(doc.caption).toContain("5042:2");
    expect(doc.caption).toContain("5042002:1");
  });

  it("forensics-weekly absent without deps.forensics", () => {
    const jobs = buildArchiveJobs({
      events: trafficEvents([]),
      telegram: tg,
      sendMessage: vi.fn(),
      sendDocument: vi.fn(),
    });
    expect(jobs.map((j) => j.stream)).toEqual(["traffic-daily", "traffic-weekly"]);
  });

  it("no telegram creds → zero jobs", () => {
    const jobs = buildArchiveJobs({
      events: trafficEvents([]),
      telegram: undefined,
      sendMessage: vi.fn(),
      sendDocument: vi.fn(),
    });
    expect(jobs).toHaveLength(0);
  });

  it("resolveArchiveCursors: absent archiveCursors → in-memory fallback + warn", () => {
    const warn = vi.fn();
    const c = resolveArchiveCursors({} as never, warn);
    expect(c).toBeInstanceOf(InMemoryArchiveCursorFallback);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("archiveCursors"));
  });

  it("resolveArchiveCursors: present archiveCursors → adapts get/commit", async () => {
    const store = {
      getCursor: vi.fn(async () => ({ throughAt: 123n })),
      commitCursor: vi.fn(async () => {}),
    };
    const c = resolveArchiveCursors({ archiveCursors: store } as never, vi.fn());
    expect(await c.get("s")).toEqual({ throughAt: 123n });
    await c.commit("s", { throughAt: 5n, messageId: 9 });
    expect(store.commitCursor).toHaveBeenCalledWith("s", {
      throughAt: 5n,
      messageId: 9,
      note: null,
    });
  });

  it("InMemoryArchiveCursorFallback round-trips per stream", async () => {
    const c = new InMemoryArchiveCursorFallback();
    expect(await c.get("a")).toBeNull();
    await c.commit("a", { throughAt: 10n, messageId: 1 });
    expect((await c.get("a"))!.throughAt).toBe(10n);
    expect(await c.get("b")).toBeNull();
  });
});
