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
    if (!serviceId) {
      logger.error("marketplace-mint: no serviceId in request path", {
        payer,
        paymentTx: ctx.result.transaction,
      });
      return;
    }
    const svc = getService(serviceId);
    if (!svc) {
      logger.error("marketplace-mint: serviceId not in catalog", {
        serviceId,
        payer,
        paymentTx: ctx.result.transaction,
      });
      return;
    }
    const ops = getMarketplaceOps();
    const amount = ctx.result.amount ?? ctx.requirements?.amount ?? "0";
    const durationSec = svc.durationSec ?? svc.durationDays * 86_400;

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
        paymentTx: ctx.result.transaction,
      });
    }

    try {
      const mintTx = await ops.mintServicePass(payer, serviceId, durationSec, 0n);
      logger.info("marketplace-mint: service pass minted/extended", {
        payer,
        serviceId,
        durationSec,
        mintTx,
        paymentTx: ctx.result.transaction,
      });
    } catch (err) {
      logger.error("marketplace-mint: mint failed after settle", {
        payer,
        serviceId,
        err: String(err),
        paymentTx: ctx.result.transaction,
      });
    }
  };
}
