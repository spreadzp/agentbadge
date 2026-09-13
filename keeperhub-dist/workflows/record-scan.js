import { TRUST_REGISTRY_RECORD_SCAN_ABI, toAbiJson } from "../abis.js";
export const WEBHOOK_SEND_ACTION_TYPE = "webhook/send-webhook";
export function buildRecordScanWorkflow(opts) {
    const network = opts.network ?? "84532";
    return {
        name: "agentbadge-record-scan",
        description: "Record an AgentBadge agent-readiness scan result onchain (TrustRegistry, Base Sepolia)",
        nodes: [
            {
                id: "trigger",
                type: "trigger",
                data: { label: "Scan Result", type: "trigger", config: { triggerType: "Webhook" } },
            },
            {
                id: "record-onchain",
                type: "action",
                data: {
                    label: "Record Scan Onchain",
                    type: "action",
                    config: {
                        actionType: "web3/write-contract",
                        network,
                        contractAddress: opts.trustRegistryAddress,
                        abi: toAbiJson(TRUST_REGISTRY_RECORD_SCAN_ABI),
                        abiFunction: "recordScan",
                        functionArgs: '["{{Scan Result.siteUrl}}", {{Scan Result.score}}, {{Scan Result.rulesPassed}}, {{Scan Result.rulesTotal}}]',
                        gasLimitMultiplier: "1.5",
                    },
                },
            },
        ],
        edges: [
            { id: "e1", source: "trigger", target: "record-onchain" },
        ],
    };
}
