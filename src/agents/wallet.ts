/**
 * Wallet signing utility for Hermes demo agent.
 *
 * Signs the wallet-ownership message that `verifyWalletOwnership`
 * (passport.service.ts) expects.
 *
 * Reference: CONTEXT.md:115-117, SLICE-4-4
 */

import { ethers } from "ethers";

/**
 * Sign the wallet-ownership proof message for request_passport.
 *
 * The server's `verifyWalletOwnership` checks:
 *   ethers.verifyMessage(`Request Passport: ${accountId}`, signature)
 *
 * @param accountId  Hedera account ID (e.g. "0.0.1234")
 * @param privateKey EVM private key (hex string, 0x-prefixed)
 * @returns signature string
 */
export async function signWalletOwnership(accountId: string, privateKey: string): Promise<string> {
  if (!accountId) throw new Error("accountId is required");
  if (!privateKey) throw new Error("privateKey is required");

  const wallet = new ethers.Wallet(privateKey);
  const message = `Request Passport: ${accountId}`;
  return wallet.signMessage(message);
}
