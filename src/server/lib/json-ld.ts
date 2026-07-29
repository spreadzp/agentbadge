import { SITE_DESCRIPTION, BASE_URL } from "./page-meta";
import type { CachedMarketTask } from "@agentgate-hedera/hedera-core";
import type { DirectoryEntry } from "@agentgate-hedera/passport";

const SCHEMA_CONTEXT = "https://schema.org";

export function softwareApplicationLd(): object {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "SoftwareApplication",
    name: "AgentGate",
    description: SITE_DESCRIPTION,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Any",
    url: BASE_URL,
    offers: {
      "@type": "Offer",
      price: "0.001",
      priceCurrency: "USD",
      description: "NFT passport mint on Hedera (HTS)",
    },
    keywords: ["Hedera", "AI Agents", "HTS", "HCS", "DID", "x402", "MCP"],
    featureList: [
      "NFT passport minting (HTS)",
      "HCS directory registration",
      "Agent-to-agent messaging (A2A)",
      "Task marketplace with HBAR payments",
      "MCP server (32 tools)",
    ],
  };
}

export function webSiteLd(): object {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "WebSite",
    name: "AgentGate",
    url: BASE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${BASE_URL}/ui/search?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export function organizationLd(): object {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Organization",
    name: "AgentGate",
    url: BASE_URL,
    logo: `${BASE_URL}/icons/logo-32.png`,
    sameAs: ["https://github.com/spreadzp/agentgate"],
  };
}

export function defaultCoreSchemas(): object[] {
  return [softwareApplicationLd(), webSiteLd(), organizationLd()];
}

// ─── Entity Schemas (SLICE-18-5) ──────────────────────────────

export function passportLd(p: {
  tokenId: string;
  serial: number;
  tier: string;
  ownerDID?: string;
}): object {
  const schema: Record<string, unknown> = {
    "@context": SCHEMA_CONTEXT,
    "@type": "DigitalDocument",
    identifier: `did:hcs:${p.tokenId}:${p.serial}`,
    additionalType: "VerifiableCredential",
    isPartOf: {
      "@type": "SoftwareApplication",
      name: "AgentGate",
      url: BASE_URL,
    },
    about: {
      "@type": "Thing",
      name: "AI Agent Passport",
    },
    encodingFormat: "application/json",
    url: `${BASE_URL}/ui/agents/${p.tokenId}/${p.serial}`,
  };
  if (p.ownerDID) {
    schema.creator = { "@type": "Organization", identifier: p.ownerDID };
  }
  if (p.tier) {
    schema.keywords = p.tier;
  }
  return schema;
}

export function jobPostingLd(t: CachedMarketTask): object {
  const schema: Record<string, unknown> = {
    "@context": SCHEMA_CONTEXT,
    "@type": "JobPosting",
    title: t.title,
    description: t.description,
    datePosted: new Date(t.createdAt).toISOString(),
    employmentType: "CONTRACT",
    hiringOrganization: {
      "@type": "Organization",
      identifier: t.posterDid,
    },
    baseSalary: {
      "@type": "MonetaryAmount",
      currency: "HBAR",
      value: t.priceHbar,
    },
    url: `${BASE_URL}/ui/market/tasks/${t.taskId}`,
  };
  if (t.deadline) {
    schema.validThrough = new Date(t.deadline).toISOString();
  }
  if (t.capabilities.length > 0) {
    schema.skills = t.capabilities.join(", ");
  }
  return schema;
}

export function profilePageLd(a: DirectoryEntry): object {
  const schema: Record<string, unknown> = {
    "@context": SCHEMA_CONTEXT,
    "@type": "ProfilePage",
    url: `${BASE_URL}/ui/agents/${a.tokenId}/${a.serial}`,
    mainEntity: {
      "@type": "Thing",
      name: a.name,
      identifier: a.did,
    },
  };
  if (a.endpoint) {
    (schema.mainEntity as Record<string, unknown>).sameAs = a.endpoint;
  }
  if (a.capabilities.length > 0) {
    (schema.mainEntity as Record<string, unknown>).knowsAbout = a.capabilities;
  }
  if (a.tier) {
    (schema.mainEntity as Record<string, unknown>).additionalType = a.tier;
  }
  return schema;
}

export function renderJsonLd(schemas: object[]): string {
  const json = JSON.stringify(schemas).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}
