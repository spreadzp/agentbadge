/**
 * Environment config type definitions (EPIC-140, SLICE-140-25).
 * All interfaces describing the shape of AppConfig and its sections.
 */

export type ChainMode = "hedera" | "evm" | "base";

export interface EvmConfig {
  rpcUrl: string;
  chainId: number;
  operatorKey: string;
  passportNft: string;
  escrow: string;
  eventLog: string;
  usdcAddress: string;
  explorerUrl: string;
}

export interface BaseConfig {
  rpcUrl: string;
  chainId: number;
  operatorKey: string;
  passportNft: string;
  taskEscrow: string;
  usdcAddress: string;
  explorerUrl: string;
  trustRegistry?: string;
  trustBadge?: string;
}

export interface UiConfig {
  chainDisplayName: string;
  currencySymbol: string;
  currencyDecimals: number;
  explorerName: string;
  accountLabel: string;
  accountPlaceholder: string;
}

export interface AttestcoinConfig {
  enabled: boolean;
  taskEscrowSepoliaAddr: string;
  taskMarketplaceAscAddr: string;
  taskStateAddr: string;
  sepoliaRpcUrl: string;
  creditcoinRpcUrl: string;
  proverUrl: string;
}

export interface X402Config {
  enabled: boolean;
  facilitatorUrl: string;
  payTo: string;
  price: string;
}

export interface AnalyticsConfig {
  ga4Enabled: boolean;
  ga4MeasurementId: string | undefined;
  ga4ApiSecret: string | undefined;
  plausibleEnabled: boolean;
  plausibleDomain: string | undefined;
  gscVerification: string | undefined;
}

/**
 * Circle nanopayments config (EPIC-129, D19).
 * Present only when CIRCLE_PAYMENTS_ENABLED=true; absent = feature off.
 */
export interface CirclePaymentsConfig {
  enabled: boolean;
  /** Gateway batch rail (BatchFacilitatorClient + GatewayEvmScheme) */
  gateway: boolean;
  /** Arc self-settle rail (eip3009-client-broadcast) */
  arc: boolean;
  /** Passport identity in 402 extensions + /api/identity endpoint */
  identity: boolean;
  /** ERC-8183 escrow jobs (Phase 2) */
  escrow: boolean;
  gatewayApiUrl: string;
  arcRpcUrl: string;
  arcChainId: number;
  sellerAddress: string;
  /** Server EOA key — required when arc or escrow enabled */
  arcPrivateKey?: string;
  /** Platform fee in basis points on escrow settlement (D28, 0 = off) */
  platformFeeBps: number;
  /** Treasury receiving the platform fee — required when fee > 0 */
  treasuryAddress?: string;
}

/**
 * Scan pack (rule bundle) config (EPIC-133, D4).
 * `enabled` gates the packs param + /api/scan-packs listing.
 * `pricingEnabled` gates x402 payment requirement — off = free pack
 * scans (testing), on = payment required. Independent flags: free pack
 * scans are possible with pricing off.
 */
export interface ScanPacksConfig {
  enabled: boolean;
  pricingEnabled: boolean;
  /** Optional per-cost-class price overrides (USDC decimal strings). */
  priceOverrides: { light?: string; medium?: string; heavy?: string };
}

/**
 * NFT access marketplace config (EPIC-138, SLICE-138-3).
 * `enabled` gates /api/market/* routes. x402 gating on passport mint +
 * service buy activates only when X402_FACILITATOR_URL is also set.
 */
export interface MarketplaceConfig {
  enabled: boolean;
  /** MarketplacePassNFT on Arc (passports + service passes). */
  nftAddress: string;
  /** MarketplaceSplitter on Arc — x402 payTo for service purchases. */
  splitterAddress: string;
  /** USDC ERC-20 on the payment chain (Base Sepolia). */
  usdcAddress: string;
  /** Platform treasury — passport sales payTo + splitter treasury. */
  treasury: string;
  /** Business passport price, USDC decimal string (e.g. "10"). */
  passportPriceUsd: string;
  /** Passport duration in days (≤365 on-chain, D11). */
  passportDurationDays: number;
}

export interface KeeperHubEnvConfig {
  enabled: boolean;
  apiKey: string;
  serverUrl: string;
  webhookKey?: string;
  auditSecret?: string;
  apiBaseUrl: string;
  triggerMode: "mcp" | "webhook";
  webhookUrls: Record<string, string>;
  x402?: X402Config;
  registryAddress?: string;
  badgeAddress?: string;
  workflowIds: {
    recordScan?: string;
    mintPassport?: string;
    notify?: string;
  };
}

/**
 * Database persistence config (EPIC-143, SLICE-143-4).
 * Present only when DATABASE_ENABLED=true; absent = in-memory fallback.
 */
export interface DatabaseEnvConfig {
  enabled: boolean;
  /** Pooled runtime URL (DATABASE_URL). */
  url: string;
  /** Unpooled URL for CLI/migrations — not used by the runtime. */
  directUrl?: string;
}

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
}

/**
 * Cache layer config (EPIC-144, SLICE-144-2).
 * Present only when CACHE_ENABLED=true; absent = InMemoryCache fallback.
 */
export interface CacheEnvConfig {
  enabled: boolean;
  backend: "memory" | "valkey" | "upstash";
  /** CACHE_URL — valkey://host:port (dev) or Upstash REST URL (prod). */
  url?: string;
  /** CACHE_TOKEN — Upstash REST token (prod only). */
  token?: string;
}

export interface AppConfig {
  chainMode: ChainMode;
  hederaOperatorId: string;
  hederaOperatorKey: string;
  hederaNetwork: string;
  passportTokenId: string;
  auditTopicId: string;
  directoryTopicId: string;
  x402FacilitatorUrl: string;
  x402FeePayer: string;
  x402Treasury: string;
  ipfsApiKey: string;
  ipfsApiSecret: string;
  port: number;
  mockHedera: boolean;
  mockX402: boolean;
  mockIpfs: boolean;
  evm?: EvmConfig;
  base?: BaseConfig;
  attestcoin: AttestcoinConfig;
  ui: UiConfig;
  analytics: AnalyticsConfig;
  keeperhub?: KeeperHubEnvConfig;
  circlePayments?: CirclePaymentsConfig;
  bstock?: BstockEnvConfig;
  database?: DatabaseEnvConfig;
  cache?: CacheEnvConfig;
  scanPacks: ScanPacksConfig;
  marketplace?: MarketplaceConfig;
}
