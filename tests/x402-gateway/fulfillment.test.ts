/**
 * SLICE-257-6: x402_fulfillment — seller-side outcome evidence.
 *
 * ACs: 2xx → handler_completed with usage/payment/request links;
 * 5xx|throw → upstream_error (response semantics unchanged);
 * no completion signal → unknown; emit failure → 200 + full event
 * in warn log + metric; replay dedupes; no usage row → requestId
 * fallback event (M-5); no counterparty → no trust edge.
 * 257-18: live stream → unknown/stream_aborted honestly; buffered 2xx
 * survives a late client drop (M-7); sync append throw replays (M-6).
 */
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  ARC_TESTNET_CAIP2,
  createPilotRegistry,
  type PersistedUsageRecord,
} from "@agentbadge/payments";
import { InMemoryEconLedgerStore, edgeDeltaOf } from "@agentbadge/database";
import type { EconomicEvent } from "@agentbadge/econ-events";
import { logger } from "@agentbadge/passport/logger";

import type { SettleSeamResult } from "../../src/server/lib/x402-settle-seam.js";
import { x402GatewayMiddleware } from "../../src/server/lib/x402-gateway/middleware.js";
import type { X402PaymentService } from "../../src/server/lib/x402-gateway/service.js";
import {
  emitX402Fulfillment,
  fulfillmentToEconomic,
  x402FulfillmentEmitFailedTotal,
  type FulfillmentLeg,
} from "../../src/server/lib/econ-ledger/x402-fulfillment.js";

const SEAM_RESULT: SettleSeamResult = {
  payer: "0x2222222222222222222222222222222222222222",
  amountAtomic: "100000",
  tx: "0xfeedbeef",
  sourceChain: ARC_TESTNET_CAIP2,
  scheme: "exact",
};

const USAGE: PersistedUsageRecord = {
  id: "ur_test123",
  paymentId: "0xfeedbeef",
  resource: "passport-request",
  requestId: "req_test",
  amount: "100000",
  currency: "USDC",
  network: ARC_TESTNET_CAIP2,
  payerAddress: SEAM_RESULT.payer,
  txHash: "0xfeedbeef",
  createdAtMs: 1,
};

const mkService = (
  over: Partial<X402PaymentService> = {},
): X402PaymentService => ({
  resolvePrice: async () => ({
    resourceId: "passport-request",
    priceUsd: "0.10",
    source: "registry",
    resolvedAt: new Date(),
  }),
  buildRequirements: () => ({
    amount: "100000",
    currency: "USDC",
    network: ARC_TESTNET_CAIP2,
    recipient: "0x742d35cc6634c0532925a3b844bc454e4438f44e",
    description: "d",
    resourceId: "passport-request",
  }),
  amountAtomicFor: (_r, priceUsd) =>
    priceUsd === "0.10" ? "100000" : "0",
  verifyAndSettle: async () => SEAM_RESULT,
  requestIdFor: () => "req_test",
  recordUsage: async () => USAGE,
  resolveAgentId: async () => null,
  ...over,
});

const PAID_PATH = "/api/v1/passport/request";

const mkApp = (
  service: X402PaymentService,
  handler: (c: import("hono").Context) => Response | Promise<Response>,
  emitFulfillment?: (leg: FulfillmentLeg) => void,
) => {
  const app = new Hono();
  app.use(
    "*",
    x402GatewayMiddleware({
      service,
      registry: createPilotRegistry(ARC_TESTNET_CAIP2),
      emitFulfillment,
    }),
  );
  app.post(PAID_PATH, handler);
  return app;
};

const paidRequest = (app: Hono) =>
  app.request(`http://x${PAID_PATH}`, {
    method: "POST",
    headers: { "payment-signature": "sig" },
  });

describe("x402_fulfillment emission (257-6)", () => {
  it("paid 2xx → handler_completed with usage/payment/request links", async () => {
    const legs: FulfillmentLeg[] = [];
    const res = await paidRequest(
      mkApp(
        mkService(),
        (c) => c.json({ ok: true }),
        (leg) => legs.push(leg),
      ),
    );
    expect(res.status).toBe(200);
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({
      outcome: "handler_completed",
      httpStatus: 200,
      usage: USAGE,
    });
  });

  it("handler 5xx → upstream_error, response unchanged", async () => {
    const legs: FulfillmentLeg[] = [];
    const res = await paidRequest(
      mkApp(
        mkService(),
        (c) => c.json({ err: true }, 500),
        (leg) => legs.push(leg),
      ),
    );
    expect(res.status).toBe(500);
    expect(legs[0].outcome).toBe("upstream_error");
    expect(legs[0].httpStatus).toBe(500);
  });

  it("thrown handler → upstream_error, throw still propagates", async () => {
    const legs: FulfillmentLeg[] = [];
    const res = await paidRequest(
      mkApp(
        mkService(),
        () => {
          throw new Error("handler boom");
        },
        (leg) => legs.push(leg),
      ),
    );
    expect(res.status).toBe(500); // Hono default error path intact
    expect(legs[0].outcome).toBe("upstream_error");
    expect(legs[0].httpStatus).toBe(500); // observed response status
  });

  it("no reliable completion signal (3xx) → unknown, never guessed", async () => {
    const legs: FulfillmentLeg[] = [];
    const res = await paidRequest(
      mkApp(
        mkService(),
        () => new Response(null, { status: 302 }),
        (leg) => legs.push(leg),
      ),
    );
    expect(res.status).toBe(302);
    expect(legs[0].outcome).toBe("unknown");
  });

  it("no usage record persisted → event keyed by requestId (M-5)", async () => {
    const legs: FulfillmentLeg[] = [];
    const res = await paidRequest(
      mkApp(
        mkService({ recordUsage: async () => null }),
        (c) => c.json({ ok: true }),
        (leg) => legs.push(leg),
      ),
    );
    expect(res.status).toBe(200);
    expect(legs).toHaveLength(1);
    expect(legs[0].usage).toBeNull();
    expect(legs[0].requestId).toBe("req_test");
    expect(legs[0].outcome).toBe("handler_completed");
  });

  it("NDJSON ReadableStream 200 → unknown, not handler_completed (H-8)", async () => {
    const legs: FulfillmentLeg[] = [];
    const stream = new ReadableStream({
      start(c) {
        c.enqueue('{"a":1}\n');
      },
    });
    const res = await paidRequest(
      mkApp(
        mkService(),
        () =>
          new Response(stream as BodyInit, {
            headers: { "content-type": "application/x-ndjson" },
          }),
        (leg) => legs.push(leg),
      ),
    );
    expect(res.status).toBe(200);
    expect(legs[0].outcome).toBe("unknown");
  });

  it("client drops after buffered 200 → handler_completed, not stream_aborted (M-7)", async () => {
    const legs: FulfillmentLeg[] = [];
    const app = mkApp(
      mkService(),
      (c) => c.json({ ok: true }),
      (leg) => legs.push(leg),
    );
    const ac = new AbortController();
    ac.abort(); // client gone — but the handler already materialized the body
    const res = await app.request(
      new Request(`http://x${PAID_PATH}`, {
        method: "POST",
        headers: { "payment-signature": "sig" },
        signal: ac.signal,
      }),
    );
    expect(res.status).toBe(200);
    expect(legs[0].outcome).toBe("handler_completed");
  });

  it("client drops mid-stream (SSE) → stream_aborted (M-7)", async () => {
    const legs: FulfillmentLeg[] = [];
    const app = mkApp(
      mkService(),
      () =>
        new Response(new ReadableStream({ start() {} }) as BodyInit, {
          headers: { "content-type": "text/event-stream" },
        }),
      (leg) => legs.push(leg),
    );
    const ac = new AbortController();
    ac.abort();
    const res = await app.request(
      new Request(`http://x${PAID_PATH}`, {
        method: "POST",
        headers: { "payment-signature": "sig" },
        signal: ac.signal,
      }),
    );
    expect(res.status).toBe(200);
    expect(legs[0].outcome).toBe("stream_aborted");
  });

  it("throwing emit seam → paid 200 survives (fire-and-forget)", async () => {
    const res = await paidRequest(
      mkApp(
        mkService(),
        (c) => c.json({ ok: true }),
        () => {
          throw new Error("emit boom");
        },
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("emitX402Fulfillment (257-6)", () => {
  const LEG: FulfillmentLeg = {
    usage: USAGE,
    outcome: "handler_completed",
    httpStatus: 200,
  };

  it("appends a parseable event with deterministic key", async () => {
    const ledger = new InMemoryEconLedgerStore();
    emitX402Fulfillment(LEG, ledger);
    await vi.waitFor(async () =>
      expect(await ledger.scan(0n)).toHaveLength(1),
    );
    const event = (await ledger.scan(0n))[0].event as EconomicEvent;
    expect(event).toMatchObject({
      source: "x402",
      sourceId: "ur_test123~fulfill",
      seq: 1,
      kind: "x402_fulfillment",
      idempotencyKey: "ev:x402:ur_test123~fulfill:1",
    });
    expect((event.payload as Record<string, unknown>).paymentId).toBe(
      "0xfeedbeef",
    );
  });

  it("dedupes on replay — same key, no second row", async () => {
    const ledger = new InMemoryEconLedgerStore();
    emitX402Fulfillment(LEG, ledger);
    emitX402Fulfillment(LEG, ledger);
    await vi.waitFor(async () =>
      expect((await ledger.scan(0n)).length).toBeGreaterThanOrEqual(1),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(await ledger.scan(0n)).toHaveLength(1);
  });

  it("synchronous append throw → full replay record still logged (M-6)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const counterValue = async () =>
      (await x402FulfillmentEmitFailedTotal.get()).values[0]?.value ?? 0;
    const before = await counterValue();
    const syncFailing = {
      append: () => {
        throw new Error("sync ledger boom");
      },
    } as unknown as InMemoryEconLedgerStore;
    emitX402Fulfillment(LEG, syncFailing);
    await vi.waitFor(async () =>
      expect(await counterValue()).toBe(before + 1),
    );
    const logged = warn.mock.calls.find(
      ([msg]) => typeof msg === "string" && msg.includes("replayable"),
    );
    expect(logged).toBeDefined();
    const ctx = logged![1] as { event?: EconomicEvent };
    expect(ctx.event?.idempotencyKey).toBe("ev:x402:ur_test123~fulfill:1");
    warn.mockRestore();
  });

  it("usage=null leg → event keyed by requestId (M-5)", async () => {
    const ledger = new InMemoryEconLedgerStore();
    emitX402Fulfillment(
      { usage: null, requestId: "req_fallback", outcome: "unknown", httpStatus: 200 },
      ledger,
    );
    await vi.waitFor(async () =>
      expect(await ledger.scan(0n)).toHaveLength(1),
    );
    const event = (await ledger.scan(0n))[0].event as EconomicEvent;
    expect(event.sourceId).toBe("req_fallback~fulfill");
    const payload = event.payload as Record<string, unknown>;
    expect(payload.usageRecordId).toBe("req_fallback");
    expect(payload.requestId).toBe("req_fallback");
    expect(payload.outcome).toBe("unknown");
  });

  it("append failure → warn log carries the FULL replayable event + metric", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const counterValue = async () =>
      (await x402FulfillmentEmitFailedTotal.get()).values[0]?.value ?? 0;
    const before = await counterValue();
    const failing = {
      append: () => Promise.reject(new Error("ledger down")),
    } as unknown as InMemoryEconLedgerStore;
    emitX402Fulfillment(LEG, failing);
    await vi.waitFor(async () =>
      expect(await counterValue()).toBe(before + 1),
    );
    const logged = warn.mock.calls.find(
      ([msg]) =>
        typeof msg === "string" && msg.includes("x402-fulfillment"),
    );
    expect(logged).toBeDefined();
    const ctx = logged![1] as { event?: EconomicEvent };
    expect(ctx.event?.idempotencyKey).toBe("ev:x402:ur_test123~fulfill:1");
    // the logged event IS the replay record — it appends verbatim
    const ledger = new InMemoryEconLedgerStore();
    await ledger.append([ctx.event!]);
    const replay = await ledger.append([ctx.event!]);
    expect(replay[0].duplicate).toBe(true);
    warn.mockRestore();
  });

  it("no counterparty/amount → edgeDeltaOf null (no trust edge)", () => {
    const event = fulfillmentToEconomic(LEG);
    expect(event.counterparty).toBeUndefined();
    expect(event.amountUsdc).toBeUndefined();
    expect(edgeDeltaOf(event, 1n)).toBeNull();
  });
});
