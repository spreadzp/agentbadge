/**
 * SLICE-156-5: GET /api/pay/gateway/transfers/:id — buyer-facing status.
 * No auth (payer knows their own transfer id); local store first, then
 * Gateway transfers-API fallback. Expired ⇒ automatic source refund.
 */
import { describe, it, expect, vi } from "vitest";
import type { PaymentInfo, PaymentStatus } from "@agentbadge/circle-payments";
import { createGatewayDepositRoutes } from "../src/server/routes/pay-gateway";
import {
  createCrosschainPaymentsStore,
  recordPayment,
} from "../src/server/lib/crosschain-payments";
import type { CirclePaymentsConfig } from "../src/config/env";

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const PAYTO = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;

const cfg = {
  gatewayMinDepositUsd: "0.10",
  arcMainnet: false,
} as unknown as CirclePaymentsConfig;

const pmt = (over: Partial<PaymentInfo> = {}): PaymentInfo =>
  ({
    payer: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    network: "eip155:84532",
    scheme: "gateway-batch",
    amount: "5000000",
    transaction: UUID,
    ...over,
  }) as PaymentInfo;

const seed = () => {
  const store = createCrosschainPaymentsStore();
  recordPayment(store, pmt(), "/api/venue/v1/subscribe", PAYTO, 60_000);
  return store;
};

describe("GET /api/pay/gateway/transfers/:id", () => {
  it("known transfer → local state + terminal + refund semantics", async () => {
    const store = seed();
    store.update(UUID, { state: "expired" });
    const app = createGatewayDepositRoutes(cfg, { store });
    const res = await app.request(`/api/pay/gateway/transfers/${UUID}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: UUID,
      state: "expired",
      terminal: true,
      refund: "automatic-on-expiry",
      sourceChain: "eip155:84532",
      scheme: "gateway-batch",
      amountUsd: "5.00",
    });
  });

  it("non-terminal local entry → terminal:false, no refund note", async () => {
    const app = createGatewayDepositRoutes(cfg, { store: seed() });
    const res = await app.request(`/api/pay/gateway/transfers/${UUID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe("settling");
    expect(body.terminal).toBe(false);
    expect(body.refund).toBeNull();
  });

  it("unknown locally → upstream statusLookup fallback", async () => {
    const statusLookup = vi.fn(
      async (ref: string): Promise<PaymentStatus> => ({
        status: "pending",
        ref,
        refType: "gateway-transfer",
      }),
    );
    const app = createGatewayDepositRoutes(cfg, {
      store: createCrosschainPaymentsStore(),
      statusLookup,
    });
    const res = await app.request(`/api/pay/gateway/transfers/${UUID}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: UUID, status: "pending" });
    expect(statusLookup).toHaveBeenCalledWith(UUID);
  });

  it("unknown transfer + lookup throws → 404", async () => {
    const app = createGatewayDepositRoutes(cfg, {
      store: createCrosschainPaymentsStore(),
      statusLookup: async () => {
        throw new Error("not found");
      },
    });
    const res = await app.request(`/api/pay/gateway/transfers/${UUID}`);
    expect(res.status).toBe(404);
  });

  it("no deps → 404", async () => {
    const app = createGatewayDepositRoutes(cfg);
    const res = await app.request(`/api/pay/gateway/transfers/${UUID}`);
    expect(res.status).toBe(404);
  });
});
