import type { WorkflowSpec } from "../types.js";
import { type RecordScanOptions } from "./record-scan.js";
import { type MintPassportOptions } from "./mint-passport.js";
import { type NotifyOptions } from "./notify.js";
export * from "./record-scan.js";
export * from "./mint-passport.js";
export * from "./notify.js";
export interface AllTemplatesOptions extends RecordScanOptions, Omit<MintPassportOptions, "network" | "auditCallbackUrl" | "auditCallbackSecret">, NotifyOptions {
}
export declare function buildAllWorkflows(opts: AllTemplatesOptions): WorkflowSpec[];
