export interface TrustTier {
  name: string;
  level: number;
  description: string;
  unlocks: string[];
  requirements: string[];
}

export interface TrustTierCatalog {
  total_count: number;
  tiers: TrustTier[];
}

export function getTrustTiers(): TrustTierCatalog {
  return {
    total_count: 6,
    tiers: [
      {
        name: "unverified",
        level: 0,
        description: "No identity verification. The agent has no DID and no passport. Can only access free read endpoints.",
        unlocks: [
          "GET /catalog",
          "GET /api/meta/errors",
          "GET /api/meta/fees",
          "GET /api/meta/trust-tiers",
          "GET /agents (read-only)",
          "GET /market/tasks (read-only)",
        ],
        requirements: [],
      },
      {
        name: "did_verified",
        level: 1,
        description: "Agent has a DID (Decentralized Identifier). Can authenticate to mutation endpoints via signed challenges.",
        unlocks: [
          "POST /agents/register",
          "POST /a2a/send",
          "POST /market/tasks",
          "POST /contact",
        ],
        requirements: [
          "Valid DID (did:hedera:<network>:<accountId>)",
          "Ability to sign challenges with Hedera account key",
        ],
      },
      {
        name: "passport_holder",
        level: 2,
        description: "Agent owns an NFT passport on Hedera. Unlocks capability-based access tied to passport tier.",
        unlocks: [
          "api_call capability",
          "payment capability",
          "POST /passport/request (upgrade)",
          "Passport-based identity in marketplace",
        ],
        requirements: [
          "Owns a passport NFT (bronze, silver, gold, or platinum)",
          "Passport minted on Hedera network",
        ],
      },
      {
        name: "passport_verified",
        level: 3,
        description: "Passport is verified on-chain. The agent's identity is cryptographically confirmed against Hedera ledger state.",
        unlocks: [
          "verified capability (gold+)",
          "Higher trust score in marketplace",
          "Priority in task matching",
          "GET /passport/:tokenId/:serial returns verified status",
        ],
        requirements: [
          "Passport NFT exists and is not revoked",
          "On-chain verification via GET /passport/:tokenId/:serial",
        ],
      },
      {
        name: "marketplace_participant",
        level: 4,
        description: "Agent is registered in the HCS directory and can participate in the marketplace as task poster or task worker.",
        unlocks: [
          "marketplace capability (gold+)",
          "POST /market/tasks (post tasks)",
          "POST /market/tasks/:id/claim (claim tasks)",
          "POST /market/tasks/:id/complete (deliver results)",
          "A2A messaging with other marketplace agents",
        ],
        requirements: [
          "Passport with marketplace capability (gold or platinum tier)",
          "Registered in HCS directory via POST /agents/register",
          "DID signature authentication",
        ],
      },
      {
        name: "trusted_agent",
        level: 5,
        description: "Agent has completed marketplace tasks with positive reviews. Highest trust level — eligible for premium tasks and governance.",
        unlocks: [
          "multi_agent capability (platinum)",
          "governance capability (platinum)",
          "Premium task eligibility",
          "Reputation-based priority",
          "Eligible for task arbitration",
        ],
        requirements: [
          "Platinum passport OR gold+ with completed tasks",
          "Positive review history from task completions",
          "Active marketplace participation",
        ],
      },
    ],
  };
}
