import { buildRecordScanWorkflow } from "./record-scan.js";
import { buildMintPassportWorkflow } from "./mint-passport.js";
export * from "./record-scan.js";
export * from "./mint-passport.js";
export * from "./notify.js";
export function buildAllWorkflows(opts) {
    return [
        buildRecordScanWorkflow(opts),
        buildMintPassportWorkflow(opts),
    ];
}
