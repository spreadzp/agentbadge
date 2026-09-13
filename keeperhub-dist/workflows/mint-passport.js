import { AGENT_PASSPORT_MINT_ABI, TRUST_BADGE_MINT_ABI, toAbiJson } from "../abis.js";
export function buildMintPassportWorkflow(opts) {
    const network = opts.network ?? "84532";
    return {
        name: "agentbadge-mint-passport",
        description: "Mint AgentPassport NFT + TrustBadge (soulbound) onchain, then audit callback",
        nodes: [
            {
                id: "trigger",
                type: "trigger",
                data: { label: "Mint Request", type: "trigger", config: { triggerType: "Webhook" } },
            },
            {
                id: "mint-passport-nft",
                type: "action",
                data: {
                    label: "Mint Passport NFT",
                    type: "action",
                    config: {
                        actionType: "web3/write-contract",
                        network,
                        contractAddress: opts.passportNftAddress,
                        abi: toAbiJson(AGENT_PASSPORT_MINT_ABI),
                        abiFunction: "mint",
                        functionArgs: '[{{Mint Request.to}}, "{{Mint Request.passportUri}}", {{Mint Request.tier}}]',
                        gasLimitMultiplier: "1.5",
                    },
                },
            },
            {
                id: "mint-trust-badge",
                type: "action",
                data: {
                    label: "Mint Trust Badge",
                    type: "action",
                    config: {
                        actionType: "web3/write-contract",
                        network,
                        contractAddress: opts.trustBadgeAddress,
                        abi: toAbiJson(TRUST_BADGE_MINT_ABI),
                        abiFunction: "mint",
                        functionArgs: '[{{Mint Request.to}}, "{{Mint Request.siteUrl}}", {{Mint Request.score}}, "{{Mint Request.badgeUri}}"]',
                        gasLimitMultiplier: "1.5",
                    },
                },
            },
        ],
        edges: [
            { id: "e1", source: "trigger", target: "mint-passport-nft" },
            { id: "e2", source: "mint-passport-nft", target: "mint-trust-badge" },
        ],
    };
}
