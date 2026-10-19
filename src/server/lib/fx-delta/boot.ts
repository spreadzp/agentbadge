/**
 * FX-delta engine boot (EPIC-191, D-191-12).
 *
 * Starts the real tracker engine in-process when FXDELTA_ENABLED=true:
 * CeloPriceSource (Uniswap/Mento onchain ticks) + FxRefSource (official
 * FX rates cascade) → DeltaEngine → setFxDeltaRuntime. Must run BEFORE
 * registerMcpNamespaces()/wireFxDeltaNamespace — both read
 * getFxDeltaRuntime() at wiring time.
 *
 * Without the flag this is a no-op and premium routes degrade to 503.
 */

import { logger } from "@agentbadge/passport/logger";
import {
  CORRIDORS,
  THIN_CORRIDORS,
  DeltaEngine,
  CeloPriceSource,
  FxRefSource,
  type Corridor,
  type CorridorPrice,
  type FxRefPrice,
  type FxProviderId,
} from "fxdelta-tracker";
import {
  setFxDeltaRuntime,
  getFxDeltaRuntime,
  type FxDeltaSourceStatus,
  type FxDeltaCorridorMeta,
} from "./index";

const ALL_CORRIDORS: readonly Corridor[] = [...CORRIDORS, ...THIN_CORRIDORS];

function parseFxProviders(): FxProviderId[] | undefined {
  const raw = process.env.FX_PROVIDERS;
  if (!raw) return undefined;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as FxProviderId[];
  return ids.length ? ids : undefined;
}

export function startFxDeltaEngine(): void {
  if (process.env.FXDELTA_ENABLED !== "true") return;
  if (getFxDeltaRuntime()) return; // idempotent — tests may inject first

  const rpcUrl = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
  const chainId = Number(process.env.CELO_CHAIN_ID ?? 42220);
  const pollMs = Number(process.env.CELO_POLL_MS ?? 5_000);
  const fxTtlMs = Number(process.env.FX_TTL_MS ?? 300_000);

  const engine = new DeltaEngine();
  engine.setCorridors(ALL_CORRIDORS);

  // Per-leg source health for runtime.sources() — last tick timestamps
  // are tracked here since the sources only expose a connected flag.
  const lastTick: Record<"uniswap" | "mento" | "fxRef", number> = {
    uniswap: 0,
    mento: 0,
    fxRef: 0,
  };

  const celo = new CeloPriceSource({ rpcUrl, chainId, pollMs });
  const fxRef = new FxRefSource({
    providers: parseFxProviders(),
    ttlMs: fxTtlMs,
  });

  celo.start([], (p: CorridorPrice) => {
    lastTick[p.source] = p.tsMs;
    engine.onChainPrice(p);
  });
  const fiats = [...new Set(ALL_CORRIDORS.map((c) => c.fiat))];
  fxRef.start(fiats, (p: FxRefPrice) => {
    lastTick.fxRef = p.tsMs;
    engine.onFxRef(p);
  });

  const sources = (): Record<
    "uniswap" | "mento" | "fxRef",
    FxDeltaSourceStatus
  > => ({
    uniswap: { connected: celo.connected, lastTickMs: lastTick.uniswap },
    mento: { connected: celo.connected, lastTickMs: lastTick.mento },
    fxRef: { connected: fxRef.connected, lastTickMs: lastTick.fxRef },
  });

  setFxDeltaRuntime({
    engine,
    corridors: ALL_CORRIDORS as readonly FxDeltaCorridorMeta[],
    sources,
    startedAtMs: Date.now(),
  });

  logger.info("fxdelta engine started", {
    corridors: ALL_CORRIDORS.length,
    fiats: fiats.length,
    chainId,
    pollMs,
  });
}
