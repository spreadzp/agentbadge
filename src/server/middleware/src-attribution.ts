/**
 * SLICE-178-5: `?src=` traffic attribution for discovery entry points.
 *
 * External agent registries (smithery, pulsemcp, mcp.so, skills.sh,
 * a2a-registry, …) link to our manifests; each can append ?src=<name>
 * so we can attribute discovery-surface traffic back to the registry.
 *
 * Behaviour:
 * - `?src=<whitelisted>` → recorded as-is.
 * - Any other value → recorded as `other` (never free-form — prevents
 *   cardinality explosion in the audit trail, HANDOFF O3).
 * - No `src` param → no-op.
 *
 * Each hit writes (a) a structured access-log line and (b) an
 * audit-store event (`source: "discovery-attribution"`,
 * `executionId: "src:<normalized>"`, keeperhub schema EPIC-143).
 * `srcCounts` is the in-memory metric (last-value per source survives
 * in the deduped audit trail).
 */

import type { Context, MiddlewareHandler } from "hono";

import { auditStore } from "../services/audit-store";

/** Known external registries — extend as new listings go live. */
export const SRC_WHITELIST = new Set([
  "smithery",
  "pulsemcp",
  "mcp.so",
  "skills.sh",
  "a2a-registry",
  "glama",
]);

export const SRC_OTHER = "other";

/** Per-source hit counter (in-memory metric, monotonic). */
export const srcCounts = new Map<string, number>();

/** Normalize a raw ?src= value: whitelist → value, else "other". */
export function normalizeSrc(raw: string | undefined): string | null {
  if (raw === undefined || raw === "") return null;
  const v = raw.trim().toLowerCase();
  return SRC_WHITELIST.has(v) ? v : SRC_OTHER;
}

/**
 * Record one attribution hit for the current request. Exported so
 * catch-all handlers (.md mirrors) can call it directly without
 * mounting middleware globally.
 */
export async function recordSrcAttribution(c: Context): Promise<void> {
  const src = normalizeSrc(c.req.query("src"));
  if (src === null) return;
  const path = c.req.path;
  srcCounts.set(src, (srcCounts.get(src) ?? 0) + 1);
  console.log(
    JSON.stringify({ event: "src_attribution", src, path, ts: new Date().toISOString() }),
  );
  try {
    await auditStore.add({
      source: "discovery-attribution",
      siteUrl: path,
      status: "recorded",
      executionId: `src:${src}`,
    });
  } catch {
    // attribution must never break the response
  }
}

/**
 * Hono middleware — mount inside discovery/manifest route groups so
 * only discovery entry points are instrumented (not every page).
 */
export function srcAttribution(): MiddlewareHandler {
  return async (c, next) => {
    await recordSrcAttribution(c);
    await next();
  };
}
