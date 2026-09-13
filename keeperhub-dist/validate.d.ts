import type { WorkflowSpec } from "./types.js";
export interface ValidationError {
    node?: string;
    field: string;
    message: string;
}
export declare function validateWorkflowSpec(spec: WorkflowSpec): ValidationError[];
export declare function assertValidWorkflowSpec(spec: WorkflowSpec): void;
