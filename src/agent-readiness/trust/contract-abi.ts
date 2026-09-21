// EPIC-140 (SLICE-140-12): agentPassportNFTAbi moved to ./abi/agent-passport-nft.ts
export { agentPassportNFTAbi } from "./abi";

// --- Types for attestation functions ---

export interface SnapshotAttestation {
  snapshotHash: `0x${string}`;
  domain: string;
  score: number;
  grade: string;
  attestedAt: bigint;
  revoked: boolean;
}

export interface VerifySnapshotResult {
  tokenId: bigint;
  score: number;
  timestamp: bigint;
  valid: boolean;
}

export interface AttestSnapshotArgs {
  snapshotHash: `0x${string}`;
  domain: string;
  score: number;
  grade: string;
}

export interface RevokeSnapshotArgs {
  tokenId: bigint;
  reason: string;
}
