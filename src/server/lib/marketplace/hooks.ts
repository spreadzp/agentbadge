// ─── x402 afterSettle hook: credit splitter + mint pass ────────
import { logger } from "@agentbadge/passport";
import { getService } from "./catalog";
import { getMarketplaceOps } from "./ops";

interface SettleResultLike {
  success: boolean;
  payer?: string;
  amount?: string;
  transaction?: string;
}

interface SettleContextLike {
  result: SettleResultLike;
  requirements?: { amount?: string };
  transportContext?: unknown;
}

const BUY_PATH_RE = /\/api\/market\/buy\/(0x[a-fA-F0-9]{64})/;

/** Extract serviceId from the request path in transportContext. */
function serviceIdFromContext(ctx: SettleContextLike): `0x${string}` | null {
  const tc = ctx.transportContext as
    | { request?: { path?: string } }
    | undefined;
  const m = tc?.request?.path ? BUY_PATH_RE.exec(tc.request.path) : null;
  return m ? (m[1].toLowerCase() as `0x${string}`) : null;
}

/**
 * AfterSettleHook for the marketplace resource server.
 * On settled buy: credit the splitter (90/10 bookkeeping) then mint/extend
 * the payer's service pass. Failures are logged, never rethrown — the
 * payment is already settled (same pattern as access-pass-minter, D10).
 */
export function createMarketplaceMintOnSettleHook() {
  return async (ctx: SettleContextLike): Promise<void> => {
    const payer = ctx.result?.payer;
    if (!ctx.result?.success || !payer) {
      if (ctx.result?.success) {
        logger.warn("marketplace-mint: settled but no payer — skipping");
      }
      return;
    }
    const serviceId = serviceIdFromContext(ctx);
    await runMarketplaceMint({
      serviceId,
      payer,
      amount: ctx.result.amount ?? ctx.requirements?.amount ?? "0",
      paymentTx: ctx.result.transaction,
      credit: true,
    });
  };
}

/** Shared mint core — old hook and the 157-3 runtime adapter. */
async function runMarketplaceMint(args: {
  serviceId: `0x${string}` | null;
  payer: string;
  amount: string;
  paymentTx?: string;
  /** Base rail: USDC landed on the splitter → credit 90/10 bookkeeping.
   *  Arc self-settle: payment went to treasury — no credit (5A). */
  credit: boolean;
}): Promise<void> {
  const { serviceId, payer, amount, paymentTx, credit } = args;
  if (!serviceId) {
    logger.error("marketplace-mint: no serviceId in request path", {
      payer,
      paymentTx,
    });
    return;
  }
  const svc = getService(serviceId);
  if (!svc) {
    logger.error("marketplace-mint: serviceId not in catalog", {
      serviceId,
      payer,
      paymentTx,
    });
    return;
  }
  const ops = getMarketplaceOps();
  const durationSec = svc.durationSec ?? svc.durationDays * 86_400;

  if (credit) {
    try {
      const creditTx = await ops.creditPayment(serviceId, BigInt(amount));
      logger.info("marketplace-mint: splitter credited", {
        serviceId,
        amount,
        creditTx,
      });
    } catch (err) {
      logger.error("marketplace-mint: splitter credit failed", {
        serviceId,
        amount,
        err: String(err),
        paymentTx,
      });
    }
  }

  try {
    const mintTx = await ops.mintServicePass(payer, serviceId, durationSec, 0n);
    logger.info("marketplace-mint: service pass minted/extended", {
      payer,
      serviceId,
      durationSec,
      mintTx,
      paymentTx,
    });
  } catch (err) {
    logger.error("marketplace-mint: mint failed after settle", {
      payer,
      serviceId,
      err: String(err),
      paymentTx,
    });
  }
}

/** Hono Context subset needed by the settle hook (path only). */
interface PaymentContextLike {
  req: { path: string };
}

/**
 * SLICE-157-3 (D6-157): onSettleResult-shaped hook for the circle-payments
 * `requirePayment` middleware (buy route on the new runtime). Branch on the
 * settled rail: arc self-settle → mint only (payment went to treasury, no
 * split); base exact/gateway → splitter credit + mint (legacy semantics).
 */
export function createMarketplaceMintOnPaymentSettled() {
  return async (args: {
    c: PaymentContextLike;
    ok: boolean;
    payment?: {
      payer?: string;
      amount?: string;
      transaction?: string;
      network?: string;
      scheme?: string;
    };
    error?: string;
  }): Promise<void> => {
    const { c, ok, payment } = args;
    const payer = payment?.payer;
    if (!ok || !payer) {
      if (ok) {
        logger.warn("marketplace-mint: settled but no payer — skipping");
      }
      return;
    }
    const m = BUY_PATH_RE.exec(c.req.path);
    const serviceId = (m?.[1]?.toLowerCase() ?? null) as `0x${string}` | null;
    const isArcSelfSettle = payment?.scheme === "eip3009-client-broadcast";
    await runMarketplaceMint({
      serviceId,
      payer,
      amount: payment?.amount ?? "0",
      paymentTx: payment?.transaction,
      credit: !isArcSelfSettle,
    });
  };
}
