/**
 * SLICE-102-5: On-chain attestation service.
 *
 * Submits attestSnapshot() transactions to the AgentPassportNFT contract,
 * waits for confirmation, and returns the on-chain attestation data.
 */

import { ethers, type Contract, type Wallet } from "ethers";
import { agentPassportNFTAbi } from "./contract-abi.js";

export interface AttestSnapshotInput {
  snapshotHash: string;
  domain: string;
  score: number;
  grade: string;
  signerPrivateKey: string;
  contractAddress: string;
  rpcUrl: string;
}

export interface OnChainAttestation {
  tokenId: string;
  snapshotHash: string;
  domain: string;
  score: number;
  grade: string;
  attestedAt: string;
  revoked: boolean;
  txHash: string;
}

/**
 * Convert a `sha256:<hex>` snapshot hash to bytes32 for on-chain submission.
 * Strips the "sha256:" prefix and ensures 32-byte (64-char) hex.
 */
export function snapshotHashToBytes32(hash: string): string {
  let stripped = hash;
  if (stripped.startsWith("sha256:")) stripped = stripped.slice(7);
  if (stripped.startsWith("0x")) stripped = stripped.slice(2);
  if (stripped.length !== 64) {
    throw new Error(`Invalid snapshot hash length: expected 64 chars (32 bytes), got ${stripped.length}`);
  }
  return "0x" + stripped.toLowerCase();
}

function getContract(signerPrivateKey: string, contractAddress: string, rpcUrl: string): { contract: Contract; wallet: Wallet } {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(signerPrivateKey, provider);
  const contract = new ethers.Contract(contractAddress, agentPassportNFTAbi, wallet);
  return { contract, wallet };
}

/**
 * Submit an attestation transaction to the AgentPassportNFT contract.
 * Waits for 1 confirmation, then reads back the attestation data.
 */
export async function attestSnapshotOnChain(input: AttestSnapshotInput): Promise<OnChainAttestation> {
  const { contract } = getContract(input.signerPrivateKey, input.contractAddress, input.rpcUrl);

  const snapshotHashBytes32 = snapshotHashToBytes32(input.snapshotHash);

  if (input.score < 0 || input.score > 100) {
    throw new Error(`Invalid score: ${input.score} (must be 0-100)`);
  }

  const tx = await contract.attestSnapshot(
    snapshotHashBytes32,
    input.domain,
    input.score,
    input.grade,
  );

  const receipt = await tx.wait(1);

  if (!receipt || receipt.status !== 1) {
    throw new Error(`Transaction reverted: ${tx.hash}`);
  }

  // Read back the attestation — tokenId from receipt logs (first event topic[1])
  const tokenIdFromLog = receipt.logs[0]?.topics[1] ?? "0";
  const tokenIdBigInt = BigInt(tokenIdFromLog);

  const attestation = await contract.getAttestation(tokenIdBigInt);

  return {
    tokenId: tokenIdBigInt.toString(),
    snapshotHash: attestation.snapshotHash,
    domain: attestation.domain,
    score: Number(attestation.score),
    grade: attestation.grade,
    attestedAt: attestation.attestedAt.toString(),
    revoked: attestation.revoked,
    txHash: tx.hash,
  };
}
