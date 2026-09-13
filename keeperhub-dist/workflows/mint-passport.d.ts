import type { WorkflowSpec } from "../types.js";
export interface MintPassportOptions {
    passportNftAddress: string;
    trustBadgeAddress: string;
    network?: string;
    auditCallbackUrl: string;
    auditCallbackSecret?: string;
}
export declare function buildMintPassportWorkflow(opts: MintPassportOptions): WorkflowSpec;
