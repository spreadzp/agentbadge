/**
 * Environment config type definitions (EPIC-140, SLICE-140-25).
 * All interfaces describing the shape of AppConfig and its sections.
 */

import type { SupportedChain } from "@agentbadge/circle-payments";

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
  /** Optional icon URL shown inside the header chain badge (e.g. /icons/arc.png). */
  chainBadgeIcon?: string;
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
  /** Arc mainnet (eip155:5042) surface — EPIC-151 */
  arcMainnet: boolean;
  arcMainnetRpcUrl: string;
  /** Evaluator EOA key for ERC-8004 feedback — required when arcMainnet enabled (D6-151). */
  arcEvaluatorKey?: string;
  /** Readiness attestation route — POST /api/attestations (151-3) */
  attestation: boolean;
  /** Oracle agentId for site attestations (ARC_ORACLE_AGENT_ID). */
  oracleAgentId?: string;
  /** Seller wallet receiving payments */
  sellerAddress: string;
  /** SLICE-156-1: CIRCLE_GATEWAY_CHAINS — CSV of CAIP-2/chain ids */
  gatewayChains?: SupportedChain[];
  /** Gateway facilitator probe interval — CIRCLE_GATEWAY_PROBE_MS */
  gatewayProbeMs?: number;
  /** How long a gateway failure marks the rail down — CIRCLE_GATEWAY_DOWN_MS */
  gatewayDownMs?: number;
  /** SLICE-156-2: min Gateway deposit USD — GATEWAY_MIN_DEPOSIT_USD (default "0.10") */
  gatewayMinDepositUsd: string;
  /** SLICE-156-3: settle poller ms — GATEWAY_SETTLE_POLL_MS (default 30000) */
  gatewaySettlePollMs?: number;
  /** SLICE-156-3: settle grace before expired — GATEWAY_EXPIRY_GRACE_MS (default 600000) */
  gatewayExpiryGraceMs?: number;
  /** SLICE-156-4: crosschain take USD — GATEWAY_CROSSCHAIN_TAKE_USD (default "0") */
  gatewayCrosschainTakeUsd?: string;
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
  /** Arc network for x402 settlement + ServicePass — BSTOCK_ARC_NETWORK,
   *  "eip155:5042002" (testnet, default) | "eip155:5042" (mainnet, 151-7). */
  arcNetwork: string;
  /** MarketplacePassNFT address on the selected Arc network — BSTOCK_NFT.
   *  Falls back to marketplace.nftAddress when unset (testnet shared NFT). */
  nftAddress?: string;
}

/**
 * Evaluator-as-a-Service config (EPIC-154, SLICE-154-1).
 * Present only when ARC_EAAS_ENABLED=true; absent = feature off.
 */
export interface EaasEnvConfig {
  enabled: boolean;
  /** EIP-712 verdict signer EOA private key — NOT ARC_EVALUATOR_KEY. */
  signerKey: string;
  /** VerdictStore backend — json (default) | sqlite. */
  store: "json" | "sqlite";
  /** SLICE-154-2: flat per-verdict price, "$x.xx" USDC (ARC_EAAS_VERDICT_USD atomic → dollar). */
  verdictUsd: string;
  /** SLICE-154-2: readiness-scan price override (ARC_EAAS_SCAN_USD). */
  scanUsd: string;
  /** SLICE-154-2: deliverable.data size cap in bytes (ARC_EAAS_MAX_BYTES). */
  maxBytes: number;
  /** SLICE-154-2: per-consumer + global requests/min cap (ARC_EAAS_RATE_RPM). */
  rateRpm: number;
  /** SLICE-154-3: fee per external-job evaluate (ARC_EAAS_EVAL_USD). */
  evalUsd: string;
  /** SLICE-154-3: settle tx aborts when estimateGas > cap (ARC_EAAS_GAS_CAP). */
  gasCap: number;
  /** SLICE-154-4: anchor each verdict in an onchain memo (ARC_EAAS_MEMO_ANCHOR, default 1). */
  memoAnchor: boolean;
  /** SLICE-154-4: anchor retry attempts before status "failed" (ARC_EAAS_ANCHOR_RETRIES). */
  anchorRetries: number;
  /** SLICE-154-5: basic-tier subscription price, "$x.xx" (ARC_EAAS_TIER_BASIC_USD atomic). */
  tierBasicUsd: string;
  /** SLICE-154-5: pro-tier subscription price, "$x.xx" (ARC_EAAS_TIER_PRO_USD atomic). */
  tierProUsd: string;
  /** SLICE-154-5: tier→{quota,policies} (ARC_EAAS_TIER_QUOTAS JSON); ["*"]=all. */
  tierQuotas: Record<string, { quota: number; policies: string[] }>;
  /** SLICE-154-6: HMAC secret for webhook signatures (ARC_EAAS_WEBHOOK_SECRET). */
  webhookSecret?: string;
  /** SLICE-154-6: async request timeout, seconds (ARC_EAAS_ASYNC_TIMEOUT_S, default 120). */
  asyncTimeoutSec: number;
}

/** Agent Wallet (EPIC-155); absent = feature off.
 *  Type lives in ./agent-wallet-types.ts (types.ts hit 300 lines). */
export type { AgentWalletEnvConfig } from "./agent-wallet-types";
import type { AgentWalletEnvConfig } from "./agent-wallet-types";

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
  eaas?: EaasEnvConfig;
  agentWallet?: AgentWalletEnvConfig;
  database?: DatabaseEnvConfig;
  cache?: CacheEnvConfig;
  scanPacks: ScanPacksConfig;
  marketplace?: MarketplaceConfig;
}
