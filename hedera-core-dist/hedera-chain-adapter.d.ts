import type { ChainAdapter, ChainMetadata, ExplorerLinks, EscrowHoldParams, EscrowHoldResult, TransferTokenParams, EventQuery, ChainEvent } from "./chain-adapter";
import type { MintResult, NftInfo } from "./types";
export declare class HederaChainAdapter implements ChainAdapter {
    readonly chain: ChainMetadata;
    readonly explorer: ExplorerLinks;
    mintPassport(tokenAddress: string, metadataUri: string): Promise<MintResult>;
    revokePassport(tokenAddress: string, tokenId: number): Promise<void>;
    getPassportInfo(tokenAddress: string, tokenId: number): Promise<NftInfo | null>;
    buildDid(tokenAddress: string, tokenId: number): string;
    resolveDid(did: string): Promise<string | null>;
    verifyOwnershipSignature(did: string, _signature: string, _message: string): Promise<boolean>;
    createEscrowHold(params: EscrowHoldParams): Promise<EscrowHoldResult>;
    releaseEscrow(escrowId: string): Promise<void>;
    reclaimEscrow(escrowId: string): Promise<void>;
    getBalance(address: string): Promise<number>;
    transferToken(params: TransferTokenParams): Promise<string>;
    getEvents(query: EventQuery): Promise<ChainEvent[]>;
}
