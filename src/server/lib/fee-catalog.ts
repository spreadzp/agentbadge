export interface FeeEntry {
  service: string;
  category: "passport" | "marketplace" | "scan_api" | "badge_api" | "x402";
  price_usd: number | null;
  price_hbar: number | null;
  unit: string;
  description: string;
  free_tier: boolean;
  notes?: string;
}

export interface FeeCatalog {
  total_count: number;
  currency_note: string;
  network: string;
  fees: FeeEntry[];
}

export function getFeeCatalog(): FeeCatalog {
  const network = process.env.HEDERA_NETWORK ?? "testnet";

  return {
    total_count: 8,
    currency_note: "HBAR prices are approximate. USD equivalents are indicative and fluctuate with HBAR price.",
    network,
    fees: [
      {
        service: "passport_issuance_bronze",
        category: "passport",
        price_usd: null,
        price_hbar: 10,
        unit: "one-time",
        description: "Bronze tier passport NFT — basic agent identity with api_call and payment capabilities.",
        free_tier: false,
        notes: "Paid via x402 protocol (HTTP 402). Non-refundable.",
      },
      {
        service: "passport_issuance_silver",
        category: "passport",
        price_usd: null,
        price_hbar: 50,
        unit: "one-time",
        description: "Silver tier passport NFT — adds data_provide capability.",
        free_tier: false,
        notes: "Paid via x402 protocol (HTTP 402). Non-refundable.",
      },
      {
        service: "passport_issuance_gold",
        category: "passport",
        price_usd: null,
        price_hbar: 200,
        unit: "one-time",
        description: "Gold tier passport NFT — adds verified and marketplace capabilities.",
        free_tier: false,
        notes: "Paid via x402 protocol (HTTP 402). Non-refundable.",
      },
      {
        service: "passport_issuance_platinum",
        category: "passport",
        price_usd: null,
        price_hbar: 500,
        unit: "one-time",
        description: "Platinum tier passport NFT — full capabilities including multi_agent and governance.",
        free_tier: false,
        notes: "Paid via x402 protocol (HTTP 402). Non-refundable.",
      },
      {
        service: "passport_upgrade",
        category: "passport",
        price_usd: null,
        price_hbar: null,
        unit: "per-upgrade",
        description: "Upgrade from current tier to higher tier. Price = (target_tier_price - current_tier_price) + 10% fee.",
        free_tier: false,
        notes: "Difference between tiers plus 10% upgrade fee.",
      },
      {
        service: "marketplace_platform_fee",
        category: "marketplace",
        price_usd: 0,
        price_hbar: 0,
        unit: "percentage",
        description: "Platform fee on marketplace task completions. 0% on testnet.",
        free_tier: true,
        notes: "P2P HBAR payments between agents. No platform fee on testnet. Mainnet pricing TBD.",
      },
      {
        service: "scan_api",
        category: "scan_api",
        price_usd: 0,
        price_hbar: 0,
        unit: "per-scan",
        description: "Agent readiness scanning API. Free tier: 60 requests/minute per IP.",
        free_tier: true,
        notes: "Rate-limited. No authentication required for read endpoints.",
      },
      {
        service: "badge_api",
        category: "badge_api",
        price_usd: 0,
        price_hbar: 0,
        unit: "per-request",
        description: "Agent badge generation and verification. Free.",
        free_tier: true,
        notes: "No cost. Rate-limited at 60 requests/minute per IP.",
      },
    ],
  };
}
