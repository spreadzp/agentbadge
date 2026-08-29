/**
 * Generic, chain-agnostic market task model.
 *
 * Views consume MarketTask instead of Hedera-specific CachedMarketTask.
 * Normalization from chain-specific data happens here, not in views.
 */

import type { CachedMarketTask } from "@agentgate-hedera/hedera-core";
import { getConfig } from "../../config/env.js";
import { explorerTxUrl, formatPrice } from "./chain-ui.js";

export interface MarketTask {
  id: string;
  title: string;
  description: string;
  price: string;          // formatted string, e.g., "5 USDC" or "5 HBAR"
  priceRaw: string;       // raw amount, e.g., "5000000" (6 decimals) or "500000000" (8 decimals)
  currency: string;       // "USDC" or "HBAR"
  capabilities: string[];
  posterDid: string;
  posterAddress: string;  // generic, "0.0.xxxx" or "0x..."
  txId: string;           // generic transaction ID
  txExplorerUrl: string;  // pre-built explorer URL
  status: string;

  // Escrow / lifecycle fields (optional, carried through from CachedMarketTask)
  claimerDid?: string;
  resultBody?: string;
  resultIpfs?: string;
  paymentTxId?: string;
  claimTxId?: string;
  deliverTxId?: string;
  completedTxId?: string;
  consensusTimestamp: string;
  createdAt: number;
  scheduleId?: string;
  scheduleTxId?: string;
  escrowStatus?: "pending" | "released" | "cancelled" | "expired" | "reclaimed";
  verifierType?: string;
  verificationAttempts?: number;
  verificationReport?: string;
  transitionalSince?: number;
  lastError?: string;
  deadline?: number;
}

/**
 * Extract a generic poster address from a DID string.
 * Hedera: "did:hcs:0.0.1001:1" → "0.0.1001"
 * EVM:    "did:eip155:84532:0xabc..." → "0xabc..."
 */
function didToAddress(did: string): string {
  const parts = did.split(":");
  if (parts.length >= 4) {
    return parts[parts.length - 2];
  }
  return did;
}

/**
 * Normalize a CachedMarketTask (Hedera-specific) into a chain-agnostic MarketTask.
 *
 * This is the single place where chain-specific field mapping happens.
 * Views receive MarketTask and never touch raw chain data.
 */
export function normalizeTask(task: CachedMarketTask): MarketTask {
  const cfg = getConfig();
  const currency = cfg.ui.currencySymbol;

  return {
    id: task.taskId,
    title: task.title,
    description: task.description,
    price: formatPrice(task.priceHbar),
    priceRaw: String(task.priceHbar),
    currency,
    capabilities: task.capabilities,
    posterDid: task.posterDid,
    posterAddress: didToAddress(task.posterDid),
    txId: task.txId,
    txExplorerUrl: explorerTxUrl(task.txId),
    status: task.status,

    claimerDid: task.claimerDid,
    resultBody: task.resultBody,
    resultIpfs: task.resultIpfs,
    paymentTxId: task.paymentTxId,
    claimTxId: task.claimTxId,
    deliverTxId: task.deliverTxId,
    completedTxId: task.completedTxId,
    consensusTimestamp: task.consensusTimestamp,
    createdAt: task.createdAt,
    scheduleId: task.scheduleId,
    scheduleTxId: task.scheduleTxId,
    escrowStatus: task.escrowStatus,
    verifierType: task.verifierType,
    verificationAttempts: task.verificationAttempts,
    verificationReport: task.verificationReport,
    transitionalSince: task.transitionalSince,
    lastError: task.lastError,
    deadline: task.deadline,
  };
}

/**
 * Normalize an array of CachedMarketTask into MarketTask[].
 */
export function normalizeTasks(tasks: CachedMarketTask[]): MarketTask[] {
  return tasks.map(normalizeTask);
}
