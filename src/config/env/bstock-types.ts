/** bStock tracker config (EPIC-141). Loaded when BSTOCK_ENABLED=true. */
export interface BstockEnvConfig {
  enabled: boolean;
  /** Bearer token → agentId map (MCP_AGENT_TOKENS=agent:token,...). */
  agentTokens: Map<string, string>;
  /** Per-token rate limit, req/min (default 60). */
  rateLimitPerMin: number;
  /** Max concurrent SSE connections (default 20). */
  maxSseConnections: number;
  /** Freemium (141-7): marketplace service id (bytes32). */
  serviceId: `0x${string}`;
  /** ServicePass price in USDC (default "5"). */
  priceUsd: string;
  /** Pass lifetime seconds (default 30d). */
  durationSec: number;
  /** Treasury address for x402 payments (X402_PAY_TO). */
  payTo: string;
  /** x402 facilitator URL (X402_FACILITATOR_URL) — empty disables payments. */
  facilitatorUrl: string;
  /** Arc network for x402 settlement + ServicePass — BSTOCK_ARC_NETWORK,
   *  "eip155:5042002" (testnet, default) | "eip155:5042" (mainnet, 151-7). */
  arcNetwork: string;
  /** MarketplacePassNFT address on the selected Arc network — BSTOCK_NFT.
   *  Falls back to marketplace.nftAddress when unset (testnet shared NFT). */
  nftAddress?: string;
}
