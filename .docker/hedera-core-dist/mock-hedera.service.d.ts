import type { A2AMessage, AuditMessage, DirectoryMessage, HFSUploadResult, MintResult, TaskMessage } from "./types";
interface MockNft {
    token_id: string;
    serial_number: number;
    account_id: string;
    metadata: string;
    deleted: boolean;
    created_timestamp: string;
}
interface MockTopicMessage {
    consensus_timestamp: string;
    message: string;
    sequence_number: number;
    running_hash: string;
    chunk_info?: unknown;
    transaction_id?: string;
}
declare const nftStore: Map<string, MockNft>;
declare const topicMessages: Map<string, MockTopicMessage[]>;
export declare function mintPassportNFT(tokenId: string, ipfsUri: string): Promise<MintResult>;
export declare function transferNFTToAgent(tokenId: string, serial: number, _fromAccountId: string, toAccountId: string): Promise<void>;
export declare function grantKyc(_tokenId: string, _accountId: string): Promise<void>;
export declare function burnPassportNFT(tokenId: string, serial: number): Promise<void>;
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
export declare function submitSignedTopicMessage(_txBytesBase64: string, _publicKeyDer: string, _signatureBytes: Uint8Array[]): Promise<string>;
export declare function wipeNFT(tokenId: string, _accountId: string, serial: number): Promise<void>;
export declare function updateNftMetadata(tokenId: string, serial: number, newUri: string): Promise<void>;
export declare function transferHbar(fromAccountId: string, toAccountId: string, amountHbar: number): Promise<string>;
export declare function transferHbarWithKey(fromAccountId: string, _fromPrivateKey: string, toAccountId: string, amountHbar: number): Promise<string>;
export declare function prepareTransferTransaction(_fromAccountId: string, _toAccountId: string, _amountHbar: number): Promise<{
    txBytes: string;
    txId: string;
}>;
export declare function transferHbarWithSignature(_txBytesBase64: string, _publicKeyStr: string, signatureBytes: Uint8Array | Uint8Array[]): Promise<string>;
export declare function createScheduledTransfer(fromAccountId: string, toAccountId: string, amountHbar: number, options?: {
    adminKey?: boolean;
    expirationSeconds?: number;
    memo?: string;
}): Promise<{
    scheduleId: string;
    scheduleTxId: string;
}>;
export declare function signScheduledTransaction(scheduleId: string, _signerPrivateKey: string): Promise<{
    txId: string;
    executed: boolean;
}>;
export declare function signScheduledTransactionWithSignature(scheduleId: string, _txBytesBase64: string, _publicKeyStr: string, _signatureBytes: Uint8Array | Uint8Array[]): Promise<{
    txId: string;
    executed: boolean;
}>;
export declare function deleteScheduledTransaction(scheduleId: string): Promise<{
    scheduleId: string;
    deleted: boolean;
}>;
export declare function uploadFileToHFS(contents: Buffer, _fileMemo?: string): Promise<HFSUploadResult>;
export declare function downloadFileFromHFS(fileId: string): Promise<Buffer>;
export declare function resetMockState(): void;
export { nftStore, topicMessages };
