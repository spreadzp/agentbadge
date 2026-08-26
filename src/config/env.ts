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
}

export interface UiConfig {
  chainDisplayName: string;
  currencySymbol: string;
  currencyDecimals: number;
  explorerName: string;
  accountLabel: string;
  accountPlaceholder: string;
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
  ui: UiConfig;
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

  const hederaNetwork = process.env.HEDERA_NETWORK ?? "testnet";
  const port = Number(process.env.PORT ?? 4021);

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n  - ${errors.join("\n  - ")}`);
  }

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
    ui: loadUiConfig(chainMode),
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
