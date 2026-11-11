/**
 * SLICE-217-10 tests: tg-export CLI (ad-hoc filtered export).
 *
 *  - flag parsing: --to vs --to-inclusive, filters, send toggles
 *  - composition: fake store + fake sender → sendDocument args
 *  - --dry-run → sender untouched, summary printed
 *  - --no-send + --out → file written, TG untouched
 *  - exit codes: 2 missing flags/creds, 3 empty + --require-nonempty
 *  - ad-hoc never touches ArchiveCursor (landmine)
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseTgExportArgs,
  runTgExport,
  EXIT_OK,
  EXIT_USAGE,
  EXIT_EMPTY,
} from "../scripts/tg-export";
import type { TrafficRow } from "../src/server/lib/report/traffic-format";

const row = (p: Partial<TrafficRow["payload"]> = {}, createdAt = "2026-11-03T10:00:00Z"): TrafficRow => ({
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

const deps = (over: Record<string, unknown> = {}) => ({
  events: trafficEvents([row({ path: "/a" }), row({ path: "/b", status: 404 })]),
  sendDocument: vi.fn(async () => 42),
  writeFile: vi.fn(async () => {}),
  telegram: { token: "tok", chatId: "-100" },
  ...over,
});

describe("tg-export — SLICE-217-10", () => {
  it("parses flags: stream/from/to + filters + send toggles", () => {
    const a = parseTgExportArgs([
      "--stream", "http_traffic",
      "--from", "2026-11-01", "--to", "2026-11-05",
      "--status", "404", "--path-glob", "/wp-*",
      "--client", "GPTBot", "--send-to", "123",
      "--no-send", "--out", "f.json", "--dry-run", "--require-nonempty",
    ]);
    expect(a.stream).toBe("http_traffic");
    expect(a.status).toBe(404);
    expect(a.pathGlob).toBe("/wp-*");
    expect(a.client).toBe("GPTBot");
    expect(a.sendTo).toBe("123");
    expect(a.noSend).toBe(true);
    expect(a.out).toBe("f.json");
    expect(a.dryRun).toBe(true);
    expect(a.requireNonempty).toBe(true);
    // --to 2026-11-05 → exclusive start-of-day
    expect(a.window.to).toBe(Date.parse("2026-11-05T00:00:00Z"));
  });

  it("--to-inclusive adds one day to --to", () => {
    const a = parseTgExportArgs([
      "--stream", "http_traffic",
      "--from", "2026-11-01", "--to", "2026-11-05", "--to-inclusive",
    ]);
    expect(a.window.to).toBe(Date.parse("2026-11-06T00:00:00Z"));
  });

  it("missing --stream or --from/--to → EXIT_USAGE(2)", async () => {
    const d = deps();
    expect(await runTgExport(["--from", "2026-11-01", "--to", "2026-11-05"], d)).toBe(EXIT_USAGE);
    expect(await runTgExport(["--stream", "http_traffic"], d)).toBe(EXIT_USAGE);
    expect(d.sendDocument).not.toHaveBeenCalled();
  });

  it("composition: buildExport → sendDocument(filename, data, caption)", async () => {
    const d = deps();
    const code = await runTgExport(
      ["--stream", "http_traffic", "--from", "2026-11-01", "--to", "2026-11-05"],
      d,
    );
    expect(code).toBe(EXIT_OK);
    const [cfg, doc] = d.sendDocument.mock.calls[0]!;
    expect(cfg.chatId).toBe("-100");
    expect(doc.filename).toMatch(/^http-traffic_2026-11-01_2026-11-05\.json$/);
    expect(doc.caption).toContain("rows=2");
    expect(JSON.parse(Buffer.from(doc.data).toString("utf8")).total).toBe(2);
  });

  it("--send-to overrides chat id", async () => {
    const d = deps();
    await runTgExport(
      ["--stream", "http_traffic", "--from", "2026-11-01", "--to", "2026-11-05", "--send-to", "777"],
      d,
    );
    expect(d.sendDocument.mock.calls[0]![0].chatId).toBe("777");
  });

  it("--dry-run → no send, no write; returns OK", async () => {
    const d = deps();
    const code = await runTgExport(
      ["--stream", "http_traffic", "--from", "2026-11-01", "--to", "2026-11-05", "--dry-run"],
      d,
    );
    expect(code).toBe(EXIT_OK);
    expect(d.sendDocument).not.toHaveBeenCalled();
    expect(d.writeFile).not.toHaveBeenCalled();
  });

  it("--no-send + --out → file written with raw bytes, TG untouched", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tgexp-"));
    const out = join(dir, "out.json");
    const writes: Array<{ path: string; data: Uint8Array }> = [];
    const d = deps({
      writeFile: async (p: string, data: Uint8Array) => {
        writes.push({ path: p, data });
      },
    });
    const code = await runTgExport(
      ["--stream", "http_traffic", "--from", "2026-11-01", "--to", "2026-11-05", "--no-send", "--out", out],
      d,
    );
    expect(code).toBe(EXIT_OK);
    expect(d.sendDocument).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.path).toBe(out);
    expect(JSON.parse(Buffer.from(writes[0]!.data).toString("utf8")).total).toBe(2);
  });

  it("empty result + --require-nonempty → EXIT_EMPTY(3), no send", async () => {
    const d = deps({ events: trafficEvents([]) });
    const code = await runTgExport(
      ["--stream", "http_traffic", "--from", "2026-11-01", "--to", "2026-11-05", "--require-nonempty"],
      d,
    );
    expect(code).toBe(EXIT_EMPTY);
    expect(d.sendDocument).not.toHaveBeenCalled();
  });

  it("empty result without --require-nonempty → sends rows=0 doc (OK)", async () => {
    const d = deps({ events: trafficEvents([]) });
    const code = await runTgExport(
      ["--stream", "http_traffic", "--from", "2026-11-01", "--to", "2026-11-05"],
      d,
    );
    expect(code).toBe(EXIT_OK);
    expect(d.sendDocument.mock.calls[0]![1].caption).toContain("rows=0");
  });

  it("send without creds → EXIT_USAGE(2)", async () => {
    const d = deps({ telegram: undefined });
    const code = await runTgExport(
      ["--stream", "http_traffic", "--from", "2026-11-01", "--to", "2026-11-05"],
      d,
    );
    expect(code).toBe(EXIT_USAGE);
  });

  it("--no-send works without creds", async () => {
    const d = deps({ telegram: undefined });
    const code = await runTgExport(
      ["--stream", "http_traffic", "--from", "2026-11-01", "--to", "2026-11-05", "--no-send"],
      d,
    );
    expect(code).toBe(EXIT_OK);
  });

  it("forensics_edge uses deps.forensics.scan over the window", async () => {
    const scan = vi.fn(async () => [
      {
        chain: "5042",
        txHash: "0x1",
        payer: "0xp",
        seller: "0xs",
        amountAtomic: 1n,
        blockNumber: 9n,
        ts: 1_762_200_000n,
      },
    ]);
    const d = deps({ forensics: { scan } });
    const code = await runTgExport(
      ["--stream", "forensics_edge", "--from", "2026-11-01", "--to", "2026-11-05", "--chain", "5042", "--raw"],
      d,
    );
    expect(code).toBe(EXIT_OK);
    expect(scan).toHaveBeenCalledWith(
      { from: Date.parse("2026-11-01T00:00:00Z"), to: Date.parse("2026-11-05T00:00:00Z") },
      { chain: "5042" },
    );
  });
});
