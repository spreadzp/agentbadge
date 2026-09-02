import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import {
  baseX402PaymentMiddleware,
  type X402FacilitatorClient,
} from "../../src/server/middleware/x402-base";

const TEST_CFG = {
  facilitatorUrl: "https://x402.example.com/facilitator",
  payTo: "0xtreasury1234567890123456789012345678901234567",
  usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  networkId: "eip155:84532",
  price: "1000000", // 1 USDC
  description: "Agent Passport NFT issuance",
  mimeType: "application/json",
};

function mockFacilitator(): X402FacilitatorClient {
  return {
    verify: vi.fn().mockResolvedValue({ valid: true }),
    settle: vi.fn().mockResolvedValue({ success: true, transaction: "0xsettlement123" }),
  };
}

function createApp(facilitator?: X402FacilitatorClient) {
  const app = new Hono();
  app.use(
    "/protected/*",
    baseX402PaymentMiddleware({ ...TEST_CFG, facilitatorClient: facilitator }),
  );
  app.get("/protected/resource", (c) => c.json({ data: "secret-resource" }));
  app.post("/protected/create", (c) => c.json({ created: true }));
  return app;
}

describe("x402 Base Payment Middleware", () => {
  it("returns 402 with payment requirements when no X-PAYMENT header", async () => {
    const app = createApp(mockFacilitator());
    const res = await app.request("/protected/resource");
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.x402Version).toBe(1);
    expect(body.error).toBe("Payment required");
    expect(body.accepts.scheme).toBe("exact");
    expect(body.accepts.network).toBe("eip155:84532");
    expect(body.accepts.asset).toBe(TEST_CFG.usdcAddress);
    expect(body.accepts.amount).toBe("1000000");
    expect(body.accepts.payTo).toBe(TEST_CFG.payTo);
  });

  it("returns 402 for POST without payment header", async () => {
    const app = createApp(mockFacilitator());
    const res = await app.request("/protected/create", { method: "POST" });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.accepts.resource).toBe("POST /protected/create");
  });

  it("returns resource when payment is valid and settled", async () => {
    const facilitator = mockFacilitator();
    const app = createApp(facilitator);
    const res = await app.request("/protected/resource", {
      headers: { "X-PAYMENT": "0xvalidpayment" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBe("secret-resource");
    expect(res.headers.get("X-PAYMENT-RESPONSE")).toBe("0xsettlement123");
  });

  it("returns 402 when payment verification fails", async () => {
    const facilitator = mockFacilitator();
    (facilitator.verify as ReturnType<typeof vi.fn>).mockResolvedValue({ valid: false, error: "Invalid signature" });
    const app = createApp(facilitator);
    const res = await app.request("/protected/resource", {
      headers: { "X-PAYMENT": "0xinvalidpayment" },
    });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("Invalid signature");
  });

  it("returns 402 when settlement fails", async () => {
    const facilitator = mockFacilitator();
    (facilitator.settle as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, error: "Insufficient balance" });
    const app = createApp(facilitator);
    const res = await app.request("/protected/resource", {
      headers: { "X-PAYMENT": "0xvalidbutbroke" },
    });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("Insufficient balance");
  });

  it("includes correct resource string in requirements", async () => {
    const app = createApp(mockFacilitator());
    const res = await app.request("/protected/resource");
    const body = await res.json();
    expect(body.accepts.resource).toBe("GET /protected/resource");
  });

  it("payment requirements include correct USDC address", async () => {
    const app = createApp(mockFacilitator());
    const res = await app.request("/protected/resource");
    const body = await res.json();
    expect(body.accepts.asset).toBe("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
  });

  it("calls facilitator verify and settle on valid payment", async () => {
    const facilitator = mockFacilitator();
    const app = createApp(facilitator);
    await app.request("/protected/resource", {
      headers: { "X-PAYMENT": "0xpayment" },
    });
    expect(facilitator.verify).toHaveBeenCalledWith("0xpayment", expect.objectContaining({
      scheme: "exact",
      network: "eip155:84532",
    }));
    expect(facilitator.settle).toHaveBeenCalledWith("0xpayment", expect.objectContaining({
      scheme: "exact",
      network: "eip155:84532",
    }));
  });
});
