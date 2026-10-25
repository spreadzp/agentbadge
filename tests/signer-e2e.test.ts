/**
 * EPIC-173 (SLICE-173-4): e2e — service-down + env-clean + alert.
 *
 * 1. signer down → paid route 503 BEFORE payment runs (no x402
 *    settlement taken); free route keeps serving; operator alert
 *    fires once per cooldown, never breaks the refusal, and recovers.
 * 2. API-process env is clean — start-with-signer.sh strips the money
 *    key from the API child; the test scans a seeded env the same way
 *    the supervisor does (env -u) and asserts only VERDICT/OPS remain.
 *
 * Anchor pending→catch-up on recovery is covered by the anchor-queue
 * tests (anchors use the ops key, unaffected by a settle-signer outage).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { signerHealthGate } from "../src/server/middleware/signer-health";
import { createSignerDownNotifier } from "../src/server/lib/eaas/signer-alerts";

function appWith(ping: () => Promise<unknown>, onDown?: (e: Error) => void) {
  const app = new Hono();
  let charged = 0;
  app.post(
    "/paid",
    signerHealthGate(ping, onDown ? { onDown } : {}),
    async (c, next) => {
      charged += 1; // x402 verify+settle would run here
      return next();
    },
    (c) => c.json({ ok: true, charged }),
  );
  app.get("/free", (c) => c.json({ ok: true }));
  return { app, charged: () => charged };
}

describe("e2e: signer service down → refuse before charge + alert", () => {
  it("503 before payment, free route serves, onDown fires, recovery heals", async () => {
    let alive = false;
    const ping = vi.fn(async () => {
      if (!alive) throw new Error("signer service unreachable");
      return { status: "ok" };
    });
    const onDown = vi.fn();
    const { app, charged } = appWith(ping, onDown);

    const res = await app.request("/paid", { method: "POST" });
    expect(res.status).toBe(503);
    expect((await res.json() as { error: string }).error).toBe("signer_unavailable");
    expect(charged()).toBe(0); // x402 settlement never ran
    expect(onDown).toHaveBeenCalledOnce();

    const free = await app.request("/free");
    expect(free.status).toBe(200);

    // operator restarts the service → paid route heals without a code change
    alive = true;
    const healed = await app.request("/paid", { method: "POST" });
    expect(healed.status).toBe(200);
    expect(charged()).toBe(1);
  });

  it("notifier throttles alerts per cooldown and swallows channel errors", async () => {
    const send = vi.fn(async (_message: string) => { });
    let t = 1_000;
    const notify = createSignerDownNotifier({
      cooldownMs: 60_000,
      now: () => t,
      send,
    });
    await notify(new Error("down-1"));
    await notify(new Error("down-2")); // inside cooldown — suppressed
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toContain("down-1");
    t += 61_000;
    await notify(new Error("down-3")); // cooldown elapsed — new alert
    expect(send).toHaveBeenCalledTimes(2);

    const failing = createSignerDownNotifier({
      now: () => 0,
      send: async () => {
        throw new Error("webhook down");
      },
    });
    await expect(failing(new Error("x"))).resolves.toBeUndefined();
  });
});

describe("e2e: API-process env is clean (money key absent)", () => {
  it("env -u strip leaves only VERDICT/OPS authorities", () => {
    const seeded = {
      PATH: process.env.PATH ?? "/usr/bin",
      ARC_SETTLE_KEY: "0x" + "11".repeat(32),
      SIGNER_KEY: "0x" + "22".repeat(32),
      ARC_OPS_KEY: "0x" + "33".repeat(32),
      ARC_VERDICT_SIGNER_KEY: "0x" + "44".repeat(32),
    };
    // Same strip the supervisor applies to the API child.
    const out = execFileSync(
      "env",
      ["-u", "ARC_SETTLE_KEY", "-u", "SIGNER_KEY", "env"],
      { env: seeded, encoding: "utf8" },
    );
    const names = new Set(out.split("\n").map((l) => l.split("=")[0]));
    expect(names.has("ARC_SETTLE_KEY")).toBe(false);
    expect(names.has("SIGNER_KEY")).toBe(false);
    expect(names.has("ARC_OPS_KEY")).toBe(true);
    expect(names.has("ARC_VERDICT_SIGNER_KEY")).toBe(true);
  });

  it("start-with-signer.sh strips both money-key names from the API child", () => {
    const script = readFileSync("scripts/start-with-signer.sh", "utf8");
    for (const name of ["ARC_SETTLE_KEY", "SIGNER_KEY"]) {
      expect(script).toContain(`-u ${name}`);
    }
  });
});
