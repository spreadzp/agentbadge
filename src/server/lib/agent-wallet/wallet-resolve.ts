// SLICE-176-7: wallet resolution extracted from enforcer.ts
// (300-line file limit). Precedence: verified agentWallet ctx →
// X-Wallet header → x402 PAYMENT-SIGNATURE authorization.from.

import type { Context } from "hono";
import { isAddress } from "viem";

/** Best-effort x402 payer extraction from PAYMENT-SIGNATURE (EIP-3009). */
function payerFromPaymentSig(c: Context): string | undefined {
  const hdr = c.req.header("payment-signature");
  if (!hdr) return undefined;
  try {
    const decoded = JSON.parse(
      Buffer.from(hdr, "base64").toString("utf8"),
    ) as Record<string, unknown>;
    const payload = (decoded.payload ?? decoded) as Record<string, unknown>;
    const auth = (payload.authorization ?? payload) as Record<string, unknown>;
    const from = auth.from ?? decoded.from;
    return typeof from === "string" && isAddress(from) ? from : undefined;
  } catch {
    return undefined;
  }
}

export function resolveSpendWallet(c: Context): string | undefined {
  const ctxWallet = c.get("agentWallet") as string | undefined;
  if (ctxWallet && isAddress(ctxWallet)) return ctxWallet.toLowerCase();
  const hdr = c.req.header("x-wallet");
  if (hdr && isAddress(hdr)) return hdr.toLowerCase();
  return payerFromPaymentSig(c)?.toLowerCase();
}
