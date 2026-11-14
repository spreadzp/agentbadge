import { describe, expect, it, vi } from "vitest";

import type { PaymentRouter } from "@agentbadge/circle-payments";
import {
  ARC_TESTNET_CAIP2,
  InMemoryUsageRecordStore,
  pilotResources,
} from "@agentbadge/payments";

import type { AgentWalletStore } from "../../src/server/lib/agent-wallet/registry.js";
import {
  createX402PaymentService,
} from "../../src/server/lib/x402-gateway/service.js";
import type { SettleSeamResult } from "../../src/server/lib/x402-settle-seam.js";

const [RESOURCE] = pilotResources(ARC_TESTNET_CAIP2);

const SEAM_RESULT: SettleSeamResult = {
  payer: "0x1111111111111111111111111111111111111111",
  amountAtomic: "100000",
  tx: "0xabc123",
  sourceChain: ARC_TESTNET_CAIP2,
  scheme: "exact",
};

const router = {} as PaymentRouter;

describe("x402PaymentService", () => {
  it("buildRequirements maps resolved price → domain requirements", async () => {
    const svc = createX402PaymentService({
      router,
      recipient: "0x742d35cc6634c0532925a3b844bc454e4438f44e",
    });
    const resolved = await svc.resolvePrice(RESOURCE!);
    expect(resolved.priceUsd).toBe("0.10");
    expect(resolved.source).toBe("registry");

    const req = svc.buildRequirements(RESOURCE!, resolved);
    expect(req.amount).toBe("100000");
    expect(req.currency).toBe("USDC");
    expect(req.network).toBe(ARC_TESTNET_CAIP2);
    expect(req.recipient).toBe(
      "0x742d35cc6634c0532925a3b844bc454e4438f44e",
    );
    expect(req.resourceId).toBe("passport-request");
  });

  it("resolver port wins over registry price", async () => {
    const svc = createX402PaymentService({
      router,
      resolver: {
        resolve: async () => ({
          resourceId: "x",
          priceUsd: "0.25",
          source: "catalog" as const,
          resolvedAt: new Date(),
        }),
      },
    });
    const r = await svc.resolvePrice(RESOURCE!);
    expect(r.priceUsd).toBe("0.25");
    expect(r.source).toBe("catalog");
    expect(
      svc.buildRequirements(RESOURCE!, r).amount,
    ).toBe("250000");
  });

  it("recordUsage appends + dedupes on requestId", async () => {
    const usageRecords = new InMemoryUsageRecordStore();
    const svc = createX402PaymentService({ router, usageRecords });
    const input = {
      settleResult: SEAM_RESULT,
      resource: RESOURCE!,
      requestId: "req_1",
      agentId: "agent_1",
    };
    const row = await svc.recordUsage(input);
    expect(row).not.toBeNull();
    expect(row!.paymentId).toBe("0xabc123");
    expect(row!.payerAddress).toBe(SEAM_RESULT.payer);
    expect(row!.resource).toBe("passport-request");

    // same requestId → dedupe, no second row
    const dup = await svc.recordUsage(input);
    expect(dup).toBeNull();
    expect(await usageRecords.listByResource("passport-request")).toHaveLength(
      1,
    );
  });

  it("no store → recordUsage no-ops; agentId resolves via walletStore", async () => {
    const walletStore: AgentWalletStore = {
      name: "memory",
      get: async (addr: string) =>
        addr.toLowerCase() === SEAM_RESULT.payer.toLowerCase()
          ? ({
              address: addr,
              agentId: "agent_777",
            } as never)
          : undefined,
      put: async () => {},
      list: async () => [],
      deactivate: async () => false,
      setEnvelope: async () => false,
      setSuspended: async () => false,
    };
    const svc = createX402PaymentService({ router, walletStore });
    expect(await svc.recordUsage({
      settleResult: SEAM_RESULT,
      resource: RESOURCE!,
      requestId: "r",
      agentId: null,
    })).toBeNull();
    expect(await svc.resolveAgentId(SEAM_RESULT.payer)).toBe("agent_777");
    expect(await svc.resolveAgentId("0xdead")).toBeNull();
  });

  it("verifyAndSettle delegates to the injected seam factory", async () => {
    const seam = vi.fn(async () => SEAM_RESULT);
    const createSeam = vi.fn(() => seam);
    const svc = createX402PaymentService({ router, createSeam });
    const c = {
      req: { url: "https://x/paid", header: () => "sig" },
    } as never;
    const r = await svc.verifyAndSettle(c, RESOURCE!, "100000");
    expect(r).toBe(SEAM_RESULT);
    expect(createSeam).toHaveBeenCalledOnce();
    expect(seam).toHaveBeenCalledWith(c);
  });

  it("requestIdFor prefers client headers, falls back to uuid", () => {
    const svc = createX402PaymentService({ router });
    const c = (h: Record<string, string>) =>
      ({
        req: {
          url: "https://x/paid",
          header: (n: string) => h[n.toLowerCase()],
        },
      }) as never;
    expect(svc.requestIdFor(c({ "x-request-id": "rid_1" }))).toBe("rid_1");
    expect(svc.requestIdFor(c({ "idempotency-key": "ik_2" }))).toBe("ik_2");
    expect(svc.requestIdFor(c({}))).toMatch(/^req_/);
  });
});
