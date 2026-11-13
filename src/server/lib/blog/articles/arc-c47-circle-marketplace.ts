import type { BlogArticle } from "../../blog-data";
import { arcC47CircleMarketplaceContent } from "./arc-c47-circle-marketplace.content";

export const article: BlogArticle = {
  slug: "arc-c47-circle-marketplace",
  title:
    "Listed, Not Listed: Putting AgentBadge on Circle's Agent Services Marketplace — and Telling Machines the Truth",
  description:
    "We submitted the Agent-Readiness Scan to Circle's Agent Services Marketplace — POST /api/total-scan, x402-paid, USDC on Arc via EIP-3009 transferWithAuthorization. While the listing sits in pending_review, every machine-readable surface we own (llms.txt, skill.json, /.well-known/agentbadge.json, Organization JSON-LD) already declares it with the honest status — and the settle telemetry was shipped before the first sale.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-13",
  dateModified: "2026-11-13",
  tags: [
    "circle",
    "agent-services-marketplace",
    "x402",
    "usdc",
    "arc",
    "discovery-api",
    "llms-txt",
    "agent-readiness",
    "metadata-integrity",
    "epic-242",
  ],
  readingTime: "6 min",
  shortAnswer:
    "We submitted our Agent-Readiness Scan to Circle's Agent Services Marketplace — POST /api/total-scan, x402-paid, USDC on Arc via EIP-3009 transferWithAuthorization. Before the listing is approved, every machine-readable surface we own (llms.txt, skill.json, /.well-known/agentbadge.json, Organization JSON-LD) already declares it — with the honest status pending_review, not listed. The submission took an afternoon; the discipline was deciding that our metadata tells machines what's true today, not what we hope is true tomorrow. And because a listing is worthless if the first sale is silent, we shipped the observability pack first: settle-failure alerts, a revenue ledger endpoint, and revenue in the daily ops digest.",
  heroImage: "/images/blog/arc-c47-circle-marketplace-hero.webp",
  ogImage: "/images/blog/arc-c47-circle-marketplace-og.jpeg",
  status: "LIVE",
  technologies: [
    "TypeScript",
    "Bun",
    "Hono",
    "x402",
    "USDC",
    "Arc",
    "EIP-3009",
  ],
  entities: [
    "circle-agent-services-marketplace",
    "circle-discovery-api",
    "marketplace-listings-registry",
    "epic-242",
    "x402-total-scan-endpoint",
    "settle-failure-alert",
    "econ-ledger-revenue",
  ],
  concepts: [
    "honest-metadata-status",
    "single-source-registry",
    "index-is-ground-truth",
    "fuzzy-query-false-positive",
    "telemetry-before-first-sale",
    "pending-review-status-vocabulary",
    "multi-surface-propagation",
  ],
  topics: [
    "payments",
    "distribution",
    "agent-readiness",
    "arc",
    "x402",
    "metadata-integrity",
  ],
  capabilities: [
    "marketplace-listing-registry",
    "x402-paid-scan-endpoint",
    "settle-failure-alerts",
    "revenue-ledger-endpoint",
    "ops-digest-x402-revenue",
    "machine-readable-distribution-surfaces",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/arc-c47-circle-marketplace.md",
    },
    {
      type: "read",
      label: "Marketplace listings registry",
      url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/agent-discovery/marketplace-listings.ts",
    },
    {
      type: "read",
      label: "Live /llms.txt",
      url: "https://agentbadge.xyz/llms.txt",
    },
    {
      type: "read",
      label: "Live /skill.json",
      url: "https://agentbadge.xyz/skill.json",
    },
  ],
  qa: [
    {
      question: "Is AgentBadge actually listed on Circle's marketplace right now?",
      answer:
        "No — as of 2026-11-13 the listing is pending_review. The checkable answer lives in Circle's Discovery API (GET /v2/x402/discovery/resources): our items[] entry is empty until approval. Name queries are fuzzy (agentbadge returns anchor-x402), so the reliable check is the resource URL or the payTo wallet in accepts[].",
    },
    {
      question: "What exactly did AgentBadge submit?",
      answer:
        "The Agent-Readiness Scan at POST https://agentbadge.xyz/api/total-scan — x402 payment, USDC on Arc (eip155:5042002), EIP-3009 transferWithAuthorization. An agent hits the endpoint, gets HTTP 402 with price/payTo/network, retries with a signed PAYMENT-SIGNATURE, the facilitator settles USDC on Arc, and the agent gets the scan report. No API keys, no accounts.",
    },
    {
      question: "Why declare pending_review instead of listed?",
      answer:
        "Because an LLM agent reading llms.txt or skill.json cannot tell that 'listed' means 'we submitted a form' — it would act on a false claim and fail at checkout. One registry (marketplace-listings.ts) feeds all four machine-readable surfaces with pending_review, so approval flips a single string and every surface updates at once — and a future delisting can't leave a stale JSON-LD claim behind.",
    },
    {
      question: "What observability exists before the first sale?",
      answer:
        "Three pieces shipped before submission: settle-failure alerts to Telegram/Discord deduped by error reason over 15 minutes (verify failures stay log-only), GET /api/ledger/revenue?days=N for paid-leg rollups (total, byDay, byEndpoint), and an x402Revenue block in the daily ops digest. Tests also caught an econ-events schema bug stripping the endpoint field — fixed upstream in @agentbadge/econ-events@0.1.4.",
    },
    {
      question: "What happens when Circle approves the listing?",
      answer:
        "Four steps: the Discovery API returns our items[] entry (resource, accepts[], metadata.provider); pending_review flips to listed in marketplace-listings.ts and all four surfaces update; we verify accepts[].network = eip155:5042002 and payTo = our wallet since the catalog rendering can lag the index; then the article hero swaps to the catalog screenshot and a second-wave announcement goes out.",
    },
  ],
  claims: [
    {
      id: "c47-submitted-pending-review",
      status: "VERIFIED",
      text: "The Agent-Readiness Scan was submitted to Circle's Agent Services Marketplace on 2026-11-12 (POST /api/total-scan, x402, USDC on Arc eip155:5042002, EIP-3009 transferWithAuthorization). Status pending_review — verified live: GET api.circle.com/v2/x402/discovery/resources?query=agentbadge returns only anchor-x402 (fuzzy match), and query=agentbadge.xyz returns zero items.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/agent-discovery/marketplace-listings.ts",
        },
      ],
    },
    {
      id: "c47-single-registry-four-surfaces",
      status: "VERIFIED",
      text: "A single registry — marketplace-listings.ts — propagates listing status to four machine-readable surfaces: /llms.txt (Distribution section), /skill.json (ab:distribution), /.well-known/agentbadge.json (marketplace_listings), and Organization JSON-LD (sameAs). Status vocabulary: pending_review | listed | indexed; flipping one string updates every surface.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/agent-discovery/marketplace-listings.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/agent-discovery/llms-core.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/deployment-descriptor.ts",
        },
      ],
    },
    {
      id: "c47-discovery-fuzzy-match-caveat",
      status: "VERIFIED",
      text: "Circle Discovery API ?query= matching is fuzzy and name queries produce false positives (agentbadge → anchor-x402, total-scan → unrelated AIsa/Arrays resources). The reliable verification is the resource URL or accepts[].payTo wallet — re-verified 2026-11-13 against the live index.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/docs/ARTICLES/content-plan/round-2/articles/arc-c47-circle-marketplace/AgentBadge-Blog.md",
        },
      ],
    },
    {
      id: "c47-observability-before-first-sale",
      status: "VERIFIED",
      text: "Observability shipped before the listing: settle-failure alerts to Telegram/Discord deduped by error reason over 15 minutes (verify failures log-only), GET /api/ledger/revenue?days=N rollup (total, byDay, byEndpoint), and an x402Revenue block in the daily ops digest.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/services/settle-failure-alert.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/routes/econ-ledger-revenue-api.ts",
        },
      ],
    },
    {
      id: "c47-econ-events-endpoint-fix",
      status: "VERIFIED",
      text: "Tests caught the econ-events schema stripping the endpoint field from settle legs, silently breaking revenue-by-endpoint attribution. Fixed upstream in @agentbadge/econ-events@0.1.4 so historical attribution stays honest.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/package.json",
        },
      ],
    },
  ],
  externalLinks: [],
  content: arcC47CircleMarketplaceContent,
};
