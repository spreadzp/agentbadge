import type { WorkflowSpec } from "../types.js";
export declare const WEBHOOK_SEND_ACTION_TYPE = "webhook/send-webhook";
export interface RecordScanOptions {
    trustRegistryAddress: string;
    network?: string;
    auditCallbackUrl: string;
    auditCallbackSecret?: string;
}
export declare function buildRecordScanWorkflow(opts: RecordScanOptions): WorkflowSpec;
