import { SITE_NAME, SITE_DESCRIPTION, BASE_URL } from "../page-meta";
import { BUILD_DATE } from "../build-info";
import { getCatalog } from "@agentbadge/hedera-core";
import { listTools } from "@agentbadge/mcp";
import { SCHEMA_CONTEXT, chainCurrency, chainVars } from "./shared";

export function softwareApplicationLd(): object {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Any",
    url: BASE_URL,
    offers: {
      "@type": "OfferCatalog",
      name: "AgentBadge Passport Tiers",
      itemListElement: getCatalog().map((tier) => ({
        "@type": "Offer",
        name: `${tier.name.charAt(0).toUpperCase() + tier.name.slice(1)} Passport`,
        price: String(tier.price),
        priceCurrency: chainCurrency(),
        description: `${tier.name} tier — capabilities: ${tier.capabilities.join(", ")}`,
        url: `${BASE_URL}/pricing`,
      })),
    },
    keywords: [chainVars().CHAIN_NAME, "AI Agents", chainVars().NFT_STANDARD, chainVars().CONSENSUS, "DID", "x402", "MCP"],
    featureList: [
      `NFT passport minting (${chainVars().NFT_STANDARD})`,
      `${chainVars().CONSENSUS} directory registration`,
      "Agent-to-agent messaging (A2A)",
      `Task marketplace with ${chainCurrency()} payments`,
      `MCP server (${listTools().length} tools)`,
    ],
    documentation: "https://agentbadge.gitbook.io/agentbadge-docs",
    about: {
      "@type": "Thing",
      name: `AI Agent Identity and Marketplace on ${chainVars().CHAIN_NAME}`,
      url: "https://agentbadge.gitbook.io/agentbadge-docs",
    },
    dateModified: BUILD_DATE,
  };
}

export function webSiteLd(): object {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "WebSite",
    name: SITE_NAME,
    url: BASE_URL,
    documentation: "https://agentbadge.gitbook.io/agentbadge-docs",
    dateModified: BUILD_DATE,
  };
}

export function organizationLd(): object {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Organization",
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: BASE_URL,
    slogan: "Agency for the Agentic Web",
    logo: {
      "@type": "ImageObject",
      url: `${BASE_URL}/icons/logo-512.png`,
    },
    foundingDate: "2026",
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: "support@agentbadge.xyz",
      url: `${BASE_URL}/contact`,
      availableLanguage: ["English"],
    },
    sameAs: [
      "https://github.com/spreadzp/agentbadge",
      "https://www.linkedin.com/company/agentbadge",
      "https://agentbadge.gitbook.io/agentbadge-docs",
    ],
  };
}
