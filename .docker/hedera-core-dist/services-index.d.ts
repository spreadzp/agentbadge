import type { A2AMessage, AuditMessage, MintResult, NftInfo, TaskMessage, TaskMessageWithTx, TopicMessage } from "./types";
import type { DirectoryMessage } from "./hedera.service";
import type { PaginatedMessages, ScheduleInfo } from "./mirror.service";
export declare function mintPassportNFT(tokenId: string, ipfsUri: string): Promise<MintResult>;
export declare function burnPassportNFT(tokenId: string, serial: number): Promise<void>;
export declare function transferNFTToAgent(tokenId: string, serial: number, fromAccountId: string, toAccountId: string): Promise<void>;
export declare function grantKyc(tokenId: string, accountId: string): Promise<void>;
export declare function submitAuditMessage(message: AuditMessage): Promise<string>;
export declare function submitDirectoryMessage(message: DirectoryMessage): Promise<string>;
export declare function submitA2AMessage(message: A2AMessage): Promise<string>;
export declare function submitTaskMessage(message: TaskMessage): Promise<string>;
export declare function prepareTopicMessageTransaction(agentAccountId: string, message: object, topicIdOverride?: string): Promise<{
    txBytes: string;
    txId: string;
}>;
export declare function prepareA2ATopicMessage(agentAccountId: string, message: A2AMessage): Promise<{
    txBytes: string;
    txId: string;
}>;
export declare function submitSignedTopicMessage(txBytesBase64: string, publicKeyDer: string, signatureBytes: Uint8Array[]): Promise<string>;
export declare function wipeNFT(tokenId: string, accountId: string, serial: number): Promise<void>;
export declare function updateNftMetadata(tokenId: string, serial: number, newUri: string): Promise<void>;
export declare function transferHbar(fromAccountId: string, toAccountId: string, amountHbar: number): Promise<string>;
export declare function transferHbarWithKey(fromAccountId: string, fromPrivateKey: string, toAccountId: string, amountHbar: number): Promise<string>;
export declare function prepareTransferTransaction(fromAccountId: string, toAccountId: string, amountHbar: number): Promise<{
    txBytes: string;
    txId: string;
}>;
export declare function transferHbarWithSignature(txBytesBase64: string, publicKeyStr: string, signatureBytes: Uint8Array | Uint8Array[]): Promise<string>;
export declare function createScheduledTransfer(fromAccountId: string, toAccountId: string, amountHbar: number, options?: {
    adminKey?: boolean;
    expirationSeconds?: number;
    memo?: string;
}): Promise<{
    scheduleId: string;
    scheduleTxId: string;
}>;
export declare function signScheduledTransaction(scheduleId: string, signerPrivateKey: string): Promise<{
    txId: string;
    executed: boolean;
}>;
export declare function deleteScheduledTransaction(scheduleId: string): Promise<{
    scheduleId: string;
    deleted: boolean;
}>;
export type { ScheduleInfo } from "./mirror.service";
export declare function getScheduleInfo(scheduleId: string): Promise<ScheduleInfo | null>;
export { signTransactionBytes, type SignatureResult } from "./signing";
export declare function getNftInfo(tokenId: string, serial: number): Promise<NftInfo | null>;
export declare function getNftsForToken(tokenId: string, opts?: {
    maxResults?: number;
}): Promise<NftInfo[]>;
export declare function getNftsForAccount(accountId: string, opts?: {
    maxResults?: number;
}): Promise<NftInfo[]>;
export declare function getTopicMessages(topicId: string, opts?: {
    startTime?: string;
    endTime?: string;
    limit?: number;
    maxResults?: number;
}): Promise<TopicMessage[]>;
export declare function getTopicMessagesPaginated(topicId: string, opts?: {
    startTime?: string;
    endTime?: string;
    limit?: number;
    pageUrl?: string;
}): Promise<PaginatedMessages>;
export declare function getTaskMessages(topicId: string, opts?: {
    startTime?: string;
    endTime?: string;
    limit?: number;
}): Promise<TaskMessageWithTx[]>;
export { DataHubClient } from "./datahub.client";
export type { DataHubSearchResult, DataHubEntity, DataHubSchemaField, DataHubLineage, DataHubAssertion, DataHubAssertionResult, LineageEdge, } from "./datahub.client";
export declare function verifyA2ADid(did: string): Promise<boolean>;
