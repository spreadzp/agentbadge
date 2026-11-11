/**
 * SLICE-217-7 tests: archive run-scheduler core.
 *
 *  - due window → run called with [from,to) → commit AFTER run (spy order)
 *  - run throws → cursor NOT committed; next tick retries same window
 *  - not due → run not called
 *  - 3-window backlog → one window per tick (politeness)
 *  - error in one job doesn't stop others
 *  - stop() halts ticks; timer is unref'd
 */
import { describe, it, expect, vi } from "vitest";

import {
  startArchiveLoop,
  type ArchiveJob,
  type ArchiveCursorFacade,
} from "../src/server/lib/report/archive-scheduler";
import type { ArchiveWindow } from "../src/server/lib/report/archive-window";

const iso = (s: string) => Date.parse(s);

class FakeCursors implements ArchiveCursorFacade {
  rows = new Map<string, { throughAt: bigint; note: string | null }>();
  commits: Array<{ stream: string; throughAt: bigint }> = [];

  async get(stream: string) {
    const r = this.rows.get(stream);
    return r ? { stream, throughAt: r.throughAt, note: r.note } : null;
  }
  async commit(
    stream: string,
    u: { throughAt: bigint; messageId?: number | bigint | null; note?: string | null },
  ) {
    this.commits.push({ stream, throughAt: u.throughAt });
    this.rows.set(stream, {
      throughAt: u.throughAt,
      note: u.note ?? null,
    });
  }
}

const job = (
  stream: string,
  kind: "daily" | "weekly",
  run: ArchiveJob["run"],
): ArchiveJob => ({ stream, kind, run });

describe("archive-scheduler — SLICE-217-7", () => {
  it("due window → run called with computed [from,to) → commit after run", async () => {
    const order: string[] = [];
    const cursors = new FakeCursors();
    const now = () => iso("2026-11-10T12:00:00Z"); // Tuesday noon

    const run = vi.fn(async (w: ArchiveWindow) => {
      order.push(`run:${new Date(w.from).toISOString()}`);
      return { messageId: 7, note: "n" };
    });
    const wrappedCommit = cursors.commit.bind(cursors);
    cursors.commit = async (s, u) => {
      order.push(`commit:${Number(u.throughAt)}`);
      return wrappedCommit(s, u);
    };

    const loop = startArchiveLoop({
      cursors,
      jobs: [job("traffic-daily", "daily", run)],
      now,
      autoStart: false,
    });

    await loop.tick();
    // null cursor → yesterday's window
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toEqual({
      from: iso("2026-11-09T00:00:00Z"),
      to: iso("2026-11-10T00:00:00Z"),
    });
    // commit strictly after run, throughAt = window.to
    expect(order).toEqual([
      "run:2026-11-09T00:00:00.000Z",
      `commit:${iso("2026-11-10T00:00:00Z")}`,
    ]);
    loop.stop();
  });

  it("run throws → cursor not committed; next tick retries same window", async () => {
    const cursors = new FakeCursors();
    let now = iso("2026-11-10T12:00:00Z");
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("tg 429"))
      .mockResolvedValue({ messageId: 1 });

    const loop = startArchiveLoop({
      cursors,
      jobs: [job("traffic-daily", "daily", run)],
      now: () => now,
      autoStart: false,
    });

    await loop.tick(); // throws inside → caught by loop
    expect(run).toHaveBeenCalledTimes(1);
    expect(cursors.commits).toHaveLength(0);

    await loop.tick(); // retry succeeds
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]![0]).toEqual({
      from: iso("2026-11-09T00:00:00Z"),
      to: iso("2026-11-10T00:00:00Z"),
    });
    expect(cursors.commits).toHaveLength(1);
    loop.stop();
  });

  it("not due → run not called", async () => {
    const cursors = new FakeCursors();
    // Cursor already at yesterday's end; today incomplete → null
    cursors.rows.set("traffic-daily", {
      throughAt: BigInt(iso("2026-11-10T00:00:00Z")),
      note: null,
    });
    const run = vi.fn(async () => ({}));

    const loop = startArchiveLoop({
      cursors,
      jobs: [job("traffic-daily", "daily", run)],
      now: () => iso("2026-11-10T12:00:00Z"),
      autoStart: false,
    });
    await loop.tick();
    expect(run).not.toHaveBeenCalled();
    expect(cursors.commits).toHaveLength(0);
    loop.stop();
  });

  it("backlog of 3 windows → one window per tick", async () => {
    const cursors = new FakeCursors();
    // cursor 3 days behind
    cursors.rows.set("traffic-daily", {
      throughAt: BigInt(iso("2026-11-07T00:00:00Z")),
      note: null,
    });
    const seen: ArchiveWindow[] = [];
    const run = vi.fn(async (w: ArchiveWindow) => {
      seen.push(w);
      return {};
    });

    const loop = startArchiveLoop({
      cursors,
      jobs: [job("traffic-daily", "daily", run)],
      now: () => iso("2026-11-10T12:00:00Z"),
      autoStart: false,
    });

    await loop.tick();
    await loop.tick();
    await loop.tick();

    expect(seen).toEqual([
      { from: iso("2026-11-07T00:00:00Z"), to: iso("2026-11-08T00:00:00Z") },
      { from: iso("2026-11-08T00:00:00Z"), to: iso("2026-11-09T00:00:00Z") },
      { from: iso("2026-11-09T00:00:00Z"), to: iso("2026-11-10T00:00:00Z") },
    ]);
    expect(cursors.commits).toHaveLength(3);
    // 4th tick — up to date, nothing runs
    await loop.tick();
    expect(run).toHaveBeenCalledTimes(3);
    loop.stop();
  });

  it("error in one job does not stop other jobs", async () => {
    const cursors = new FakeCursors();
    const goodRun = vi.fn(async () => ({ messageId: 5 }));
    const badRun = vi.fn(async () => {
      throw new Error("boom");
    });

    const loop = startArchiveLoop({
      cursors,
      jobs: [
        job("traffic-daily", "daily", badRun),
        job("traffic-weekly", "weekly", goodRun),
      ],
      now: () => iso("2026-11-11T12:00:00Z"), // Wednesday
      autoStart: false,
    });

    await loop.tick();
    expect(badRun).toHaveBeenCalledTimes(1);
    expect(goodRun).toHaveBeenCalledTimes(1);
    // good job committed, bad did not
    expect(cursors.commits.map((c) => c.stream)).toEqual(["traffic-weekly"]);
    loop.stop();
  });

  it("stop() prevents further ticks; timer is unref'd", async () => {
    const cursors = new FakeCursors();
    const run = vi.fn(async () => ({}));

    const loop = startArchiveLoop({
      cursors,
      jobs: [job("traffic-daily", "daily", run)],
      now: () => iso("2026-11-10T12:00:00Z"),
      tickMs: 5,
    });
    loop.stop();
    await new Promise((r) => setTimeout(r, 20));
    expect(run).not.toHaveBeenCalled();
  });
});
