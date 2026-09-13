import type { WorkflowSpec } from "../types.js";
export interface NotifyOptions {
    notifyUrl: string;
    secret?: string;
}
export declare function buildNotifyWorkflow(opts: NotifyOptions): WorkflowSpec;
