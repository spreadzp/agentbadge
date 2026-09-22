/**
 * Core env config — chain-mode sections, ui, analytics, and the
 * loadConfig/getConfig/resetConfigCache orchestration (EPIC-140, SLICE-140-25).
 *
 * Reference: hackathon-flow.md §10 (canonical var names)
 * Reference: deployment-strategy.md §Phase 2
 */

import { loadAttestcoin } from "./attestcoin";
import { loadBstock } from "./bstock";
import { loadCirclePayments } from "./circle-payments";
import { loadDatabase } from "./database";
import { loadKeeperHub } from "./keeperhub";
import { loadMarketplace } from "./marketplace";
import { loadScanPacks } from "./scan-packs";
import type {
  AnalyticsConfig,
  AppConfig,
  BaseConfig,
  ChainMode,
  EvmConfig,
  UiConfig,
} from "./types";
import {
  booleanFlag,
  requiredAccountId,
  requiredAddress,
  requiredString,
  requiredUrl,
  throwIfErrors,
} from "./validators";

function loadEvmConfig(errors: string[]): EvmConfig {
  const evmRpcUrl = requiredUrl("EVM_RPC_URL", errors);
  const evmChainId = Number(process.env.EVM_CHAIN_ID ?? 1874);
  const evmOperatorKey = requiredString("EVM_OPERATOR_KEY", errors);
  const evmPassportNft = requiredAddress("EVM_PASSPORT_NFT_ADDRESS", errors);
  const evmEventLog = requiredAddress("EVM_EVENT_LOG_ADDRESS", errors);
  const evmEscrow = requiredAddress("EVM_ESCROW_ADDRESS", errors);
  const evmUsdc = requiredAddress("EVM_USDC_ADDRESS", errors);
  const evmExplorerUrl = requiredUrl("EVM_EXPLORER_URL", errors);

  throwIfErrors(errors);

  return {
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

function loadBaseConfig(errors: string[]): BaseConfig {
  const baseRpcUrl = requiredUrl("BASE_RPC_URL", errors);
  const baseChainId = Number(process.env.BASE_CHAIN_ID ?? 84532);
  const baseOperatorKey = requiredString("BASE_OPERATOR_KEY", errors);
  const basePassportNft = requiredAddress("BASE_PASSPORT_NFT", errors);
  const baseTaskEscrow = requiredAddress("BASE_TASK_ESCROW", errors);
  const baseUsdc = requiredAddress("BASE_USDC_ADDRESS", errors);
  const baseExplorerUrl =
    process.env.BASE_EXPLORER_URL ?? "https://sepolia.basescan.org";

  throwIfErrors(errors);

  return {
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

/** Hedera-mode fields — validated only when chainMode === "hedera". */
interface HederaFields {
  hederaOperatorId?: string;
  hederaOperatorKey?: string;
  passportTokenId?: string;
  auditTopicId?: string;
  directoryTopicId?: string;
  x402FacilitatorUrl?: string;
  x402FeePayer?: string;
  x402Treasury?: string;
  ipfsApiKey?: string;
  ipfsApiSecret?: string;
}

function loadHederaFields(errors: string[]): HederaFields {
  return {
    hederaOperatorId: requiredAccountId("HEDERA_OPERATOR_ID", errors),
    hederaOperatorKey: requiredString("HEDERA_OPERATOR_KEY", errors),
    passportTokenId: requiredAccountId("PASSPORT_TOKEN_ID", errors),
    auditTopicId: requiredAccountId("AUDIT_TOPIC_ID", errors),
    directoryTopicId: requiredAccountId("DIRECTORY_TOPIC_ID", errors),
    x402FacilitatorUrl: requiredUrl("x402_FACILITATOR_URL", errors),
    x402FeePayer: requiredAccountId("x402_FEE_PAYER", errors),
    x402Treasury: requiredAccountId("x402_TREASURY", errors),
    ipfsApiKey: requiredString("IPFS_API_KEY", errors),
    ipfsApiSecret: requiredString("IPFS_API_SECRET", errors),
  };
}

function loadAnalytics(): AnalyticsConfig {
  return {
    ga4Enabled: booleanFlag("GA4_ENABLED"),
    ga4MeasurementId: process.env.GA4_MEASUREMENT_ID,
    ga4ApiSecret: process.env.GA4_API_SECRET,
    plausibleEnabled: booleanFlag("PLAUSIBLE_ENABLED"),
    plausibleDomain: process.env.PLAUSIBLE_DOMAIN,
    gscVerification: process.env.GOOGLE_SITE_VERIFICATION,
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
    currencyDecimals: Number(
      process.env.CURRENCY_DECIMALS ?? d.currencyDecimals,
    ),
    explorerName: process.env.EXPLORER_NAME ?? d.explorerName,
    accountLabel: process.env.ACCOUNT_LABEL ?? d.accountLabel,
    accountPlaceholder:
      process.env.ACCOUNT_PLACEHOLDER ?? d.accountPlaceholder,
  };
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
  const chainMode = (
    ["hedera", "evm", "base"].includes(rawChainMode) ? rawChainMode : "hedera"
  ) as ChainMode;

  // Chain-mode sections — evm/base throw early on validation errors.
  const evm = chainMode === "evm" ? loadEvmConfig(errors) : undefined;
  const base = chainMode === "base" ? loadBaseConfig(errors) : undefined;
  const hedera = chainMode === "hedera" ? loadHederaFields(errors) : {};

  // Optional feature sections — accumulate errors.
  const keeperhub = loadKeeperHub(errors);
  const circlePayments = loadCirclePayments(errors);
  const bstock = loadBstock(errors);
  const database = loadDatabase(errors);

  const hederaNetwork = process.env.HEDERA_NETWORK ?? "testnet";
  const port = Number(process.env.PORT ?? 4021);

  throwIfErrors(errors);

  const attestcoin = loadAttestcoin();
  const analytics = loadAnalytics();
  const scanPacks = loadScanPacks();
  // Marketplace validation errors accumulate but are not thrown (matches
  // original ordering — the throw above precedes this section).
  const marketplace = loadMarketplace(errors);

  return {
    chainMode,
    hederaOperatorId: hedera.hederaOperatorId ?? "",
    hederaOperatorKey: hedera.hederaOperatorKey ?? "",
    hederaNetwork,
    passportTokenId: hedera.passportTokenId ?? "",
    auditTopicId: hedera.auditTopicId ?? "",
    directoryTopicId: hedera.directoryTopicId ?? "",
    x402FacilitatorUrl: hedera.x402FacilitatorUrl ?? "",
    x402FeePayer: hedera.x402FeePayer ?? "",
    x402Treasury: hedera.x402Treasury ?? "",
    ipfsApiKey: hedera.ipfsApiKey ?? "",
    ipfsApiSecret: hedera.ipfsApiSecret ?? "",
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
    bstock,
    database,
    scanPacks,
    marketplace,
  };
}
