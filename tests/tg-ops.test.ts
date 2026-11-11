/**
 * SLICE-217-11 tests: tg-digest + tg-status CLI scripts.
 *
 *  - tg-digest: window → rows → stats → format → sendMessage
 *  - --no-send → digest text to stdout, sender untouched
 *  - tg-status: cursor table + next-due window per stream + row estimate
 *  - read-only: cursor commit never called
 */
import { describe, it, expect, vi } from "vitest";

import { runTgDigest, parseTgDigestArgs } from "../scripts/tg-digest";
import { runTgStatus, formatStatusTable } from "../scripts/tg-status";
import type { TrafficRow } from "../src/server/lib/report/traffic-format";

const row = (p: Partial<TrafficRow["payload"]> = {}, createdAt = "2026-11-09T10:00:00Z"): TrafficRow => ({
  payload: { method: "GET", path: "/a", status: 200, ...p },
  createdAt,
});

const trafficEvents = (rows: TrafficRow[]) => ({
  async list(opts: { type?: string; limit?: number; offset?: number }) {
    const all = rows
      .filter(() => opts.type === "http_traffic")
      .map((r, i) => ({ type: "http_traffic", payload: r.payload, createdAt: r.createdAt, id: `t${i}` }));
    return all.slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? all.length));
  },
});

const tg = { token: "tok", chatId: "-100" };

describe("tg-digest — SLICE-217-11", () => {
  it("parses --from/--to/--send-to/--no-send", () => {
    const a = parseTgDigestArgs([
      "--from", "2026-11-08", "--to", "2026-11-10",
      "--send-to", "777", "--no-send",
    ]);
    expect(a.window).toEqual({
      from: Date.parse("2026-11-08T00:00:00Z"),
      to: Date.parse("2026-11-10T00:00:00Z"),
    });
    expect(a.sendTo).toBe("777");
    expect(a.noSend).toBe(true);
  });

  it("composition: window rows → stats → formatTelegramReport → sendMessage", async () => {
    const sendMessage = vi.fn(async () => 88);
    const printed: string[] = [];
    const code = await runTgDigest(
      ["--from", "2026-11-08", "--to", "2026-11-10"],
      {
        events: trafficEvents([row({ path: "/x" }), row({ path: "/y" })]),
        telegram: tg,
        sendMessage,
        out: (m) => printed.push(m),
      },
    );
    expect(code).toBe(0);
    const [text, cfg] = sendMessage.mock.calls[0]!;
    expect(cfg).toEqual(tg);
    expect(text).toContain("AgentBadge traffic report");
    expect(text).toContain("2026-11-08"); // window dates
    expect(text).toContain("2026-11-10");
  });

  it("--no-send → prints digest, sender untouched", async () => {
    const sendMessage = vi.fn(async () => 0);
    const printed: string[] = [];
    const code = await runTgDigest(
      ["--from", "2026-11-08", "--to", "2026-11-10", "--no-send"],
      {
        events: trafficEvents([row({})]),
        sendMessage,
        out: (m) => printed.push(m),
      },
    );
    expect(code).toBe(0);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(printed.join("\n")).toContain("AgentBadge traffic report");
  });

  it("missing window → exit 2", async () => {
    const code = await runTgDigest(["--no-send"], {
      events: trafficEvents([]),
      sendMessage: vi.fn(),
      out: () => {},
    });
    expect(code).toBe(2);
  });
});

describe("tg-status — SLICE-217-11", () => {
  const cursors = {
    async get(stream: string) {
      const m: Record<string, { throughAt: bigint; note?: string | null; messageId?: number | null }> = {
        "traffic-daily": { throughAt: BigInt(Date.parse("2026-11-10T00:00:00Z")), messageId: 7, note: "12 rows" },
        "traffic-weekly": { throughAt: BigInt(Date.parse("2026-11-03T00:00:00Z")), messageId: 3 },
      };
      return m[stream] ?? null;
    },
    commit: vi.fn(),
  };

  it("prints cursor table + next-due windows + row estimate (read-only)", async () => {
    const lines: string[] = [];
    const now = Date.parse("2026-11-11T12:00:00Z");
    const code = await runTgStatus([], {
      cursors,
      events: trafficEvents([row({})]),
      streams: [
        { stream: "traffic-daily", kind: "daily" },
        { stream: "traffic-weekly", kind: "weekly" },
      ],
      now: () => now,
      out: (m) => lines.push(m),
    });
    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("traffic-daily");
    expect(text).toContain("traffic-weekly");
    // daily cursor at 11-10 → next window [11-10,11-11) is complete → due
    expect(text).toMatch(/traffic-daily.*due/i);
    // row estimate for the due window
    expect(text).toMatch(/rows/i);
    // read-only — commit never called
    expect(cursors.commit).not.toHaveBeenCalled();
  });

  it("no cursor → stream shows 'no cursor' + last completed window", async () => {
    const lines: string[] = [];
    const now = Date.parse("2026-11-11T12:00:00Z");
    await runTgStatus([], {
      cursors: { get: async () => null, commit: vi.fn() },
      events: trafficEvents([]),
      streams: [{ stream: "traffic-daily", kind: "daily" }],
      now: () => now,
      out: (m) => lines.push(m),
    });
    const text = lines.join("\n");
    expect(text).toContain("traffic-daily");
    expect(text).toMatch(/no cursor|seed/);
    // last completed daily window = 2026-11-10..2026-11-11
    expect(text).toContain("2026-11-10");
  });

  it("formatStatusTable renders due/next-due-per-window", () => {
    const s = formatStatusTable([
      {
        stream: "a",
        throughAt: "2026-11-10T00:00:00.000Z",
        messageId: "7",
        note: "12 rows",
        nextWindow: "2026-11-10..2026-11-11",
        due: "due",
        rows: 5,
      },
      {
        stream: "b",
        throughAt: "—",
        messageId: "—",
        note: "—",
        nextWindow: "2026-11-03..2026-11-10",
        due: "next due at 2026-11-17T00:00:00.000Z",
        rows: 0,
      },
    ]);
    expect(s).toContain("a");
    expect(s).toContain("due");
    expect(s).toContain("next due at");
    expect(s.split("\n").length).toBeGreaterThanOrEqual(3);
  });
});
