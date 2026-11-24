/**
 * EPIC-264 (SLICE-264-8): capability gate middleware — mounts right
 * after operatorAuth on a migrated surface:
 *
 *   app.use("/admin/x/*", operatorAuth(store), capabilityGate());
 *
 * `cap` pins one capability for the whole mount; absent, the gate
 * derives it from capabilityForSurface(decoded path, method) —
 * GET/HEAD → "read", mutating verbs → "workflow", with the
 * CAPABILITY_BY_SURFACE prefix table winning over the verb fallback.
 * A typed 403 (INSUFFICIENT_CAPABILITY) or 401 (no mounted principal)
 * refuses; the operator record itself supplies the capability set —
 * never request data (C7).
 */

import type { Context, Next } from "hono";

import type { AdminCapability, OperatorStore } from "../lib/operators";
import { pickOperatorStores } from "../lib/operators";
import { getDatabase } from "../lib/database";
import {
  capabilityForSurface,
  operatorAuth,
  requireCapability,
} from "./operatorAuth";

export function capabilityGate(cap?: AdminCapability) {
  return async function capabilityGateMiddleware(
    c: Context,
    next: Next,
  ): Promise<Response | void> {
    const deny = requireCapability(
      c,
      cap ?? capabilityForSurface(c.req.path, c.req.method),
    );
    if (deny) return deny;
    await next();
  };
}

/** Route-file shorthand: mounted operatorAuth + the matching gate. */
export function operatorAuthGate(
  store: OperatorStore,
  cap?: AdminCapability,
): ReadonlyArray<
  (c: Context, next: Next) => Promise<Response | void>
> {
  return [operatorAuth(store), capabilityGate(cap)];
}

/**
 * For singleton route modules that register at import time (no deps
 * seam): resolves pickOperatorStores(getDatabase()) on the FIRST
 * request, not at module import — env/DATABASE_ENABLED are settled by
 * then. The resolved store memoizes; per-request cost is one closure.
 */
export function lazyOperatorAuth(
  getStore: () => OperatorStore = () => pickOperatorStores(getDatabase()),
): (c: Context, next: Next) => Promise<Response | void> {
  let cached: OperatorStore | undefined;
  return async function lazyOperatorAuthMiddleware(
    c: Context,
    next: Next,
  ): Promise<Response | void> {
    return operatorAuth((cached ??= getStore()))(c, next);
  };
}
