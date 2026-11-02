import { describe, expect, it } from "vitest";
import {
  probeArcRpcHealth,
  type ArcRpcHealthDeps,
} from "../src/server/lib/arc-rpc-health";

const deps = (over: Partial<ArcRpcHealthDeps> = {}): ArcRpcHealthDeps => ({
  getHead: async () => 29_000_000n,
  getCursor: async () => 28_999_990n,
  ...over,
});

describe("probeArcRpcHealth", () => {
  it("reports live head, indexer cursor and lag for Arc mainnet and testnet", async () => {
    const res = await probeArcRpcHealth(deps());
    expect(res.map((c) => c.name)).toEqual(["arc-mainnet", "arc-testnet"]);
    expect(res[0]).toMatchObject({
      chain: "5042",
      rpc: "up",
      head: "29000000",
      cursor: "28999990",
      lag: "10",
    });
    expect(res[0].error).toBeUndefined();
  });

  it("marks rpc down with the error message when getBlockNumber rejects", async () => {
    const res = await probeArcRpcHealth(
      deps({
        getHead: async () => {
          throw new Error("boom");
        },
      }),
    );
    expect(res[1]).toMatchObject({ rpc: "down", head: null, lag: null });
    expect(res[1].error).toContain("boom");
  });

  it("times out a hanging RPC instead of blocking the health response", async () => {
    const res = await probeArcRpcHealth(
      deps({ getHead: () => new Promise<bigint>(() => {}) }),
      20,
    );
    expect(res[0]).toMatchObject({ rpc: "down", head: null });
    expect(res[0].error).toMatch(/timeout/);
  });

  it("keeps rpc up but lag null when the indexer has no cursor yet", async () => {
    const res = await probeArcRpcHealth(deps({ getCursor: async () => null }));
    expect(res[0]).toMatchObject({
      rpc: "up",
      head: "29000000",
      cursor: null,
      lag: null,
    });
  });
});
