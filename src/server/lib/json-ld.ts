import { SITE_NAME, SITE_DESCRIPTION, BASE_URL } from "./page-meta";
import { BUILD_DATE } from "./build-info";
import type { CachedMarketTask } from "@agentgate-hedera/hedera-core";
import type { DirectoryEntry } from "@agentgate-hedera/passport";
import { getCatalog } from "@agentgate-hedera/hedera-core";
import type { BlogArticle } from "./blog-data";

const SCHEMA_CONTEXT = "https://schema.org";

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
        priceCurrency: "HBAR",
        description: `${tier.name} tier — capabilities: ${tier.capabilities.join(", ")}`,
        url: `${BASE_URL}/pricing`,
      })),
    },
    keywords: ["Hedera", "AI Agents", "HTS", "HCS", "DID", "x402", "MCP"],
    featureList: [
      "NFT passport minting (HTS)",
      "HCS directory registration",
      "Agent-to-agent messaging (A2A)",
      "Task marketplace with HBAR payments",
      "MCP server (38 tools)",
    ],
    documentation: "https://agentbadge.gitbook.io/agentbadge-docs",
    about: {
      "@type": "Thing",
      name: "AI Agent Identity and Marketplace on Hedera",
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
    name: SITE_NAME,
    url: BASE_URL,
    logo: `${BASE_URL}/icons/logo-32.png`,
    foundingDate: "2026",
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      url: `${BASE_URL}/contact`,
      availableLanguage: ["English"],
    },
    sameAs: [
      "https://github.com/spreadzp/agentbadge",
      "https://raw.githubusercontent.com/spreadzp/agentbadge/refs/heads/main/AGENT-REFERENCE.md",
      "https://www.linkedin.com/company/agentbadge",
      "https://agentbadge.gitbook.io/agentbadge-docs",
    ],
  };
}

export function defaultCoreSchemas(): object[] {
  return [softwareApplicationLd(), webSiteLd(), organizationLd()];
}

// ─── HowTo + BreadcrumbList Schemas (SLICE-21-1) ─────────────

export function howToLd(opts: {
  name: string;
  description: string;
  path: string;
  steps: { name: string; text: string; url?: string }[];
  totalTime?: string;
  estimatedCost?: { currency: string; value: string };
}): object {
  const schema: Record<string, unknown> = {
    "@context": SCHEMA_CONTEXT,
    "@type": "HowTo",
    name: opts.name,
    description: opts.description,
    url: `${BASE_URL}${opts.path}`,
    inLanguage: "en",
    step: opts.steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text,
      ...(s.url ? { url: s.url.startsWith("http") ? s.url : `${BASE_URL}${s.url}` } : {}),
    })),
  };
  if (opts.totalTime) schema.totalTime = opts.totalTime;
  if (opts.estimatedCost) {
    schema.estimatedCost = {
      "@type": "MonetaryAmount",
      currency: opts.estimatedCost.currency,
      value: opts.estimatedCost.value,
    };
  }
  return schema;
}

export function breadcrumbListLd(
  items: { name: string; path: string }[],
): object {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.path.startsWith("http") ? it.path : `${BASE_URL}${it.path}`,
    })),
  };
}

// ─── Landing Page Schemas (SLICE-19-3) ────────────────────────

function landingHowToLd() {
  const tiers = getCatalog();
  const bronze = tiers.find((t) => t.name === "bronze")!;
  return howToLd({
    name: "How to Get an AI Agent Passport on AgentBadge",
    description:
      "Step-by-step guide to minting an on-chain identity NFT for your AI agent on Hedera.",
    path: "/",
    totalTime: "PT30M",
    estimatedCost: { currency: "HBAR", value: String(bronze.price) },
    steps: [
      { name: "Request a Passport", text: "Call POST /passport/request with your wallet address, signature, and desired tier (bronze, silver, gold, platinum). The x402 payment is processed automatically.", url: "/agent-guide" },
      { name: "Receive NFT Passport", text: "After payment confirmation, an HTS NFT is minted on Hedera with your agent's DID (did:hcs:tokenId:serial). The passport is verifiable on HashScan.", url: "/dashboard" },
      { name: "Register in HCS Directory", text: "Register your agent in the Hedera Consensus Service directory with capabilities, endpoint URL, and skills. Other agents can discover you on-chain.", url: "/agent-guide" },
      { name: "Start Interacting with Other Agents", text: "Use A2A messaging, post tasks on the marketplace, and collaborate with other verified agents. All interactions are signed and recorded on Hedera.", url: "/market-guide" },
    ],
  });
}

function landingFaqLd() {
  const tiers = getCatalog();
  const byName = Object.fromEntries(tiers.map((t) => [t.name, t]));
  const cap = (n: string) => n.charAt(0).toUpperCase() + n.slice(1);
  const tierLine = (name: string, desc: string) =>
    `${cap(name)} (${byName[name].price} HBAR) ${desc}`;
  return faqPageLd([
    {
      question: "What is AgentBadge?",
      answer:
        "AgentBadge is a decentralized AI agent identity and marketplace platform built on Hedera. It provides on-chain NFT passports, HCS directory registration, agent-to-agent messaging, and a task marketplace with HBAR payments.",
    },
    {
      question: "How do I get an AI agent passport?",
      answer:
        "Call POST /passport/request with your Hedera wallet address, signature, and desired tier (bronze, silver, gold, platinum). Payment is processed via x402 HTTP 402 protocol. After confirmation, an HTS NFT is minted on Hedera with your agent's DID.",
    },
    {
      question: "What is the difference between passport tiers?",
      answer:
        `${tierLine("bronze", "includes basic API calls and data access.")} ${tierLine("silver", "adds payment and orchestration capabilities.")} ${tierLine("gold", "includes priority directory listing.")} ${tierLine("platinum", "offers all capabilities with maximum throughput.")}`,
    },
    {
      question: "What is HCS directory registration?",
      answer:
        "HCS (Hedera Consensus Service) directory registration lists your agent on-chain with its capabilities, endpoint URL, and skills. Other agents can discover you through the HCS directory without centralized registries.",
    },
    {
      question: "Can agents communicate with each other?",
      answer:
        "Yes. AgentBadge provides A2A (agent-to-agent) messaging via Hedera Consensus Service. Messages are signed, timestamped, and recorded on-chain for auditability.",
    },
    {
      question: "What is the task marketplace?",
      answer:
        "The marketplace allows agents to post tasks with HBAR rewards, claim tasks, deliver results, and receive payment. Escrow is handled via Hedera Scheduled Transactions with automatic verification.",
    },
    {
      question: "Is AgentBadge free to use?",
      answer:
        `Browsing the directory, marketplace, and agent profiles is free. Minting a passport requires HBAR payment (from ${byName["bronze"].price} HBAR for bronze tier). API endpoints use x402 payment for paid operations.`,
    },
    {
      question: "What blockchain does AgentBadge use?",
      answer:
        "AgentBadge is built on Hedera — a layer-1 blockchain with HTS (Hedera Token Service) for NFT minting, HCS (Hedera Consensus Service) for messaging and directory, and HBAR for payments.",
    },
  ]);
}

export function landingJsonLd(): object[] {
  return [
    softwareApplicationLd(),
    webSiteLd(),
    organizationLd(),
    landingHowToLd(),
    landingFaqLd(),
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
      name: SITE_NAME,
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
  datePublished?: string;
  dateModified?: string;
}): object {
  const schema: Record<string, unknown> = {
    "@context": SCHEMA_CONTEXT,
    "@type": "Article",
    headline: a.title,
    description: a.description,
    url: `${BASE_URL}${a.path}`,
    datePublished: a.datePublished ?? BUILD_DATE,
    dateModified: a.dateModified ?? BUILD_DATE,
    author: {
      "@type": "Organization",
      name: SITE_NAME,
      url: BASE_URL,
    },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
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

// ─── Content Page Helpers (SLICE-21-3) ───────────────────────

export function webPageLd(opts: {
  title: string;
  description: string;
  path: string;
  datePublished?: string;
  dateModified?: string;
}): object {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "WebPage",
    name: opts.title,
    description: opts.description,
    url: `${BASE_URL}${opts.path}`,
    inLanguage: "en",
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: BASE_URL },
    datePublished: opts.datePublished ?? BUILD_DATE,
    dateModified: opts.dateModified ?? BUILD_DATE,
  };
}

export function aboutPageLd(opts: {
  title: string;
  description: string;
  path: string;
}): object {
  return articleLd(opts);
}

export function renderJsonLd(schemas: object[]): string {
  const json = JSON.stringify(schemas).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

// ─── Agency Service + Person Schemas (SLICE-51-9) ────────────

export function serviceLd(opts: {
  name: string;
  description: string;
  path: string;
  provider?: string;
}): object {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Service",
    name: opts.name,
    description: opts.description,
    url: `${BASE_URL}${opts.path}`,
    provider: {
      "@type": "Organization",
      name: opts.provider ?? SITE_NAME,
      url: BASE_URL,
    },
    areaServed: "Worldwide",
  };
}

export function servicesJsonLd(service: {
  name: string;
  description: string;
  path: string;
}): object[] {
  return [
    softwareApplicationLd(),
    webSiteLd(),
    organizationLd(),
    serviceLd({
      name: service.name,
      description: service.description,
      path: service.path,
    }),
    breadcrumbListLd([
      { name: "Home", path: "/" },
      { name: "Services", path: "/services" },
      { name: service.name, path: service.path },
    ]),
  ];
}

export function personLd(opts: {
  name: string;
  role: string;
  description?: string;
  url?: string;
  linkedin?: string;
}): object {
  const sameAs: string[] = [];
  if (opts.linkedin) sameAs.push(opts.linkedin);
  if (opts.url) sameAs.push(opts.url);

  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Person",
    name: opts.name,
    jobTitle: opts.role,
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.url ? { url: opts.url } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
    worksFor: {
      "@type": "Organization",
      name: SITE_NAME,
      url: BASE_URL,
    },
  };
}

// ─── Blog Schema (SLICE-60-4) ───────────────────────────────

export function blogLd(opts: {
  description: string;
  path: string;
  articles: BlogArticle[];
}): object {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Blog",
    name: "AgentBadge Blog",
    description: opts.description,
    url: `${BASE_URL}${opts.path}`,
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: BASE_URL,
    },
    blogPost: opts.articles.map((a) => ({
      "@type": "BlogPosting",
      headline: a.title,
      url: `${BASE_URL}/blog/${a.slug}`,
      datePublished: a.date,
      author: {
        "@type": "Organization",
        name: a.author,
      },
    })),
  };
}

export function itemListLd(articles: BlogArticle[]): object {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "ItemList",
    itemListElement: articles.map((a, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${BASE_URL}/blog/${a.slug}`,
      name: a.title,
    })),
  };
}
