/**
 * SLICE-173-2: signer health-gate — degraded-mode contract (AC4, D-173-4).
 *
 * signer down → paid route refuses 503 BEFORE payment is touched;
 * env backend (no ping) → gate is a no-op; free paths unaffected.
 */

import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { signerHealthGate } from "../src/server/middleware/signer-health";

function appWith(ping: (() => Promise<unknown>) | undefined) {
  const app = new Hono();
  let charged = 0;
  app.post(
    "/paid",
    signerHealthGate(ping),
    async (c, next) => {
      charged += 1; // payment middleware would settle here
      return next();
    },
    (c) => c.json({ ok: true, charged }),
  );
  app.get("/free", (c) => c.json({ ok: true }));
  return { app, charged: () => charged };
}

describe("signer health-gate", () => {
  it("signer down → 503 signer_unavailable, payment never runs", async () => {
    const ping = vi.fn(async () => {
      throw new Error("signer service unreachable");
    });
    const { app, charged } = appWith(ping);
    const res = await app.request("/paid", { method: "POST" });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("signer_unavailable");
    expect(charged()).toBe(0);
  });

  it("signer up → request proceeds to payment + handler", async () => {
    const ping = vi.fn(async () => ({ status: "ok" }));
    const { app, charged } = appWith(ping);
    const res = await app.request("/paid", { method: "POST" });
    expect(res.status).toBe(200);
    expect(ping).toHaveBeenCalledOnce();
    expect(charged()).toBe(1);
  });

  it("env backend (no ping wired) → gate is a no-op", async () => {
    const { app, charged } = appWith(undefined);
    const res = await app.request("/paid", { method: "POST" });
    expect(res.status).toBe(200);
    expect(charged()).toBe(1);
  });

  it("free routes never take the gate", async () => {
    const { app } = appWith(async () => {
      throw new Error("down");
    });
    const res = await app.request("/free");
    expect(res.status).toBe(200);
  });
});
