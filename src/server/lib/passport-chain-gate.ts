/**
 * SLICE-169-9 (Hedera diet): gate for Hedera chain call-sites.
 * With PASSPORT_CHAIN_ENABLED unset the server must start without
 * loading chain modules (@agentbadge/hedera-core / @hashgraph-sdk /
 * @x402/hedera / hiero-ledger) — passport internals lazy-import them
 * only when a gated call actually runs. Disabled sites answer 503
 * `passport_chain_disabled` instead of reaching for the chain.
 */

import type { Context } from "hono";
import { getConfig } from "../../config/env";
import { ErrorCodes } from "./error-codes";
import { errorResponse } from "./error-response";

export function passportChainEnabled(): boolean {
  return getConfig().passportChain?.enabled === true;
}

/** 501-style refusal for chain routes when the flag is off. */
export function chainDisabled(c: Context): Response {
  return errorResponse(
    c,
    503,
    ErrorCodes.PASSPORT_CHAIN_DISABLED,
    "Hedera chain features are disabled (set PASSPORT_CHAIN_ENABLED=true)",
    { retryable: true },
  );
}
