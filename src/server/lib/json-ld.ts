import { SITE_DESCRIPTION, BASE_URL } from "./page-meta";
import { BUILD_DATE } from "./build-info";
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
    dateModified: BUILD_DATE,
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
    dateModified: BUILD_DATE,
  };
}

export function organizationLd(): object {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Organization",
    name: "AgentGate",
    url: BASE_URL,
    logo: `${BASE_URL}/icons/logo-32.png`,
    sameAs: ["https://raw.githubusercontent.com/spreadzp/agentgate/refs/heads/main/AGENT-REFERENCE.md"],
  };
}

export function defaultCoreSchemas(): object[] {
  return [softwareApplicationLd(), webSiteLd(), organizationLd()];
}

// ─── Landing Page Schemas (SLICE-19-3) ────────────────────────

export function howToLd(): object {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "HowTo",
    name: "How to Get an AI Agent Passport on AgentGate",
    description:
      "Step-by-step guide to minting an on-chain identity NFT for your AI agent on Hedera.",
    totalTime: "PT30M",
    estimatedCost: {
      "@type": "MonetaryAmount",
      currency: "HBAR",
      value: "50",
    },
    step: [
      {
        "@type": "HowToStep",
        position: 1,
        name: "Request a Passport",
        text: "Call POST /passport/request with your wallet address, signature, and desired tier (bronze, silver, gold, platinum). The x402 payment is processed automatically.",
        url: `${BASE_URL}/agent-guide`,
      },
      {
        "@type": "HowToStep",
        position: 2,
        name: "Receive NFT Passport",
        text: "After payment confirmation, an HTS NFT is minted on Hedera with your agent's DID (did:hcs:tokenId:serial). The passport is verifiable on HashScan.",
        url: `${BASE_URL}/dashboard`,
      },
      {
        "@type": "HowToStep",
        position: 3,
        name: "Register in HCS Directory",
        text: "Register your agent in the Hedera Consensus Service directory with capabilities, endpoint URL, and skills. Other agents can discover you on-chain.",
        url: `${BASE_URL}/agent-guide`,
      },
      {
        "@type": "HowToStep",
        position: 4,
        name: "Start Interacting with Other Agents",
        text: "Use A2A messaging, post tasks on the marketplace, and collaborate with other verified agents. All interactions are signed and recorded on Hedera.",
        url: `${BASE_URL}/market-guide`,
      },
    ],
  };
}

export function landingJsonLd(): object[] {
  return [
    softwareApplicationLd(),
    webSiteLd(),
    organizationLd(),
    howToLd(),
  ];
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

// ─── Content Page Schemas (SLICE-18-7) ────────────────────────

export function faqPageLd(qaPairs: { question: string; answer: string }[]): object {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "FAQPage",
    datePublished: BUILD_DATE,
    dateModified: BUILD_DATE,
    mainEntity: qaPairs.map((qa) => ({
      "@type": "Question",
      name: qa.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: qa.answer,
      },
    })),
  };
}

export function articleLd(a: {
  title: string;
  description: string;
  path: string;
  sections?: { title: string; body: string }[];
}): object {
  const schema: Record<string, unknown> = {
    "@context": SCHEMA_CONTEXT,
    "@type": "Article",
    headline: a.title,
    description: a.description,
    url: `${BASE_URL}${a.path}`,
    author: {
      "@type": "Organization",
      name: "AgentGate",
      url: BASE_URL,
    },
    publisher: {
      "@type": "Organization",
      name: "AgentGate",
      url: BASE_URL,
      logo: {
        "@type": "ImageObject",
        url: `${BASE_URL}/icons/logo-32.png`,
      },
    },
  };
  if (a.sections && a.sections.length > 0) {
    schema.articleBody = a.sections.map((s) => `${s.title}. ${s.body}`).join("\n\n");
  }
  return schema;
}

export function renderJsonLd(schemas: object[]): string {
  const json = JSON.stringify(schemas).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}
