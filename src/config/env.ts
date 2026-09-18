/**
 * Environment configuration — loads and validates all required env vars.
 *
 * Reference: hackathon-flow.md §10 (canonical var names)
 * Reference: deployment-strategy.md §Phase 2
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
}

const ACCOUNT_ID_RE = /^0\.0\.\d+$/;
const URL_RE = /^https?:\/\/.+/;
const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

function isAccountId(value: string): boolean {
  return ACCOUNT_ID_RE.test(value);
}

function isUrl(value: string): boolean {
  return URL_RE.test(value);
}

function requiredString(name: string, errors: string[]): string | undefined {
  const value = process.env[name];
  if (!value || !value.trim()) {
    errors.push(`Missing required env var: ${name}`);
    return undefined;
  }
  return value.trim();
}

function requiredAccountId(name: string, errors: string[]): string | undefined {
  const value = requiredString(name, errors);
  if (value && !isAccountId(value)) {
    errors.push(`Invalid ${name}: expected format 0.0.X, got "${value}"`);
    return undefined;
  }
  return value;
}

function requiredUrl(name: string, errors: string[]): string | undefined {
  const value = requiredString(name, errors);
  if (value && !isUrl(value)) {
    errors.push(`Invalid ${name}: expected a valid URL, got "${value}"`);
    return undefined;
  }
  return value;
}

function requiredAddress(name: string, errors: string[]): string | undefined {
  const value = requiredString(name, errors);
  if (value && !ADDR_RE.test(value)) {
    errors.push(`Invalid ${name}: expected 0x-prefixed 40-hex address, got "${value}"`);
    return undefined;
  }
  return value;
}

function booleanFlag(name: string): boolean {
  return process.env[name] === "true";
}

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;
  cachedConfig = loadConfig();
  return cachedConfig;
}

export function resetConfigCache(): void {
  cachedConfig = null;
}

export function loadConfig(): AppConfig {
  const errors: string[] = [];

  const rawChainMode = process.env.CHAIN_MODE ?? "hedera";
  const chainMode = (["hedera", "evm", "base"].includes(rawChainMode) ? rawChainMode : "hedera") as ChainMode;

  let evm: EvmConfig | undefined;
  let base: BaseConfig | undefined;

  if (chainMode === "evm") {
    const evmRpcUrl = requiredUrl("EVM_RPC_URL", errors);
    const evmChainId = Number(process.env.EVM_CHAIN_ID ?? 1874);
    const evmOperatorKey = requiredString("EVM_OPERATOR_KEY", errors);
    const evmPassportNft = requiredAddress("EVM_PASSPORT_NFT_ADDRESS", errors);
    const evmEventLog = requiredAddress("EVM_EVENT_LOG_ADDRESS", errors);
    const evmEscrow = requiredAddress("EVM_ESCROW_ADDRESS", errors);
    const evmUsdc = requiredAddress("EVM_USDC_ADDRESS", errors);
    const evmExplorerUrl = requiredUrl("EVM_EXPLORER_URL", errors);

    if (errors.length > 0) {
      throw new Error(`Configuration errors:\n  - ${errors.join("\n  - ")}`);
    }

    evm = {
      rpcUrl: evmRpcUrl!,
      chainId: evmChainId,
      operatorKey: evmOperatorKey!,
      passportNft: evmPassportNft!,
      eventLog: evmEventLog!,
      escrow: evmEscrow!,
      usdcAddress: evmUsdc!,
      explorerUrl: evmExplorerUrl!,
    };
  }

  if (chainMode === "base") {
    const baseRpcUrl = requiredUrl("BASE_RPC_URL", errors);
    const baseChainId = Number(process.env.BASE_CHAIN_ID ?? 84532);
    const baseOperatorKey = requiredString("BASE_OPERATOR_KEY", errors);
    const basePassportNft = requiredAddress("BASE_PASSPORT_NFT", errors);
    const baseTaskEscrow = requiredAddress("BASE_TASK_ESCROW", errors);
    const baseUsdc = requiredAddress("BASE_USDC_ADDRESS", errors);
    const baseExplorerUrl = process.env.BASE_EXPLORER_URL ?? "https://sepolia.basescan.org";

    if (errors.length > 0) {
      throw new Error(`Configuration errors:\n  - ${errors.join("\n  - ")}`);
    }

    base = {
      rpcUrl: baseRpcUrl!,
      chainId: baseChainId,
      operatorKey: baseOperatorKey!,
      passportNft: basePassportNft!,
      taskEscrow: baseTaskEscrow!,
      usdcAddress: baseUsdc!,
      explorerUrl: baseExplorerUrl,
      trustRegistry: process.env.BASE_TRUST_REGISTRY,
      trustBadge: process.env.BASE_TRUST_BADGE,
    };
  }

  // Hedera fields — required only in hedera mode
  let hederaOperatorId: string | undefined;
  let hederaOperatorKey: string | undefined;
  let passportTokenId: string | undefined;
  let auditTopicId: string | undefined;
  let directoryTopicId: string | undefined;
  let x402FacilitatorUrl: string | undefined;
  let x402FeePayer: string | undefined;
  let x402Treasury: string | undefined;
  let ipfsApiKey: string | undefined;
  let ipfsApiSecret: string | undefined;

  if (chainMode === "hedera") {
    hederaOperatorId = requiredAccountId("HEDERA_OPERATOR_ID", errors);
    hederaOperatorKey = requiredString("HEDERA_OPERATOR_KEY", errors);
    passportTokenId = requiredAccountId("PASSPORT_TOKEN_ID", errors);
    auditTopicId = requiredAccountId("AUDIT_TOPIC_ID", errors);
    directoryTopicId = requiredAccountId("DIRECTORY_TOPIC_ID", errors);
    x402FacilitatorUrl = requiredUrl("x402_FACILITATOR_URL", errors);
    x402FeePayer = requiredAccountId("x402_FEE_PAYER", errors);
    x402Treasury = requiredAccountId("x402_TREASURY", errors);
    ipfsApiKey = requiredString("IPFS_API_KEY", errors);
    ipfsApiSecret = requiredString("IPFS_API_SECRET", errors);
  }

  // KeeperHub config — optional, only loaded when enabled
  const keeperhubEnabled = booleanFlag("KEEPERHUB_ENABLED");
  let keeperhub: KeeperHubEnvConfig | undefined;
  if (keeperhubEnabled) {
    const khApiKey = requiredString("KEEPERHUB_API_KEY", errors);
    if (khApiKey && !khApiKey.startsWith("kh_")) {
      errors.push("Invalid KEEPERHUB_API_KEY: expected kh_ prefix (wfb_ keys are for webhook triggers only)");
    }
    const khWebhookKey = process.env.KEEPERHUB_WEBHOOK_KEY;
    if (khWebhookKey && !khWebhookKey.startsWith("wfb_")) {
      errors.push("Invalid KEEPERHUB_WEBHOOK_KEY: expected wfb_ prefix");
    }
    // Parse webhook URLs JSON map (workflowName → url)
    let khWebhookUrls: Record<string, string> = {};
    const khWebhookUrlsRaw = process.env.KEEPERHUB_WEBHOOK_URLS;
    if (khWebhookUrlsRaw) {
      try {
        khWebhookUrls = JSON.parse(khWebhookUrlsRaw);
      } catch {
        errors.push("Invalid KEEPERHUB_WEBHOOK_URLS: expected JSON object");
      }
    }
    const khTriggerMode = (process.env.KEEPERHUB_TRIGGER_MODE ?? "mcp") as "mcp" | "webhook";

    // x402 premium config — optional, default disabled
    const x402Enabled = booleanFlag("KEEPERHUB_X402_ENABLED");
    let x402: X402Config | undefined;
    if (x402Enabled) {
      x402 = {
        enabled: true,
        facilitatorUrl: process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
        payTo: process.env.X402_PAY_TO ?? "",
        price: process.env.X402_PRICE ?? "$0.01",
      };
      if (!x402.payTo) {
        errors.push("X402_PAY_TO required when KEEPERHUB_X402_ENABLED=true");
      }
    }

    keeperhub = {
      enabled: true,
      apiKey: khApiKey ?? "",
      serverUrl: process.env.KEEPERHUB_SERVER_URL ?? "https://app.keeperhub.com/mcp",
      webhookKey: khWebhookKey,
      auditSecret: process.env.KEEPERHUB_AUDIT_SECRET,
      apiBaseUrl: process.env.KEEPERHUB_API_BASE_URL ?? process.env.BASE_URL ?? "https://agentbadge.xyz",
      triggerMode: khTriggerMode,
      webhookUrls: khWebhookUrls,
      x402,
      registryAddress: process.env.KEEPERHUB_REGISTRY_ADDRESS,
      badgeAddress: process.env.KEEPERHUB_BADGE_ADDRESS,
      workflowIds: {
        recordScan: process.env.KEEPERHUB_WORKFLOW_RECORD_SCAN,
        mintPassport: process.env.KEEPERHUB_WORKFLOW_MINT_PASSPORT,
        notify: process.env.KEEPERHUB_WORKFLOW_NOTIFY,
      },
    };
  }

  // Circle payments config — optional, only loaded when enabled (D19)
  const circlePaymentsEnabled = booleanFlag("CIRCLE_PAYMENTS_ENABLED");
  let circlePayments: CirclePaymentsConfig | undefined;
  if (circlePaymentsEnabled) {
    const sellerAddress = requiredAddress("CIRCLE_SELLER_ADDRESS", errors);
    const arc = booleanFlag("CIRCLE_ARC_ENABLED");
    const escrow = booleanFlag("CIRCLE_ESCROW_ENABLED");
    let arcPrivateKey: string | undefined;
    if (arc || escrow) {
      arcPrivateKey = requiredString("ARC_PRIVATE_KEY", errors);
    }
    circlePayments = {
      enabled: true,
      gateway: booleanFlag("CIRCLE_GATEWAY_ENABLED"),
      arc,
      identity: booleanFlag("CIRCLE_IDENTITY_ENABLED"),
      escrow,
      gatewayApiUrl:
        process.env.CIRCLE_GATEWAY_API_URL ??
        "https://gateway-api-testnet.circle.com",
      arcRpcUrl:
        process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network",
      arcChainId: Number(process.env.ARC_CHAIN_ID ?? 5042002),
      sellerAddress: sellerAddress ?? "",
      arcPrivateKey,
      platformFeeBps: Number(process.env.CIRCLE_PLATFORM_FEE_BPS ?? 0),
      treasuryAddress: process.env.CIRCLE_TREASURY_ADDRESS,
    };
    if (
      circlePayments.platformFeeBps > 0 &&
      !circlePayments.treasuryAddress
    ) {
      errors.push(
        "CIRCLE_TREASURY_ADDRESS required when CIRCLE_PLATFORM_FEE_BPS > 0",
      );
    }
  }

  const hederaNetwork = process.env.HEDERA_NETWORK ?? "testnet";
  const port = Number(process.env.PORT ?? 4021);

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n  - ${errors.join("\n  - ")}`);
  }

  const attestcoin: AttestcoinConfig = {
    enabled: booleanFlag("ATTESTCOIN_ENABLED"),
    taskEscrowSepoliaAddr: process.env.TASK_ESCROW_SEPOLIA_ADDR ?? "",
    taskMarketplaceAscAddr: process.env.TASK_MARKETPLACE_ASC_ADDR ?? "",
    taskStateAddr: process.env.TASK_STATE_ADDR ?? "",
    sepoliaRpcUrl: process.env.SEPOLIA_RPC_URL ?? "",
    creditcoinRpcUrl: process.env.CREDITCOIN_RPC_URL ?? "https://rpc.cc3-testnet.creditcoin.network",
    proverUrl: process.env.ATTESTCOIN_PROVER_URL ?? "https://prover.cc3-testnet.creditcoin.network",
  };

  const analytics: AnalyticsConfig = {
    ga4Enabled: booleanFlag("GA4_ENABLED"),
    ga4MeasurementId: process.env.GA4_MEASUREMENT_ID,
    ga4ApiSecret: process.env.GA4_API_SECRET,
    plausibleEnabled: booleanFlag("PLAUSIBLE_ENABLED"),
    plausibleDomain: process.env.PLAUSIBLE_DOMAIN,
    gscVerification: process.env.GOOGLE_SITE_VERIFICATION,
  };

  return {
    chainMode,
    hederaOperatorId: hederaOperatorId ?? "",
    hederaOperatorKey: hederaOperatorKey ?? "",
    hederaNetwork,
    passportTokenId: passportTokenId ?? "",
    auditTopicId: auditTopicId ?? "",
    directoryTopicId: directoryTopicId ?? "",
    x402FacilitatorUrl: x402FacilitatorUrl ?? "",
    x402FeePayer: x402FeePayer ?? "",
    x402Treasury: x402Treasury ?? "",
    ipfsApiKey: ipfsApiKey ?? "",
    ipfsApiSecret: ipfsApiSecret ?? "",
    port,
    mockHedera: booleanFlag("MOCK_HEDERA"),
    mockX402: booleanFlag("MOCK_X402"),
    mockIpfs: booleanFlag("MOCK_IPFS"),
    evm,
    base,
    attestcoin,
    ui: loadUiConfig(chainMode),
    analytics,
    keeperhub,
    circlePayments,
  };
}

function loadUiConfig(chainMode: ChainMode): UiConfig {
  const defaults: Record<ChainMode, UiConfig> = {
    hedera: {
      chainDisplayName: "Hedera Testnet",
      currencySymbol: "HBAR",
      currencyDecimals: 8,
      explorerName: "HashScan",
      accountLabel: "Hedera Account ID",
      accountPlaceholder: "0.0.xxxx",
    },
    evm: {
      chainDisplayName: "EVM Testnet",
      currencySymbol: "USDC",
      currencyDecimals: 6,
      explorerName: "Explorer",
      accountLabel: "Wallet Address",
      accountPlaceholder: "0x...",
    },
    base: {
      chainDisplayName: "Base Sepolia",
      currencySymbol: "USDC",
      currencyDecimals: 6,
      explorerName: "Basescan",
      accountLabel: "Wallet Address",
      accountPlaceholder: "0x...",
    },
  };

  const d = defaults[chainMode];
  return {
    chainDisplayName: process.env.CHAIN_DISPLAY_NAME ?? d.chainDisplayName,
    currencySymbol: process.env.CURRENCY_SYMBOL ?? d.currencySymbol,
    currencyDecimals: Number(process.env.CURRENCY_DECIMALS ?? d.currencyDecimals),
    explorerName: process.env.EXPLORER_NAME ?? d.explorerName,
    accountLabel: process.env.ACCOUNT_LABEL ?? d.accountLabel,
    accountPlaceholder: process.env.ACCOUNT_PLACEHOLDER ?? d.accountPlaceholder,
  };
}
