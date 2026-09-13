export interface KeeperHubConfig {
    serverUrl: string;
    apiKey: string;
    clientName?: string;
    timeoutMs?: number;
    idempotencyKey?: string;
}
export type TriggerType = "Manual" | "Schedule" | "Webhook" | "Event" | "Block" | "Transfer";
export type NodeType = "trigger" | "action";
export interface TriggerNodeConfig {
    triggerType: TriggerType;
    schedule?: string;
}
export interface Web3WriteContractConfig {
    actionType: "web3/write-contract";
    network: string;
    contractAddress: string;
    abi: string;
    abiFunction: string;
    functionArgs?: string;
    gasLimitMultiplier?: string;
}
export interface WebhookActionConfig {
    actionType: "webhook/send-webhook";
    webhookUrl: string;
    webhookMethod: string;
    webhookHeaders?: string;
    webhookPayload: string;
    headers?: Record<string, string>;
}
export type ActionNodeConfig = Web3WriteContractConfig | WebhookActionConfig;
export interface WorkflowNode {
    id: string;
    type: NodeType;
    data: {
        label: string;
        description?: string;
        type: NodeType;
        config: TriggerNodeConfig | ActionNodeConfig;
    };
}
export interface WorkflowEdge {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
}
export interface WorkflowSpec {
    name: string;
    description?: string;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    enabled?: boolean;
}
export type TerminalState = "success" | "error" | "system_error" | "cancelled";
export type ExecutionState = "pending" | "running" | "unconfirmed" | TerminalState;
export interface TxReceipt {
    hash: string;
    nodeId?: string;
    verified?: boolean;
    chainId?: number;
    gasUsed?: string;
    nodeName?: string;
    blockNumber?: number;
    receiptStatus?: string;
    verifiedAt?: string;
}
export interface ExecutionStatus {
    status: ExecutionState;
    nodeStatuses?: {
        nodeId: string;
        status: string;
    }[];
    progress?: {
        totalSteps: number;
        completedSteps: number;
        runningSteps: number;
        currentNodeId: string | null;
        currentNodeName: string | null;
        percentage: number;
    };
    errorContext?: {
        error?: string;
    } | null;
    transactionHashes?: TxReceipt[];
}
export interface ExecutionResult {
    executionId?: string;
    status: ExecutionStatus;
    error?: string;
    output?: unknown;
    logs?: unknown;
}
export interface PollOptions {
    intervalMs?: number;
    timeoutMs?: number;
}
export interface KeeperHubError {
    code: number;
    message: string;
    retryAfterSeconds?: number;
    raw?: unknown;
}
