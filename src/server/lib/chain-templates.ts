/**
 * Chain-aware template variable system for static content.
 *
 * Replaces hardcoded Hedera terms (HCS, HTS, HBAR, HashScan, Mirror Node)
 * with template variables that are resolved at render time based on chain config.
 */

import { getConfig } from "../../config/env.js";
import { chainDisplayName, explorerName } from "./chain-ui.js";

export interface ChainTemplateVars {
  CHAIN_NAME: string;
  CURRENCY: string;
  EXPLORER: string;
  EXPLORER_URL: string;
  MIRROR_NODE: string;
  NFT_STANDARD: string;
  CONSENSUS: string;
}

/**
 * Build template variable map for the current chain.
 */
export function getChainTemplateVars(): ChainTemplateVars {
  const cfg = getConfig();

  if (cfg.chainMode === "hedera") {
    const network = cfg.hederaNetwork;
    return {
      CHAIN_NAME: chainDisplayName(),
      CURRENCY: cfg.ui.currencySymbol,
      EXPLORER: explorerName(),
      EXPLORER_URL: `https://hashscan.io/${network}`,
      MIRROR_NODE: "Mirror Node",
      NFT_STANDARD: "HTS",
      CONSENSUS: "HCS",
    };
  }

  // EVM / Base
  const explorerUrl = cfg.base?.explorerUrl ?? cfg.evm?.explorerUrl ?? "";
  return {
    CHAIN_NAME: chainDisplayName(),
    CURRENCY: cfg.ui.currencySymbol,
    EXPLORER: explorerName(),
    EXPLORER_URL: explorerUrl,
    MIRROR_NODE: explorerName(),
    NFT_STANDARD: "ERC-721",
    CONSENSUS: "Smart Contract Events",
  };
}

/**
 * Replace all {{VARIABLE}} placeholders in a string with chain-appropriate values.
 */
export function applyChainTemplates(content: string): string {
  const vars = getChainTemplateVars();
  return content.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return key in vars ? String(vars[key as keyof ChainTemplateVars]) : match;
  });
}
