/**
 * USDC rail selection — extracted from `attempt.ts` (file-size lint cap).
 *
 * network/recipient/token are resolved here and only here, from server
 * config (spec invariant). H-4: own-property lookup only —
 * `__proto__`/`constructor` must hit the "not configured" branch, not
 * resolve an inherited key.
 */
import { CheckoutError } from "./errors";
import type { UsdcNetworks } from "./usdc-provider";

/** H-7: find an open, payable attempt for the same provider+network —
 *  it already carries live instructions, so retries reuse it instead
 *  of minting a second payable session. */
export function findReusableAttempt<T extends {
  status: string;
  provider: string;
  providerReference?: string | null;
  network?: string | null;
}>(
  priorAttempts: T[],
  provider: string,
  network: string | undefined,
  isUsdc: boolean,
): T | undefined {
  return priorAttempts.find(
    (a) =>
      a.status === "PENDING" &&
      a.provider === provider &&
      a.providerReference &&
      (isUsdc ? a.network === network : true),
  );
}

/** Rail-side metadata persisted on the attempt payload (for reuse). */
export function railMetadataFromPayload(
  payload: unknown,
): Record<string, unknown> | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  return (payload as Record<string, unknown>).rail as
    | Record<string, unknown>
    | undefined;
}

export interface ResolvedUsdcNetwork {
  network: string;
  recipient: string;
  token: string;
  expiresAt: Date;
}

export function resolveUsdcNetwork(deps: {
  usdcNetworks: UsdcNetworks;
  usdcInstructionsTtlSec: number;
  now: () => Date;
  /** Client-requested network tag, if any. */
  network?: string;
}): ResolvedUsdcNetwork {
  const own = (tag: string) => Object.hasOwn(deps.usdcNetworks, tag);
  const network =
    deps.network ??
    Object.keys(deps.usdcNetworks).find(
      (tag) => deps.usdcNetworks[tag].label === "arc",
    ) ??
    Object.keys(deps.usdcNetworks)[0];
  const cfg = network && own(network) ? deps.usdcNetworks[network] : undefined;
  if (!cfg || !network) {
    throw new CheckoutError(
      "network_not_supported",
      400,
      `USDC network not configured: ${deps.network ?? "<none>"}`,
      { available: Object.keys(deps.usdcNetworks) },
    );
  }
  return {
    network,
    recipient: cfg.recipient,
    token: cfg.tokenContract,
    expiresAt: new Date(
      deps.now().getTime() + deps.usdcInstructionsTtlSec * 1000,
    ),
  };
}
