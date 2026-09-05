/**
 * SLICE-102-5: Revocation service — revoke an on-chain attestation.
 *
 * Submits revokeSnapshot() transaction to the AgentPassportNFT contract.
 */

import { ethers } from "ethers";
import { agentPassportNFTAbi } from "./contract-abi.js";

export interface RevokeSnapshotInput {
  tokenId: string;
  reason: string;
  signerPrivateKey: string;
  contractAddress: string;
  rpcUrl: string;
}

export interface RevokeSnapshotResult {
  txHash: string;
  tokenId: string;
  reason: string;
}

/**
 * Submit a revocation transaction for a given tokenId.
 * The signer must have REVOKER_ROLE on the contract.
 */
export async function revokeSnapshotOnChain(input: RevokeSnapshotInput): Promise<RevokeSnapshotResult> {
  const provider = new ethers.JsonRpcProvider(input.rpcUrl);
  const wallet = new ethers.Wallet(input.signerPrivateKey, provider);
  const contract = new ethers.Contract(input.contractAddress, agentPassportNFTAbi, wallet);

  const tokenIdBigInt = BigInt(input.tokenId);

  const tx = await contract.revokeSnapshot(tokenIdBigInt, input.reason);

  const receipt = await tx.wait(1);

  if (!receipt || receipt.status !== 1) {
    throw new Error(`Revocation transaction reverted: ${tx.hash}`);
  }

  return {
    txHash: tx.hash,
    tokenId: input.tokenId,
    reason: input.reason,
  };
}
