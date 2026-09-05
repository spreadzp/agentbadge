/**
 * SLICE-102-5: Verification reader — read on-chain attestation data.
 *
 * Calls view functions (verifySnapshot, getAttestation) on the AgentPassportNFT contract.
 * No signer needed — read-only RPC calls.
 */

import { ethers } from "ethers";
import { agentPassportNFTAbi } from "./contract-abi.js";
import { snapshotHashToBytes32 } from "./attestation-service.js";

export interface OnChainAttestationRead {
  tokenId: string;
  snapshotHash: string;
  domain: string;
  score: number;
  grade: string;
  attestedAt: string;
  revoked: boolean;
}

/**
 * Read on-chain attestation by snapshot hash.
 * Returns null if the hash has not been attested (tokenId === 0).
 */
export async function readOnChainAttestation(
  snapshotHash: string,
  contractAddress: string,
  rpcUrl: string,
): Promise<OnChainAttestationRead | null> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(contractAddress, agentPassportNFTAbi, provider);

  const hashBytes32 = snapshotHashToBytes32(snapshotHash);

  const [tokenId, score] = await contract.verifySnapshot(hashBytes32);

  if (tokenId === 0n) {
    return null;
  }

  // Fetch full attestation data for domain + grade + revoked status
  const attestation = await contract.getAttestation(tokenId);

  return {
    tokenId: tokenId.toString(),
    snapshotHash: attestation.snapshotHash,
    domain: attestation.domain,
    score: Number(score),
    grade: attestation.grade,
    attestedAt: attestation.attestedAt.toString(),
    revoked: attestation.revoked,
  };
}
