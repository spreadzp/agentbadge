export const TRUST_REGISTRY_RECORD_SCAN_ABI = [
    {
        type: "function",
        name: "recordScan",
        inputs: [
            { name: "siteUrl", type: "string" },
            { name: "score", type: "uint8" },
            { name: "rulesPassed", type: "uint16" },
            { name: "rulesTotal", type: "uint16" },
        ],
        outputs: [{ name: "id", type: "uint256" }],
        stateMutability: "nonpayable",
    },
];
export const TRUST_BADGE_MINT_ABI = [
    {
        type: "function",
        name: "mint",
        inputs: [
            { name: "to", type: "address" },
            { name: "siteUrl", type: "string" },
            { name: "score", type: "uint8" },
            { name: "uri", type: "string" },
        ],
        outputs: [{ name: "id", type: "uint256" }],
        stateMutability: "nonpayable",
    },
];
export const AGENT_PASSPORT_MINT_ABI = [
    {
        type: "function",
        name: "mint",
        inputs: [
            { name: "to", type: "address" },
            { name: "uri", type: "string" },
            { name: "tier", type: "uint8" },
        ],
        outputs: [{ name: "id", type: "uint256" }],
        stateMutability: "nonpayable",
    },
];
export function toAbiJson(fragment) {
    return JSON.stringify(fragment);
}
