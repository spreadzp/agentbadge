/**
 * SLICE-257-7: seller contour E2E — x402_fulfillment rows of the
 * advisor acceptance matrix, through the real middleware + real
 * emitter + real (in-memory) econ ledger.
 *
 * Rows: 5xx → upstream_error event; SSE stream without completion
 * signal → unknown (never upgraded); emit failure → paid response
 * unchanged + warn-log record replays verbatim and dedupes.
 */
import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import {
  ARC_TESTNET_CAIP2,
  createPilotRegistry,
  type PersistedUsageRecord,
} from "@agentbadge/payments";
import { InMemoryEconLedgerStore } from "@agentbadge/database";
import type { EconomicEvent } from "@agentbadge/econ-events";
import { logger } from "@agentbadge/passport/logger";

import type { SettleSeamResult } from "../../src/server/lib/x402-settle-seam.js";
import { x402GatewayMiddleware } from "../../src/server/lib/x402-gateway/middleware.js";
import type { X402PaymentService } from "../../src/server/lib/x402-gateway/service.js";
import { emitX402Fulfillment } from "../../src/server/lib/econ-ledger/x402-fulfillment.js";

const SEAM_RESULT: SettleSeamResult = {
  payer: "0x2222222222222222222222222222222222222222",
  amountAtomic: "100000",
  tx: "0xfeedbeef",
  sourceChain: ARC_TESTNET_CAIP2,
  scheme: "exact",
};

const USAGE: PersistedUsageRecord = {
  id: "ur_e2e1",
  paymentId: "0xfeedbeef",
  resource: "passport-request",
  requestId: "req_e2e",
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
  requestIdFor: () => "req_e2e",
  recordUsage: async () => USAGE,
  resolveAgentId: async () => null,
  ...over,
});

const mkApp = (
  handler: (c: import("hono").Context) => Response | Promise<Response>,
  ledger: InMemoryEconLedgerStore,
  service = mkService(),
) => {
  const app = new Hono();
  app.use(
    "*",
    x402GatewayMiddleware({
      service,
      registry: createPilotRegistry(ARC_TESTNET_CAIP2),
      emitFulfillment: (leg) => emitX402Fulfillment(leg, ledger),
    }),
  );
  app.post("/api/v1/passport/request", handler);
  return app;
};

const paidRequest = (app: Hono) =>
  app.request("http://x/api/v1/passport/request", {
    method: "POST",
    headers: { "payment-signature": "sig" },
  });

const outcomeOf = async (ledger: InMemoryEconLedgerStore) => {
  await vi.waitFor(async () =>
    expect((await ledger.scan(0n)).length).toBeGreaterThanOrEqual(1),
  );
  const rows = await ledger.scan(0n);
  return (rows[0].event as EconomicEvent).payload as {
    outcome: string;
    httpStatus?: number;
  };
};

describe("257-7 E2E acceptance — seller contour (fulfillment)", () => {
  it("handler 5xx → upstream_error event lands in the ledger", async () => {
    const ledger = new InMemoryEconLedgerStore();
    const res = await paidRequest(
      mkApp((c) => c.json({ err: true }, 500), ledger),
    );
    expect(res.status).toBe(500);
    const payload = await outcomeOf(ledger);
    expect(payload.outcome).toBe("upstream_error");
    expect(payload.httpStatus).toBe(500);
  });

  it("streaming response (SSE) without completion signal → unknown", async () => {
    const ledger = new InMemoryEconLedgerStore();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode("data: {}\n\n"));
        // deliberately left open — like the fx-delta keep-alive stream
      },
    });
    const res = await paidRequest(
      mkApp(
        () =>
          new Response(stream, {
            headers: { "content-type": "text/event-stream" },
          }),
        ledger,
      ),
    );
    expect(res.status).toBe(200);
    const payload = await outcomeOf(ledger);
    // headers(200) ≠ delivered stream — honest unknown, never upgraded
    expect(payload.outcome).toBe("unknown");
    expect(payload.httpStatus).toBe(200);
  });

  it("emit failure → paid 200 survives, warn-log event replays + dedupes", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const failing = {
      append: () => Promise.reject(new Error("ledger down")),
    } as unknown as InMemoryEconLedgerStore;
    const res = await paidRequest(
      mkApp((c) => c.json({ ok: true }), failing),
    );
    expect(res.status).toBe(200); // the client already paid — response must not break
    await vi.waitFor(() => expect(warn.mock.calls.length).toBeGreaterThan(0));
    const record = warn.mock.calls.find(([m]) =>
      String(m).includes("replayable"),
    );
    const event = (record![1] as { event: EconomicEvent }).event;
    // replay path: the logged event appends verbatim, re-append dedupes
    const ledger = new InMemoryEconLedgerStore();
    const first = await ledger.append([event]);
    const second = await ledger.append([event]);
    expect(first[0].duplicate).toBe(false);
    expect(second[0].duplicate).toBe(true);
    warn.mockRestore();
  });
});
