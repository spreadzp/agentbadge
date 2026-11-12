/**
 * SLICE-206-2: contract guards for marketplace write endpoints (D-206-5).
 *
 *  - zod fragments (idempotencyKey / evidenceRefs / summary) — limits come
 *    from CONTRACT_LIMITS in lib/machine-entry.ts (single source, 206-1).
 *  - readIdempotencyKey() — required-key reader for NEW write endpoints
 *    (206-6 agent path): missing/invalid → 400 IDEMPOTENCY_KEY_REQUIRED.
 *  - idempotentWrite() — dedupe by (scope, key): replays the stored FIRST
 *    response + duplicate:true, producer never re-runs (zero side-effects).
 *    Scope decision (landmine): callers pass method+routePath — the key is
 *    unique per endpoint, so the same key on different paths never collides.
 *  - legacyWriteDeprecation() — D-206-8: legacy market.ts writes keep the
 *    old contract (idempotency-key stays OPTIONAL) but answer with
 *    `Deprecation: true` + `Sunset`. If a route already emits Deprecation,
 *    we don't clobber it — `Warning: 299` is appended instead.
 */
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import { CONTRACT_LIMITS } from "./machine-entry";
import { errorResponse } from "./error-response";
import { ErrorCodes } from "./error-codes";

// ─── Zod fragments (limits from 206-1 shared const) ──────────────

export const idempotencyKeySchema = z
  .string()
  .min(CONTRACT_LIMITS.idempotencyKey.min)
  .max(CONTRACT_LIMITS.idempotencyKey.max);

export const evidenceRefsSchema = z
  .array(z.string().max(CONTRACT_LIMITS.evidenceRefs.maxLen))
  .max(CONTRACT_LIMITS.evidenceRefs.maxCount);

export const summarySchema = z.string().max(CONTRACT_LIMITS.summary.maxLen);

/** Required on NEW write endpoints. Returns key or a 400 Response. */
export function readIdempotencyKey(c: Context): string | Response {
  const parsed = idempotencyKeySchema.safeParse(
    c.req.header("idempotency-key") ?? "",
  );
  if (!parsed.success) {
    const { min, max } = CONTRACT_LIMITS.idempotencyKey;
    return errorResponse(
      c,
      400,
      ErrorCodes.IDEMPOTENCY_KEY_REQUIRED,
      `idempotency-key header required (${min}-${max} chars)`,
      { hint: "Send a unique idempotency-key per logical write; replays are safe." },
    );
  }
  return parsed.data;
}

// ─── Dedupe store (in-memory v1; Postgres seam is 206-3+ scope) ──

interface StoredResponse {
  status: number;
  body: unknown;
}

const IDEM_TTL_MS = 24 * 60 * 60 * 1000; // 24h replay window
const IDEM_MAX_ENTRIES = 10_000;
const dedupeStore = new Map<
  string,
  { stored: StoredResponse; at: number }
>();

/** In-flight produce() executions keyed like dedupeStore — audit
 *  206-18 round-2: without it, two concurrent same-key calls both
 *  miss the store and both run produce() (check-then-act across the
 *  await) → double side-effects. Joining callers share ONE execution
 *  and are marked duplicate. */
const inflight = new Map<string, Promise<IdempotentResult>>();

function dedupeKey(scope: string, key: string): string {
  return `${scope}\u0000${key}`;
}

export interface IdempotentResult {
  status: number;
  body: Record<string, unknown>;
  duplicate: boolean;
}

/**
 * Run `produce` once per (scope, key); replay stored response after.
 * `produce` returns the success status + JSON-serializable object body.
 * The stored body is returned verbatim with `duplicate: true` merged.
 */
export async function idempotentWrite(
  scope: string,
  key: string,
  produce: () => Promise<StoredResponse> | StoredResponse,
): Promise<IdempotentResult> {
  const k = dedupeKey(scope, key);
  const hit = dedupeStore.get(k);
  if (hit && Date.now() - hit.at < IDEM_TTL_MS) {
    return {
      status: hit.stored.status,
      body: { ...(hit.stored.body as Record<string, unknown>), duplicate: true },
      duplicate: true,
    };
  }
  if (hit) dedupeStore.delete(k);

  // Concurrent same-key call in flight → join it instead of a second
  // produce() (check-then-act race fix). The joined caller replays
  // the shared outcome marked duplicate — store dedupe covers later
  // sequential retries as before.
  const running = inflight.get(k);
  if (running) {
    const shared = await running;
    return {
      status: shared.status,
      body: { ...shared.body, duplicate: true },
      duplicate: true,
    };
  }

  const exec = (async (): Promise<IdempotentResult> => {
    const stored = await produce();
    if (dedupeStore.size >= IDEM_MAX_ENTRIES) {
      // FIFO evict oldest — Map preserves insertion order.
      const oldest = dedupeStore.keys().next().value;
      if (oldest !== undefined) dedupeStore.delete(oldest);
    }
    dedupeStore.set(k, { stored, at: Date.now() });
    return { status: stored.status, body: stored.body as Record<string, unknown>, duplicate: false };
  })();
  inflight.set(k, exec);
  try {
    return await exec;
  } finally {
    inflight.delete(k);
  }
}

/** Test seam — clears the dedupe store. */
export function resetIdempotencyStore(): void {
  dedupeStore.clear();
}

// ─── Legacy deprecation headers (D-206-8) ────────────────────────

/** HTTP-date for legacy market writes sunset (~protocol v1 freeze). */
export const LEGACY_SUNSET = "Thu, 31 Dec 2026 00:00:00 GMT";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Deprecation signal on legacy writes (mutations only — reads are not
 * legacy-superseded). Never clobbers an existing Deprecation header;
 * emits `Warning: 299` in that case (spec: header exists → warning).
 */
export function legacyWriteDeprecation(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    if (!MUTATION_METHODS.has(c.req.method)) return;
    if (c.res.headers.has("Deprecation")) {
      c.res.headers.append(
        "Warning",
        '299 - "endpoint already deprecated; see agentbadge-machine.json"',
      );
      return;
    }
    c.res.headers.set("Deprecation", "true");
    c.res.headers.set("Sunset", LEGACY_SUNSET);
    c.res.headers.set(
      "Link",
      '</.well-known/agentbadge-machine.json>; rel="successor-version"',
    );
  };
}

/**
 * SLICE-221-5 (D-221-5): soft-deprecation for the legacy checkout surface —
 * applies to ALL methods (the GET read routes are superseded too, unlike
 * legacyWriteDeprecation which only marks mutations). Headers are staged
 * via c.header() before next() so they also apply to error responses.
 */
export function legacyEndpointDeprecation(
  successorPath: string,
): MiddlewareHandler {
  return async (c, next) => {
    c.header("Deprecation", "true");
    c.header("Sunset", LEGACY_SUNSET);
    c.header("Link", `<${successorPath}>; rel="successor-version"`);
    await next();
  };
}
