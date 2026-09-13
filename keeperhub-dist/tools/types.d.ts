import { z } from "zod";
export interface KeeperhubToolContext {
    client: import("../client.js").KeeperHubClient;
    apiBaseUrl: string;
    workflowIds: {
        recordScan?: string;
        mintPassport?: string;
        notify?: string;
    };
}
export interface KeeperhubToolResult {
    content: Array<{
        type: "text";
        text: string;
    }>;
    isError?: boolean;
}
export type ZodRawShape = Record<string, z.ZodType>;
export interface KeeperhubToolDefinition {
    name: string;
    description: string;
    inputSchema: ZodRawShape;
    annotations: {
        readOnlyHint: boolean;
        untrustedContentHint: boolean;
        title: string;
    };
    createHandler: (ctx: KeeperhubToolContext) => (args: Record<string, unknown>) => Promise<KeeperhubToolResult>;
}
export declare function ok(payload: unknown): KeeperhubToolResult;
export declare function fail(message: string): KeeperhubToolResult;
