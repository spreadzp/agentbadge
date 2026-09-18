/**
 * SLICE-129-21: flag matrix — each capability independently gateable.
 * Verifies accepts[] schemes, identityExtension, and balance chains
 * reflect cfg flags. Handles injected so no facilitator IO.
 */

import { describe, expect, it, vi } from "vitest";
import { createCirclePaymentsRuntime } from "../src/server/lib/circle-payments";
import type { CirclePaymentsConfig } from "../src/config/env";

const SELLER = "0x1111111111111111111111111111111111111111";
const AGENT = "0x2222222222222222222222222222222222222222";

function cfg(over: Partial<CirclePaymentsConfig>): CirclePaymentsConfig {
  return {
    enabled: true,
    gateway: false,
    arc: false,
    identity: false,
    escrow: false,
    gatewayApiUrl: "https://gateway-api-testnet.circle.com",
    arcRpcUrl: "https://rpc.testnet.arc.network",
    arcChainId: 5042002,
    sellerAddress: SELLER,
    platformFeeBps: 0,
    ...over,
  };
}

function fakeHandle() {
  return {
    verify: vi.fn().mockResolvedValue({ isValid: true, payer: AGENT }),
    settle: vi
      .fn()
      .mockResolvedValue({ success: true, transaction: "0xtx", payer: AGENT }),
  };
}

function arcHandle() {
  return {
    ...fakeHandle(),
    network: "eip155:5042002",
    publicClient: { getTransactionReceipt: vi.fn() },
  };
}

function acceptsOf(rt: ReturnType<typeof createCirclePaymentsRuntime>) {
  return rt.router.acceptsFor("1000");
}

/** Gateway rail emits scheme "exact" + extra.verifyingContract. */
function hasGatewayEntry(rt: ReturnType<typeof createCirclePaymentsRuntime>) {
  return acceptsOf(rt).some(
    (a) => (a.extra as Record<string, unknown>)?.verifyingContract,
  );
}

function schemesOf(rt: ReturnType<typeof createCirclePaymentsRuntime>) {
  return acceptsOf(rt).map((a) => a.scheme);
}

describe("flag matrix", () => {
  it("all off → exact only, no extension", () => {
    const rt = createCirclePaymentsRuntime(cfg({}), {
      handles: { exact: fakeHandle() },
    });
    expect(schemesOf(rt)).toEqual(["exact"]);
    expect(hasGatewayEntry(rt)).toBe(false);
    expect(rt.identityExtension).toBeUndefined();
  });

  it("gateway on → gateway entry (verifyingContract) in accepts", () => {
    const rt = createCirclePaymentsRuntime(cfg({ gateway: true }), {
      handles: { exact: fakeHandle(), gateway: fakeHandle() },
    });
    expect(hasGatewayEntry(rt)).toBe(true);
    expect(schemesOf(rt)).toContain("exact");
  });

  it("arc on → eip3009-client-broadcast in accepts", () => {
    const rt = createCirclePaymentsRuntime(cfg({ arc: true }), {
      handles: { exact: fakeHandle(), arcSelfSettle: arcHandle() as never },
    });
    expect(schemesOf(rt)).toContain("eip3009-client-broadcast");
  });

  it("gateway+arc on → gateway entry + arc scheme + exact", () => {
    const rt = createCirclePaymentsRuntime(
      cfg({ gateway: true, arc: true }),
      {
        handles: {
          exact: fakeHandle(),
          gateway: fakeHandle(),
          arcSelfSettle: arcHandle() as never,
        },
      },
    );
    expect(hasGatewayEntry(rt)).toBe(true);
    expect(schemesOf(rt)).toContain("exact");
    expect(schemesOf(rt)).toContain("eip3009-client-broadcast");
  });

  it("identity on → extension defined; off → undefined", () => {
    const on = createCirclePaymentsRuntime(cfg({ identity: true }), {
      handles: { exact: fakeHandle() },
    });
    expect(on.identityExtension).toBeDefined();
    const off = createCirclePaymentsRuntime(cfg({ identity: false }), {
      handles: { exact: fakeHandle() },
    });
    expect(off.identityExtension).toBeUndefined();
  });

  it("gateway||arc on → balance chains include Arc; both off → Base only", async () => {
    const baseOnly = createCirclePaymentsRuntime(cfg({}), {
      handles: { exact: fakeHandle() },
    });
    // stub fetch so balanceLookup doesn't hit network
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );
    const baseRes = await baseOnly.balanceLookup();
    expect(baseRes.map((b) => b.network)).toEqual(["eip155:84532"]);

    const withArc = createCirclePaymentsRuntime(cfg({ arc: true }), {
      handles: { exact: fakeHandle(), arcSelfSettle: arcHandle() as never },
    });
    const arcRes = await withArc.balanceLookup();
    expect(arcRes.map((b) => b.network)).toContain("eip155:5042002");
    vi.unstubAllGlobals();
  });
});
