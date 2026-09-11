import type { MintResult, NftInfo } from "./types";
export interface ChainMetadata {
    id: number;
    name: string;
    currency: string;
    symbol: string;
    decimals: number;
}
export interface ExplorerLinks {
    tx(txHash: string): string;
    nft(tokenAddress: string, tokenId: string | number): string;
    account(address: string): string;
}
export interface EscrowHoldResult {
    escrowId: string;
    txHash?: string;
}
export interface EscrowHoldParams {
    from: string;
    to: string;
    amount: bigint;
    tokenAddress?: string;
    deadline?: number;
    memo?: string;
}
export interface TransferTokenParams {
    tokenAddress: string;
    to: string;
    amount: bigint;
    from?: string;
    privateKey?: string;
}
export interface EventQuery {
    contractAddress: string;
    eventName?: string;
    fromBlock?: number;
    toBlock?: number;
    limit?: number;
}
export interface ChainEvent {
    blockNumber: number;
    txHash: string;
    eventName: string;
    args: Record<string, unknown>;
    logIndex: number;
}
export interface ChainAdapter {
    chain: ChainMetadata;
    explorer: ExplorerLinks;
    mintPassport(tokenAddress: string, metadataUri: string): Promise<MintResult>;
    revokePassport(tokenAddress: string, tokenId: number): Promise<void>;
    getPassportInfo(tokenAddress: string, tokenId: number): Promise<NftInfo | null>;
    buildDid(tokenAddress: string, tokenId: number): string;
    resolveDid(did: string): Promise<string | null>;
    verifyOwnershipSignature(did: string, signature: string, message: string): Promise<boolean>;
    createEscrowHold(params: EscrowHoldParams): Promise<EscrowHoldResult>;
    releaseEscrow(escrowId: string): Promise<void>;
    reclaimEscrow(escrowId: string): Promise<void>;
    getBalance(address: string): Promise<number>;
    transferToken(params: TransferTokenParams): Promise<string>;
    getEvents(query: EventQuery): Promise<ChainEvent[]>;
}
