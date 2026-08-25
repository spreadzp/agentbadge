export type Tier = "bronze" | "silver" | "gold" | "platinum";
export declare const TIER_PRICES_HBAR: Record<Tier, number>;
export type Capability = "api_call" | "payment" | "data_provide" | "data_consume" | "orchestration";
export interface PassportMetadata {
    name: string;
    description: string;
    image: string;
    attributes: NftAttribute[];
    did: string;
    tier: Tier;
    capabilities: Capability[];
    accountId: string;
    issuedAt: number;
    endpoint: string;
    version: number;
    issuer: string;
    skills?: string[];
}
export interface NftAttribute {
    trait_type: string;
    value: string;
}
export interface AuditMessage {
    type: "passport_issued" | "tier_upgraded" | "passport_revoked" | "agent_registered" | "agent_deregistered";
    did: string;
    tokenId: string;
    serial: number;
    timestamp: number;
    tier?: Tier;
    oldTier?: Tier;
    newTier?: Tier;
    reason?: string;
    txHash?: string;
}
export interface NftInfo {
    token_id: string;
    serial_number: number;
    account_id: string;
    metadata: string;
    deleted: boolean;
    created_timestamp: string;
}
export interface MintResult {
    tokenId: string;
    serial: number;
}
export interface TopicResult {
    topicId: string;
}
export interface TopicMessage {
    consensus_timestamp: string;
    message: string;
    sequence_number: number;
    running_hash: string;
    chunk_info?: unknown;
    transaction_id?: string;
}
export interface DirectoryMessage {
    type: "agent_register";
    did: string;
    tokenId: string;
    serial: number;
    accountId: string;
    name: string;
    capabilities: string[];
    endpoint: string;
    tier: string;
    timestamp: number;
}
export interface A2AMessage {
    type: "a2a_message";
    from: string;
    to: string;
    body: string;
    contentType: string;
    timestamp: number;
}
export interface CachedA2AMessage extends A2AMessage {
    txId: string;
    consensusTimestamp: string;
}
export declare function isValidA2AMessage(obj: unknown): boolean;
export interface TaskPostedMessage {
    type: "task_posted";
    taskId: string;
    posterDid: string;
    title: string;
    description: string;
    priceHbar: number;
    capabilities: string[];
    deadline?: number;
    timestamp: number;
}
export interface TaskClaimedMessage {
    type: "task_claimed";
    taskId: string;
    claimerDid: string;
    timestamp: number;
}
export interface TaskDeliveredMessage {
    type: "task_delivered";
    taskId: string;
    resultIpfs?: string;
    resultBody?: string;
    timestamp: number;
}
export interface TaskCompletedMessage {
    type: "task_completed";
    taskId: string;
    paymentTxId: string;
    timestamp: number;
}
export interface TaskVerificationFailedMessage {
    type: "task_verification_failed";
    taskId: string;
    claimerDid: string;
    report: string;
    timestamp: number;
}
export interface TaskEscrowCreatedMessage {
    type: "task_escrow_created";
    taskId: string;
    scheduleId: string;
    amountHbar: number;
    timestamp: number;
}
export interface TaskCancelledMessage {
    type: "task_cancelled";
    taskId: string;
    scheduleId?: string;
    timestamp: number;
}
export interface TaskRewardIncreasedMessage {
    type: "task_reward_increased";
    taskId: string;
    oldPriceHbar: number;
    newPriceHbar: number;
    newScheduleId: string;
    timestamp: number;
}
export type TaskMessage = TaskPostedMessage | TaskClaimedMessage | TaskDeliveredMessage | TaskCompletedMessage | TaskVerificationFailedMessage | TaskEscrowCreatedMessage | TaskCancelledMessage | TaskRewardIncreasedMessage;
export interface TaskMessageWithTx {
    message: TaskMessage;
    txId?: string;
}
export declare function isValidTaskMessage(obj: unknown): boolean;
export type MarketTaskMessage = TaskMessage;
export interface CachedMarketTask {
    taskId: string;
    posterDid: string;
    title: string;
    description: string;
    priceHbar: number;
    capabilities: string[];
    deadline?: number;
    status: "posted" | "claimed" | "delivered" | "completed" | "cancelled";
    claimerDid?: string;
    resultBody?: string;
    resultIpfs?: string;
    paymentTxId?: string;
    txId: string;
    claimTxId?: string;
    deliverTxId?: string;
    completedTxId?: string;
    consensusTimestamp: string;
    createdAt: number;
    scheduleId?: string;
    scheduleTxId?: string;
    escrowStatus?: "pending" | "released" | "cancelled" | "expired";
    verifierType?: string;
    verificationAttempts?: number;
    verificationReport?: string;
}
export interface HFSUploadResult {
    fileId: string;
    txId: string;
}
export interface GlossaryTermConfig {
    id: string;
    name: string;
    description: string;
    category: "cardiovascular" | "endocrine" | "general" | "demographic";
    relatedDatasets: string[];
}
export interface CreatePassportTokenParams {
    tokenName: string;
    tokenSymbol: string;
    treasuryAccountId: string;
    maxSupply: number;
    adminKey: Uint8Array;
    supplyKey: Uint8Array;
    metadataKey: Uint8Array;
    wipeKey: Uint8Array;
    freezeKey: Uint8Array;
    pauseKey: Uint8Array;
    kycKey: Uint8Array;
}
