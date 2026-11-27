import { describe, expect, it } from "vitest";

import { createDbHealthTick } from "../src/server/services/db-health-watchdog";

/**
 * DB health watchdog — transition-alert state machine. Probes are faked;
 * `now` advances 30s per tick so the 15min "still down" repeat window is
 * reachable in-test.
 */

function mkHarness(healthSeq: Array<boolean | "throw">) {
  let t = 0;
  let i = 0;
  const sent: string[] = [];
  const tick = createDbHealthTick({
    health: async () => {
      const v = healthSeq[i++] ?? healthSeq[healthSeq.length - 1] ?? true;
      if (v === "throw") throw new Error("boom");
      return v;
    },
    send: async (text) => {
      sent.push(text);
    },
    now: () => (t += 30_000),
  });
  const run = async (n: number) => {
    for (let k = 0; k < n; k++) await tick();
  };
  return { sent, run };
}

describe("db-health-watchdog", () => {
  it("stays silent while healthy and on a single blip", async () => {
    const { sent, run } = mkHarness([true, false, true, true]);
    await run(4);
    expect(sent).toHaveLength(0);
  });

  it("alerts once on confirmed down, no spam while flapping-fail", async () => {
    const { sent, run } = mkHarness([false, false, false, false]);
    await run(4);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("DB unreachable");
    expect(sent[0]).toContain("🔴");
  });

  it("sends recovery notice after a down episode", async () => {
    const { sent, run } = mkHarness([false, false, false, true, true]);
    await run(5);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("DB recovered");
    expect(sent[1]).toContain("🟢");
  });

  it("repeats still-down notice after the repeat window, not before", async () => {
    const { sent, run } = mkHarness(Array(40).fill(false));
    await run(31); // t=930s — inside the 15min repeat window (last alert t=60s)
    expect(sent).toHaveLength(1);
    await run(2); // t=990s — past the window
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("DB still down");
  });

  it("treats a throwing probe as failure and survives send failures", async () => {
    let t = 0;
    let i = 0;
    const sent: string[] = [];
    const seq: Array<boolean | "throw"> = ["throw", "throw", true];
    const tick = createDbHealthTick({
      health: async () => {
        const v = seq[i++] ?? true;
        if (v === "throw") throw new Error("boom");
        return v;
      },
      send: async () => {
        sent.push("x");
        throw new Error("tg down");
      },
      now: () => (t += 30_000),
    });
    await tick();
    await tick(); // 2 fails → alert (send throws, swallowed)
    await tick(); // recovery → send throws again
    expect(sent).toHaveLength(2);
  });

  it("works without a send fn (log-only transitions)", async () => {
    let i = 0;
    const seq = [false, false];
    const tick = createDbHealthTick({
      health: async () => seq[i++] ?? true,
      logger: { info: () => {}, warn: () => {} },
    });
    await tick();
    await tick(); // must not throw
  });
});
