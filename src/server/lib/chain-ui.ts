/**
 * Chain-aware UI utilities — replaces hardcoded hashscan.io/HBAR references.
 *
 * All functions read from AppConfig (set in SLICE-90-4).
 * Used by view templates to generate explorer links, format prices,
 * and display correct labels per chain mode.
 */

import { getConfig, type AppConfig } from "../../config/env.js";

function config(): AppConfig {
  return getConfig();
}

function explorerBaseUrl(): string {
  const cfg = config();
  if (cfg.chainMode === "hedera") {
    return `https://hashscan.io/${cfg.hederaNetwork}`;
  }
  if (cfg.chainMode === "base" && cfg.base) {
    return cfg.base.explorerUrl;
  }
  if (cfg.chainMode === "evm" && cfg.evm) {
    return cfg.evm.explorerUrl;
  }
  return `https://hashscan.io/${cfg.hederaNetwork}`;
}

/**
 * Build transaction explorer URL.
 * Hedera txId format: "0.0.123@1678886400.123456789" → hashscan.io/testnet/transaction/0.0.123-1678886400-123456789
 * EVM txId format: "0x..." → explorer/tx/0x...
 */
export function explorerTxUrl(txId: string): string {
  const cfg = config();
  if (cfg.chainMode === "hedera") {
    const atIdx = txId.indexOf("@");
    if (atIdx === -1) {
      return `${explorerBaseUrl()}/transaction/${txId}`;
    }
    const accountId = txId.substring(0, atIdx);
    const timestamp = txId.substring(atIdx + 1);
    const tsDash = timestamp.replace(".", "-");
    return `${explorerBaseUrl()}/transaction/${accountId}-${tsDash}`;
  }
  return `${explorerBaseUrl()}/tx/${txId}`;
}

/**
 * Build NFT explorer URL.
 * Hedera: hashscan.io/testnet/token/{tokenId}/{serial}
 * EVM/Base: explorer/token/{address}?a={tokenId}
 */
export function explorerNftUrl(tokenIdOrAddress: string, serialOrTokenId: string): string {
  const cfg = config();
  if (cfg.chainMode === "hedera") {
    return `${explorerBaseUrl()}/token/${tokenIdOrAddress}/${serialOrTokenId}`;
  }
  return `${explorerBaseUrl()}/token/${tokenIdOrAddress}?a=${serialOrTokenId}`;
}

/**
 * Build account/wallet explorer URL.
 * Hedera: hashscan.io/testnet/account/{accountId}
 * EVM/Base: explorer/address/{address}
 */
export function explorerAccountUrl(address: string): string {
  const cfg = config();
  if (cfg.chainMode === "hedera") {
    return `${explorerBaseUrl()}/account/${address}`;
  }
  return `${explorerBaseUrl()}/address/${address}`;
}

/**
 * Format price amount with chain currency symbol and decimals.
 */
export function formatPrice(amount: number): string {
  const cfg = config();
  const { currencySymbol, currencyDecimals } = cfg.ui;
  const formatted = amount.toFixed(currencyDecimals).replace(/\.?0+$/, "");
  return `${formatted} ${currencySymbol}`;
}

/**
 * Return the account label for the current chain (e.g., "Hedera Account ID" or "Wallet Address").
 */
export function accountLabel(): string {
  return config().ui.accountLabel;
}

/**
 * Return the account placeholder for the current chain (e.g., "0.0.xxxx" or "0x...").
 */
export function accountPlaceholder(): string {
  return config().ui.accountPlaceholder;
}

/**
 * Return a RegExp to validate account/address format for the current chain.
 */
export function accountPattern(): RegExp {
  const cfg = config();
  if (cfg.chainMode === "hedera") {
    return /^0\.0\.\d+$/;
  }
  return /^0x[a-fA-F0-9]{40}$/;
}

/**
 * Return the chain display name (e.g., "Hedera Testnet" or "Base Sepolia").
 */
export function chainDisplayName(): string {
  return config().ui.chainDisplayName;
}

/**
 * Return the badge color for the current chain (e.g., "purple" for Hedera, "blue" for Base).
 */
export function chainBadgeColor(): string {
  const cfg = config();
  if (cfg.chainMode === "hedera") return "purple";
  if (cfg.chainMode === "base" || cfg.chainMode === "evm") return "blue";
  return "purple";
}

/**
 * Return the explorer name (e.g., "HashScan" or "Basescan").
 */
export function explorerName(): string {
  return config().ui.explorerName;
}
