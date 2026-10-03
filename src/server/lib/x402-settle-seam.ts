/**
 * SLICE-156-1: x402 settle seam for route-level payment checks.
 *
 * Some routes need payment verification AFTER route-scoped work (venue
 * subscribe checks requireVenueAccess first, then settles). Middleware
 * can't express that — this seam does: the route calls it after its own
 * authorization logic and gets {payer, amountAtomic, tx} or null.
 *
 * On null the seam has already stamped a canonical PAYMENT-REQUIRED
 * header on the context (multi-chain accepts via the shared router), so
 * the route's own 402 errorResponse still advertises the payment surface.
 */

import type { Context } from "hono";
import type {
  PaymentRequirements,
  PaymentRouter,
} from "@agentbadge/circle-payments";

export interface SettleSeamResult {
  payer: `0x${string}`;
  amountAtomic: string;
  tx?: string;
}

export interface SettleSeamOptions {
  router: PaymentRouter;
  /** Amount in 6-dec base units — getter so env-driven prices stay live */
  amountAtomic: () => string;
  description?: string;
  resourceUrl?: string;
}

interface PaymentPayload {
  x402Version?: number;
  accepted?: PaymentRequirements;
  payload?: Record<string, unknown>;
}

function b64decode<T>(s: string): T | undefined {
  try {
    return JSON.parse(Buffer.from(s, "base64").toString("utf-8")) as T;
  } catch {
    return undefined;
  }
}

const b64encode = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString("base64");

/** Match the client's accepted entry against advertised accepts — same
 *  rules as the package middleware (extra.name disambiguates gateway vs
 *  plain exact on the same scheme+network+asset). */
function matchAccepted(
  payload: PaymentPayload,
  accepts: PaymentRequirements[],
): PaymentRequirements | undefined {
  const accepted = payload.accepted;
  if (!accepted) return undefined;
  return accepts.find(
    (a) =>
      a.scheme === accepted.scheme &&
      a.network === accepted.network &&
      a.asset === accepted.asset &&
      (a.extra?.name ?? undefined) === (accepted.extra?.name ?? undefined),
  );
}

export function createSettleSeam(
  opts: SettleSeamOptions,
): (c: Context) => Promise<SettleSeamResult | null> {
  return async (c) => {
    const amount = opts.amountAtomic();
    const accepts = opts.router.acceptsFor(amount);
    const stamp = (error?: string) => {
      c.header(
        "PAYMENT-REQUIRED",
        b64encode({
          x402Version: 2,
          ...(error ? { error } : {}),
          resource: {
            url: opts.resourceUrl ?? c.req.url,
            description: opts.description ?? "Paid resource",
            mimeType: "application/json",
          },
          accepts,
        }),
      );
    };

    const header = c.req.header("payment-signature");
    if (!header) {
      stamp();
      return null;
    }
    const payload = b64decode<PaymentPayload>(header);
    if (!payload || typeof payload !== "object") {
      stamp("Malformed payment-signature");
      return null;
    }
    const requirements = matchAccepted(payload, accepts);
    if (!requirements) {
      stamp("Unsupported payment option");
      return null;
    }

    const verify = await opts.router.verify(payload, requirements);
    if (!verify.isValid) {
      stamp(verify.invalidReason ?? "Payment verification failed");
      return null;
    }
    const settle = await opts.router.settle(payload, requirements);
    if (!settle.success) {
      stamp(settle.errorReason ?? "Payment settlement failed");
      return null;
    }

    const payer = (settle.payer ?? verify.payer) as `0x${string}` | undefined;
    if (!payer) {
      stamp("Settled without payer");
      return null;
    }
    return { payer, amountAtomic: requirements.amount, tx: settle.transaction };
  };
}
