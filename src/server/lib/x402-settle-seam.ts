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
import {
  ARC_SELF_SETTLE_SCHEME,
  type PaymentRequirements,
  type PaymentRouter,
} from "@agentbadge/circle-payments";
import { refuse as refusalResponse } from "./error-response";
import type { RefundService } from "./refund-log";

export interface SettleSeamResult {
  payer: `0x${string}`;
  amountAtomic: string;
  tx?: string;
  sourceChain?: string;
  scheme?: string;
}

export interface SettleSeamOptions {
  router: PaymentRouter;
  /** Amount in 6-dec base units — getter so env-driven prices stay live */
  amountAtomic: () => string;
  description?: string;
  resourceUrl?: string;
}

/** SLICE-181-2 seam options — refund ledger for self-settled refusals. */
export interface TwoPhaseSeamOptions extends SettleSeamOptions {
  refunds?: RefundService;
}

/** Raised when commit()/refuse() is called in the wrong handle state. */
export class SeamStateError extends Error {
  constructor(from: string, op: string) {
    super(`cannot ${op} from state ${from}`);
    this.name = "SeamStateError";
  }
}

/**
 * A verified-but-not-settled payment (D-181-3). The route must end the
 * handle's life exactly once: commit() settles and returns the payment
 * result; refuse() answers 4xx WITHOUT settling (charged:false). For
 * self-settle rails the tx already landed on-chain at verify time, so
 * refuse() records + attempts a refund instead.
 */
export interface PaymentHandle {
  payer: `0x${string}`;
  requirements: PaymentRequirements;
  /** settle + return the result; throws SeamStateError after refuse(). */
  commit(): Promise<SettleSeamResult>;
  /** 4xx refusal response; never settles. Throws SeamStateError after commit(). */
  refuse(
    code: "policy_refusal" | "insufficient_subject" | "execution_failed" | "data_unavailable",
    msg: string,
  ): Response;
  /** Present when the payment tx is already on-chain (arc self-settle). */
  selfSettled?: { tx: string };
}

type SeamPhase = "verified" | "committed" | "refused";

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

/** txHash the client presented on a self-settle payload. */
function extractSelfSettleTx(payload: PaymentPayload): string | undefined {
  const inner = payload.payload as { txHash?: string } | undefined;
  const outer = (payload as { txHash?: string }).txHash;
  return inner?.txHash ?? outer;
}

interface VerifiedPayment {
  payload: PaymentPayload;
  requirements: PaymentRequirements;
  payer: `0x${string}`;
  stamp: (error?: string) => void;
}

/**
 * Phase 1 (shared by atomic + two-phase): parse the payment-signature
 * header, match it against advertised accepts, run router.verify.
 * Returns null with PAYMENT-REQUIRED stamped when the check fails.
 */
async function verifyPhase(
  c: Context,
  opts: SettleSeamOptions,
): Promise<VerifiedPayment | null> {
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
  if (!verify.payer) {
    stamp("Verified without payer");
    return null;
  }
  return { payload, requirements, payer: verify.payer as `0x${string}`, stamp };
}

/** Phase 2 (shared): router.settle → SettleSeamResult, or null + stamp. */
async function settlePhase(v: VerifiedPayment, opts: SettleSeamOptions) {
  const settle = await opts.router.settle(v.payload, v.requirements);
  if (!settle.success) {
    v.stamp(settle.errorReason ?? "Payment settlement failed");
    return null;
  }
  const payer = (settle.payer ?? v.payer) as `0x${string}` | undefined;
  if (!payer) {
    v.stamp("Settled without payer");
    return null;
  }
  return {
    payer,
    amountAtomic: v.requirements.amount,
    tx: settle.transaction,
    sourceChain: v.requirements.network,
    scheme: v.requirements.scheme,
  } satisfies SettleSeamResult;
}

/** Atomic verify+settle — the original path, unchanged semantics. */
export function createSettleSeam(
  opts: SettleSeamOptions,
): (c: Context) => Promise<SettleSeamResult | null> {
  return async (c) => {
    const v = await verifyPhase(c, opts);
    if (!v) return null;
    return settlePhase(v, opts);
  };
}

/**
 * SLICE-181-2 (D-181-3): two-phase variant — verify now, let the route
 * decide commit() (work succeeded → settle) or refuse() (no charge).
 * On the arc self-settle rail verify already means "tx landed on-chain",
 * so the handle exposes selfSettled{tx} and refuse() records + attempts
 * a refund through opts.refunds (REFUND_AUTO_ENABLED gates the tx send;
 * "pending" records are the manual-ops queue).
 */
export function createSettleSeamTwoPhase(
  opts: TwoPhaseSeamOptions,
): (c: Context) => Promise<PaymentHandle | null> {
  return async (c) => {
    const v = await verifyPhase(c, opts);
    if (!v) return null;
    let phase: SeamPhase = "verified";
    const selfTx =
      v.requirements.scheme === ARC_SELF_SETTLE_SCHEME
        ? extractSelfSettleTx(v.payload)
        : undefined;

    const handle: PaymentHandle = {
      payer: v.payer,
      requirements: v.requirements,
      ...(selfTx ? { selfSettled: { tx: selfTx } } : {}),

      async commit() {
        if (phase !== "verified") throw new SeamStateError(phase, "commit");
        const r = await settlePhase(v, opts);
        if (!r) {
          throw new Error(
            "payment settlement failed — see PAYMENT-REQUIRED header",
          );
        }
        phase = "committed";
        return r;
      },

      refuse(code, msg) {
        if (phase !== "verified") throw new SeamStateError(phase, "refuse");
        phase = "refused";
        let refund;
        if (handle.selfSettled && opts.refunds) {
          const rec = opts.refunds.recordRefund({
            payer: handle.payer,
            amountAtomic: v.requirements.amount,
            paymentTx: handle.selfSettled.tx,
            reason: msg,
          });
          // Fire-and-forget: response reports the record's status; a
          // successful send flips the log entry to "sent" asynchronously.
          void opts.refunds.tryAutoRefund(rec);
          refund = { status: rec.status };
        }
        return refusalResponse(c, code, msg, {
          ...(refund ? { refund } : {}),
        });
      },
    };
    return handle;
  };
}
