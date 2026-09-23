/**
 * bStock feed startup (EPIC-141) — attaches live price feeds to the
 * DeltaEngine singleton.
 *
 * Binance: tokenized-assets map → engine.setAssets, then WS price
 * stream (REST quote fallback inside BinancePriceFeed, D15).
 * Underlying: Finnhub primary; Alpaca IEX fallback when both keys are
 * set (FallbackPriceSource, 60s silence → failover).
 *
 * Gated by BSTOCK_FEED_ENABLED=true — off in tests/dev by default so
 * no network connections are opened implicitly.
 */

import {
  BinanceClient,
  BinancePriceFeed,
  FinnhubClient,
  AlpacaClient,
  FallbackPriceSource,
  type PriceSource,
} from "@agentbadge/bstock-tracker";
import type { BstockEngineLike } from "@agentbadge/mcp";

interface EngineWithFeeds extends BstockEngineLike {
  setAssets(assets: readonly import("@agentbadge/bstock-tracker").TokenizedAsset[]): void;
  onBinancePrices(prices: readonly import("@agentbadge/bstock-tracker").BinancePrice[]): void;
  onBinanceQuotes(quotes: readonly import("@agentbadge/bstock-tracker").BinanceQuote[]): void;
  onUnderlyingPrice(p: import("@agentbadge/bstock-tracker").UnderlyingPrice): void;
}

export interface BstockFeeds {
  stop(): void;
}

interface QuoteProbe {
  fetchQuote(
    symbol: string,
  ): Promise<import("@agentbadge/bstock-tracker").BinanceQuote | null>;
}

/**
 * Keep only assets with a live Binance market — declared but quoteless
 * assets (dead/absent books) are excluded from tracking AND from
 * underlying subscriptions (no point polling Finnhub for an underlying
 * whose bStock has no Binance market).
 */
export async function probeLiveAssets<
  T extends { assetCode: string },
>(client: QuoteProbe, assets: readonly T[]): Promise<T[]> {
  const live: T[] = [];
  const CHUNK = 10;
  for (let i = 0; i < assets.length; i += CHUNK) {
    const results = await Promise.all(
      assets.slice(i, i + CHUNK).map(async (a) => {
        try {
          const q = await client.fetchQuote(a.assetCode);
          return q && (q.bidPrice ?? 0) + (q.askPrice ?? 0) > 0
            ? a
            : null;
        } catch {
          return null;
        }
      }),
    );
    for (const a of results) if (a) live.push(a);
  }
  return live;
}

export async function startBstockFeeds(
  engine: BstockEngineLike,
): Promise<BstockFeeds | null> {
  const eng = engine as EngineWithFeeds;
  const stops: (() => void)[] = [];

  // ── Binance side (bStock prices + asset map) ──────────────────────
  const binance = new BinanceClient({
    apiKey: process.env.BINANCE_BSTOK_API_KEY ?? "",
  });
  try {
    const assets = await binance.fetchTokenizedAssets();
    const live = await probeLiveAssets(binance, assets);
    console.log(
      `[bstock] ${live.length}/${assets.length} assets have live Binance markets`,
    );
    eng.setAssets(live);
  } catch (err) {
    console.error("[bstock] tokenized-assets fetch failed:", err);
    return null;
  }

  const symbols = () =>
    eng.listDeltas().map((d) => d.symbol);
  const feed = new BinancePriceFeed({
    client: binance,
    symbols,
    onPrices: (p) => eng.onBinancePrices(p),
    onQuotes: (q) => eng.onBinanceQuotes(q),
    onError: (e) => console.error("[bstock] binance feed:", e),
    // equity/ws/price pushes underlying tickers, not bStock codes —
    // WS never goes silent, so quotes must poll unconditionally.
    pollAlways: true,
  });
  feed.start();
  stops.push(() => feed.stop());

  // ── Underlying side (equity prices) ───────────────────────────────
  const underlyingSymbols = [
    ...new Set(eng.listDeltas().map((d) => d.underlying)),
  ];
  const finnhubKey = process.env.FINNHUB_API_KEY;
  const alpacaKey = process.env.ALPACA_API_KEY;
  const alpacaSecret = process.env.ALPACA_API_SECRET;

  let source: PriceSource | null = null;
  if (finnhubKey && alpacaKey && alpacaSecret) {
    source = new FallbackPriceSource({
      primary: new FinnhubClient({ apiKey: finnhubKey }),
      fallback: new AlpacaClient({
        apiKey: alpacaKey,
        apiSecret: alpacaSecret,
      }),
      symbols: underlyingSymbols,
      onPrice: (p) => eng.onUnderlyingPrice(p),
    });
  } else if (finnhubKey) {
    source = new FinnhubClient({ apiKey: finnhubKey });
  } else if (alpacaKey && alpacaSecret) {
    source = new AlpacaClient({ apiKey: alpacaKey, apiSecret: alpacaSecret });
  }

  if (source) {
    source.start(underlyingSymbols, (p) => eng.onUnderlyingPrice(p));
    stops.push(() => source.stop());
  } else {
    console.warn(
      "[bstock] no FINNHUB_API_KEY / ALPACA keys — underlying prices off",
    );
  }

  return {
    stop() {
      for (const s of stops) s();
    },
  };
}
