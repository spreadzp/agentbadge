/**
 * Gateway facilitator probe wiring — extracted from circle-payments.ts
 * (file-size lint). Probe marks transport failures; the router flag
 * degrades advertised accepts[] to vanilla rails while down (156-1).
 */

import {
  createGatewayProbe,
  type SchemeHandle,
} from "@agentbadge/circle-payments";
import { logger } from "@agentbadge/passport";
import type { CirclePaymentsConfig } from "../../config/env";

/** Build the probe from cfg, or undefined when gateway rail is off. */
export function createGatewayProbeForCfg(cfg: CirclePaymentsConfig) {
  if (!cfg.gateway) return undefined;
  return createGatewayProbe({
    apiUrl: cfg.gatewayApiUrl,
    ...(cfg.gatewayProbeMs ? { intervalMs: cfg.gatewayProbeMs } : {}),
    ...(cfg.gatewayDownMs ? { downMs: cfg.gatewayDownMs } : {}),
    onChange: (up, reason) =>
      up
        ? logger.info("gateway probe: rail back up", { reason })
        : logger.warn("gateway probe: rail down (vanilla accepts only)", {
          reason,
        }),
  });
}

type GatewayProbe = ReturnType<typeof createGatewayProbeForCfg>;

/** Facilitator connectivity snapshot reported by the health endpoint. */
export interface FacilitatorHealth {
  status: "up" | "down";
  latencyMs: number | null;
  lastError: string | null;
}

export interface FacilitatorProbeOptions {
  /** Facilitator/gateway API base URL */
  url: string;
  /** Probe path — default matches the 156-1 gateway probe (cheap GET) */
  path?: string;
  /** In-band cache TTL — default 30s, no background process (160-2) */
  cacheMs?: number;
  /** Fetch timeout — default 5s */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * SLICE-160-2: cached in-band facilitator probe — the ONE probe impl
 * the health endpoint reads. Pings `${url}/x402/transfers?pageSize=1`
 * (same cheap endpoint as the 156-1 gateway probe) and caches the
 * result for `cacheMs` so a burst of health checks costs one fetch.
 */
export function createFacilitatorProbe(
  opts: FacilitatorProbeOptions,
): () => Promise<FacilitatorHealth> {
  const cacheMs = opts.cacheMs ?? 30_000;
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const probePath = opts.path ?? "/x402/transfers?pageSize=1";
  const url = `${opts.url.replace(/\/+$/, "")}${probePath}`;

  let cached: FacilitatorHealth | undefined;
  let cachedAt = 0;

  return async (): Promise<FacilitatorHealth> => {
    if (cached && Date.now() - cachedAt < cacheMs) return cached;
    const t0 = Date.now();
    try {
      const resp = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Date.now() - t0;
      cached = resp.ok
        ? { status: "up", latencyMs, lastError: null }
        : { status: "down", latencyMs, lastError: `http ${resp.status}` };
    } catch (err) {
      cached = {
        status: "down",
        latencyMs: null,
        lastError: err instanceof Error ? err.message : String(err),
      };
    }
    cachedAt = Date.now();
    return cached;
  };
}

/** Wrap scheme handle so transport failures feed the probe. */
export function withProbe<T extends SchemeHandle>(
  gatewayProbe: GatewayProbe,
  h: T,
): T {
  if (!gatewayProbe) return h;
  const mark = (p: Promise<unknown>) => p.catch((err) => {
    gatewayProbe.markFailure();
    throw err;
  });
  return {
    ...h,
    verify: (p: unknown, req: never) => mark(h.verify(p, req)),
    settle: (p: unknown, req: never) => mark(h.settle(p, req)),
  } as T;
}
