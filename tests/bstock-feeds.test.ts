/**
 * bStock feeds — probeLiveAssets: only symbols with a live Binance
 * market (non-empty quote) are tracked; quoteless assets are dropped
 * so their underlyings are never subscribed on Finnhub.
 */

import { describe, it, expect } from "vitest";
import { probeLiveAssets } from "../src/server/lib/bstock/feeds";
import type { BinanceQuote } from "@agentbadge/bstock-tracker";

const asset = (assetCode: string) => ({
  assetCode,
  assetName: `${assetCode} name`,
  underlyingSymbol: assetCode.slice(0, -1),
  multiplier: 1,
  multiplierValid: true,
});

const quote = (bid: number | null, ask: number | null): BinanceQuote => ({
  symbol: "X",
  bidPrice: bid,
  askPrice: ask,
  bidSize: null,
  askSize: null,
  mid: bid !== null && ask !== null ? (bid + ask) / 2 : null,
});

const stubClient = (
  map: Record<string, BinanceQuote | null | "throw">,
) => ({
  async fetchQuote(symbol: string) {
    const v = map[symbol];
    if (v === "throw") throw new Error("HTTP 500");
    return v ?? null;
  },
});

describe("probeLiveAssets", () => {
  it("keeps only assets with a non-empty quote", async () => {
    const assets = [asset("MUB"), asset("TSLAB"), asset("SPYB")];
    const client = stubClient({
      MUB: quote(102, 104),
      TSLAB: null, // empty body — no market
      SPYB: quote(14, 42),
    });
    const live = await probeLiveAssets(client, assets);
    expect(live.map((a) => a.assetCode)).toEqual(["MUB", "SPYB"]);
  });

  it("drops zero-bid/ask quotes (dead book)", async () => {
    const assets = [asset("DEADB"), asset("LIVEB")];
    const client = stubClient({
      DEADB: quote(0, 0),
      LIVEB: quote(10, 11),
    });
    const live = await probeLiveAssets(client, assets);
    expect(live.map((a) => a.assetCode)).toEqual(["LIVEB"]);
  });

  it("drops assets whose quote request throws", async () => {
    const assets = [asset("ERRB"), asset("OKB")];
    const client = stubClient({ ERRB: "throw", OKB: quote(1, 2) });
    const live = await probeLiveAssets(client, assets);
    expect(live.map((a) => a.assetCode)).toEqual(["OKB"]);
  });

  it("handles >10 assets in chunks", async () => {
    const assets = Array.from({ length: 25 }, (_, i) =>
      asset(`S${i}B`),
    );
    const map: Record<string, BinanceQuote | null> = {};
    for (const a of assets) {
      map[a.assetCode] = a.assetCode === "S7B" ? null : quote(1, 2);
    }
    const live = await probeLiveAssets(stubClient(map), assets);
    expect(live).toHaveLength(24);
    expect(live.find((a) => a.assetCode === "S7B")).toBeUndefined();
  });
});
