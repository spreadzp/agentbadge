// SLICE-176-7: envelope gate + withEnvelope extracted from
// enforcer.ts (300-line file limit). Middleware form for
// `app.use(path, gate)` — registered BEFORE route mounts; the
// enforcer is resolved lazily per request so wiring order of
// store init is irrelevant. `withEnvelope` is the direct
// call-site form for non-middleware code.

import type { Context, MiddlewareHandler } from "hono";

import type { SpendKind } from "./ledger";
import {
  getSpendEnforcer,
  type EnforceBegin,
  type SpendEnforcer,
} from "./enforcer";

export interface EnvelopeGateOpts {
  kind: SpendKind;
  /** Resolve payment amount (USD decimal); ≤0 → pass-through. */
  amountUsdFor: (c: Context) => number | Promise<number>;
  refIdFor?: (c: Context) => string;
}

export function spendEnvelopeGate(opts: EnvelopeGateOpts): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== "POST") {
      await next();
      return;
    }
    const enforcer = getSpendEnforcer();
    if (!enforcer) {
      await next();
      return;
    }
    const amountUsd = await opts.amountUsdFor(c);
    if (!(amountUsd > 0)) {
      await next();
      return;
    }
    const refId =
      opts.refIdFor?.(c) ??
      `${opts.kind}:${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const begun = await enforcer.begin(c, amountUsd, opts.kind, refId);
    if (begun instanceof Response) return begun;
    try {
      await next();
      const tx = (
        c.get("payment") as { transaction?: string } | undefined
      )?.transaction;
      await enforcer.complete(begun, c.res.ok, amountUsd, opts.kind, refId, tx);
    } catch (err) {
      await enforcer.complete(begun, false, amountUsd, opts.kind, refId);
      throw err;
    }
  };
}

/** `withEnvelope` per spec — direct call-site form for non-middleware code. */
export async function withEnvelope<T>(
  enforcer: SpendEnforcer,
  c: Context,
  args: { amountUsd: number; kind: SpendKind; refId: string },
  fn: () => Promise<T>,
): Promise<{ ok: true; result: T } | { ok: false; res: Response }> {
  const begun = await enforcer.begin(c, args.amountUsd, args.kind, args.refId);
  if (begun instanceof Response) return { ok: false, res: begun };
  try {
    const result = await fn();
    await enforcer.complete(begun, true, args.amountUsd, args.kind, args.refId);
    return { ok: true, result };
  } catch (err) {
    await enforcer.complete(begun, false, args.amountUsd, args.kind, args.refId);
    throw err;
  }
}

export type { EnforceBegin };
