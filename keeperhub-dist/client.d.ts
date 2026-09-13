import type { ExecutionResult, KeeperHubConfig, PollOptions } from "./types.js";
export interface CallOptions {
    idempotencyKey?: string;
    timeoutMs?: number;
    _attempt?: number;
}
export declare class KeeperHubClient {
    private client;
    private readonly config;
    constructor(config: KeeperHubConfig);
    connect(): Promise<void>;
    close(): Promise<void>;
    private call;
    private unwrap;
    private toKeeperHubError;
    private normalizeTransportError;
    ping(): Promise<boolean>;
    listWorkflows(): Promise<unknown[]>;
    createWorkflow(spec: {
        name: string;
        description?: string;
        nodes: unknown[];
        edges: unknown[];
        enabled?: boolean;
        projectId?: string;
    }, opts?: CallOptions): Promise<{
        workflowId: string;
    }>;
    executeWorkflow(workflowId: string, inputs?: Record<string, unknown>, opts?: CallOptions): Promise<{
        executionId: string;
    }>;
    getExecution(executionId: string): Promise<ExecutionResult>;
    pollExecution(executionId: string, poll?: PollOptions): Promise<ExecutionResult>;
    txHashes(exec: ExecutionResult): string[];
    listActionSchemas(category?: string): Promise<unknown>;
    getWalletIntegration(): Promise<unknown>;
    listWorkflow(workflowId: string, metadata: {
        slug: string;
        description: string;
    }): Promise<unknown>;
    getWorkflowListing(slug: string): Promise<unknown>;
    private assertConnected;
}
