/**
 * SLICE-191-10: premium FX-rate fetcher for the tracker's "buyfx"
 * provider — the agent buys an FX quote via @celo/buy gateway and the
 * rate enters the FxRefSource cascade as a paid reference.
 *
 * Config (env):
 *   BUY_FX_API_URL    — gateway capability URL, e.g.
 *                       https://gateway.usebuy.ai/v1/fx/quote
 *                       (no fetcher when unset → provider skipped)
 *   BUY_FX_API_METHOD — POST by default
 *   BUY_WALLET        — owner-registered wallet charged (envelope
 *                       "buy-gateway" kind must be allowed)
 *
 * Response parsing: the paid gateway response is opaque JSON — we scan
 * it for { "<FIAT>": <number> } or { rates: { "<FIAT>": <number> } }.
 * Anything unrecognized → undefined → cascade falls through.
 */

import { buyPay, buyQuote, type BuyGatewayOptions } from "./gateway";

interface FxBuyConfig {
  url: string;
  method: string;
  wallet?: `0x${string}`;
}

function cfg(): FxBuyConfig | null {
  const url = process.env.BUY_FX_API_URL;
  if (!url) return null;
  return {
    url,
    method: process.env.BUY_FX_API_METHOD ?? "POST",
    wallet: process.env.BUY_WALLET as `0x${string}` | undefined,
  };
}

/** Recursively hunt for { FIAT: number } shapes in a paid payload. */
function extractRates(x: unknown, fiats: ReadonlySet<string>): Record<string, number> {
  const out: Record<string, number> = {};
  if (!x || typeof x !== "object") return out;
  for (const [k, v] of Object.entries(x)) {
    const key = k.toUpperCase();
    if (fiats.has(key) && typeof v === "number" && Number.isFinite(v) && v > 0) {
      out[key] = v;
    } else if (v && typeof v === "object") {
      Object.assign(out, extractRates(v, fiats));
    }
  }
  return out;
}

/**
 * FxRefSource `buyFx` option: one paid call returns rates for the
 * requested fiats. Returns undefined on refusal/deny/error — the
 * cascade then falls through to the next provider (paid spend is never
 * forced). Quote-first is structural: buyQuote → buyPay.
 */
export function createBuyFx(opts: BuyGatewayOptions = {}) {
  return async (
    fiats: readonly string[],
  ): Promise<Record<string, number> | undefined> => {
    const c = cfg();
    if (!c?.wallet) return undefined;
    const body = JSON.stringify({ symbols: fiats.join(",") });
    try {
      const quote = await buyQuote(c.url, c.method, body, opts);
      const res = await buyPay(quote, c.wallet, `buyfx:${fiats.join("/")}`, opts);
      if (res.status !== "paid" || !res.output) return undefined;
      const rates = extractRates(JSON.parse(res.output), new Set(fiats));
      return Object.keys(rates).length ? rates : undefined;
    } catch {
      return undefined;
    }
  };
}
