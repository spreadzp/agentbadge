// EPIC-140 (SLICE-140-20): FAQ entries faq_entries_a2 (split under the 20KB token-limit cap).
import type { QaPair } from "./data";

export const FAQ_ENTRIES_A2: QaPair[] = [
  {
    question: "What is continuous monitoring in AgentBadge?",
    answer:
      "Continuous monitoring runs AgentBadge scans periodically and alerts you when your readiness score changes. This catches regressions — a new deployment that breaks OpenAPI, a removed llms.txt, a changed auth scheme — before agents encounter them in production. Monitoring ensures your agent readiness stays high over time, not just at a single audit moment.",
  },
  {
    question: "What is the AgentBadge funnel report?",
    answer:
      "The funnel report shows how many checks pass or fail at each stage of agent interaction: discovery (can agents find you?) → understanding (can they parse your API?) → execution (can they call it?) → verification (can they trust the results?). AgentBadge uses this funnel to pinpoint where agents get stuck, so you can fix the highest-impact gaps first.",
  },
  {
    question: "What blockchains does AgentBadge support?",
    answer:
      "AgentBadge runs on Arc mainnet (eip155:5042) for production — passports, marketplace escrows, and USDC payments settle there; Arc Testnet (eip155:5042002) is the sandbox. Base Sepolia hosts the TrustRegistry/TrustBadge scan-recording contracts. The architecture uses a ChainAdapter interface that abstracts chain-specific operations — passport minting, DID generation, escrow, and messaging — so adding new chains requires implementing the adapter, not rewriting the application. (legacy: Hedera Testnet — did:hcs: passports and the HCS directory remain readable as historical records.)",
  },
  {
    question: "What is a ChainAdapter in AgentBadge?",
    answer:
      "A ChainAdapter is an interface that abstracts chain-specific operations in AgentBadge — NFT minting, DID generation, escrow contracts, and consensus messaging. The EVM adapter uses ERC-721 and event logs; the legacy Hedera adapter uses HTS and HCS. This abstraction lets AgentBadge support multiple blockchains without changing the application logic.",
  },
  {
    question: "What is WebMCP in AgentBadge?",
    answer:
      "WebMCP is a W3C proposal for browser-side Model Context Protocol tools. AgentBadge implemented a WebMCP hackathon page at /hackathon/webmcp that registers {{WEBMCP_TOOL_COUNT}} tools — agent-readiness-scan, badge-generate, passport-issue, passport-verify, get-compliance-score, and search-rules — directly in the browser. When browsers ship the `document.modelContext` API, agents will be able to invoke these tools without a server round-trip.",
  },
  {
    question: "How does task escrow work in the AgentBadge marketplace?",
    answer:
      "In the AgentBadge marketplace, tasks are funded on-chain before they're visible to agents. When an agent claims a task, the escrow smart contract locks the payment. On successful delivery, the payment is released to the agent's account. If the task is abandoned or fails, the funds return to the task creator. This trustless escrow ensures agents get paid and creators get results — all on Arc.",
  },
  {
    question: "What is the marketplace task lifecycle in AgentBadge?",
    answer:
      "AgentBadge's marketplace uses a state machine for task lifecycle: Created → Funded → Open → Claimed → In Progress → Submitted → Verified → Completed (or Disputed → Refunded). Each state transition is an on-chain transaction, providing full auditability. Agents can track task status via the marketplace API or MCP tools, ensuring transparency at every step.",
  },
  {
    question: "What is the AgentBadge blog?",
    answer:
      "The AgentBadge blog publishes in-depth articles on agent readiness, MCP, x402 payments, API discovery, and the agentic web. Articles cover both theory and practice — from 'What is Agent Readiness?' to 'Inside an Agent Readiness Scanner'. The blog is optimized for both human readers and AI agents, with structured data, machine-readable metadata, and cross-links to the agent guide. <a href=\"/blog/what-is-agent-readiness\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: What Is Agent Readiness? →</a>",
  },
  {
    question: "How does AgentBadge handle SEO for agents?",
    answer:
      "AgentBadge optimizes APIs for agent discoverability using llms.txt, agents.txt, OpenAPI specs, structured data (JSON-LD), and machine-readable endpoints like /.well-known/agent-card.json. This is the agent equivalent of SEO — making your service findable and understandable by AI agents without human intervention. <a href=\"/blog/from-seo-to-geo-to-agent-readiness\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: From SEO to GEO to Agent Readiness →</a>",
  },
  {
    question: "How does AgentBadge support agent discovery on the web?",
    answer:
      "AgentBadge provides multiple discovery layers: llms.txt for capability declarations, agents.txt for auth and contact info, /sitemap.xml for page inventory, and MCP servers for tool-level discovery. As the web becomes agentic, these machine-readable layers replace traditional search-based discovery for AI agents. <a href=\"/blog/web-becoming-agentic-api-discovery\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: The Web Is Becoming Agentic →</a>",
  },
  {
    question: "What is Agent Readiness?",
    answer:
      "Agent Readiness is the ability of your API or service to be discovered, understood, and used by an AI agent without human intervention. It extends SEO principles to machine-readable interfaces — OpenAPI, MCP, llms.txt, and structured discovery layers. AgentBadge measures Agent Readiness with deterministic checks and evidence, not opinions. <a href=\"/blog/what-is-agent-readiness\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: What Is Agent Readiness? →</a>",
  },
  {
    question: "How is Agent Readiness different from SEO?",
    answer:
      "SEO optimizes websites for search engines like Google; Agent Readiness optimizes APIs and services for AI agents. SEO targets human queries and click-through rates, while Agent Readiness targets machine-readable discovery (llms.txt, MCP), structured execution (OpenAPI, auth), and autonomous payment (x402). AgentBadge bridges both worlds — a good SEO score doesn't mean your API is agent-ready. <a href=\"/blog/api-has-seo-agent-readiness\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: Your API Has SEO. Does It Have Agent Readiness? →</a>",
  },
  {
    question: "What is GEO (Generative Engine Optimization) and how does it relate to Agent Readiness?",
    answer:
      "GEO (Generative Engine Optimization) optimizes content for generative AI responses — making your content citable by LLMs and AI search engines. AgentBadge treats GEO as one layer in a three-tier optimization stack: SEO for websites, GEO for content, and Agent Readiness for APIs. All three are needed for full discoverability in the agentic web. <a href=\"/blog/from-seo-to-geo-to-agent-readiness\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: From SEO to GEO to Agent Readiness →</a>",
  },
  {
    question: "What is MCP vs REST API for AI agents?",
    answer:
      "MCP (Model Context Protocol) is becoming the primary way AI agents interact with services, complementing REST APIs. While REST APIs require agents to understand HTTP methods, status codes, and payloads, MCP exposes tools with typed schemas that agents can invoke directly. AgentBadge supports both — REST APIs for existing integrations and MCP for agent-native access. <a href=\"/blog/mcp-vs-api\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: MCP vs API: Agent Tools 2026 →</a>",
  },
  {
    question: "What are the 8 layers of context an AI agent needs to understand an API?",
    answer:
      "An AI agent needs 8 layers of context to use an API reliably: discovery, capabilities, inputs, authentication, semantics, output, errors, and safety. OpenAPI alone covers 2-3 layers — the rest require MCP, llms.txt, examples, and structured metadata. AgentBadge's scanner checks all 8 layers to ensure agents can use your API end-to-end. <a href=\"/blog/what-ai-agent-needs-to-understand-api\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: What Does an AI Agent Need to Understand an API? →</a>",
  },
  {
    question: "Why isn't OpenAPI enough for AI agents?",
    answer:
      "OpenAPI covers syntax (endpoints, parameters, responses) but not semantics (what parameters mean), execution (auth flows, rate limits), or safety (idempotency, retry behavior). Agents need all 8 context layers, and OpenAPI addresses only 2-3. AgentBadge's scanner identifies exactly which layers are missing and provides fix recommendations for each. <a href=\"/blog/why-openapi-isnt-enough\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: Why Your OpenAPI Spec Isn't Enough →</a>",
  },
  {
    question: "How should Agent Readiness be measured?",
    answer:
      "Agent Readiness should be measured with deterministic checks and evidence, not LLM opinions. Each check produces a status (VERIFIED, INFERRED, CONFLICT, MISSING) backed by captured evidence. AgentBadge follows the principle: don't certify — measure. You get a reproducible score based on what the scanner actually observed, not a subjective label. <a href=\"/blog/how-do-you-measure-agent-readiness\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: How Do You Measure Agent Readiness? →</a>",
  },
  {
    question: "What makes an Agent Readiness scanner reproducible?",
    answer:
      "A reproducible scan requires: the target URL, a timestamp, the ruleset version, the scan artifact (raw responses), and a report hash. Given the same URL and ruleset version, AgentBadge produces the same result — no randomness, no LLM opinions. This reproducibility is what separates measurement from certification. <a href=\"/blog/inside-an-agent-readiness-scanner\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: Inside an Agent Readiness Scanner →</a>",
  },
  {
    question: "What is the agentic web?",
    answer:
      "The agentic web is the next evolution of the internet where AI agents, not humans, are the primary consumers of APIs and services. It requires machine-readable discovery layers (llms.txt, MCP), autonomous payment protocols (x402 on Arc), and agent identity (NFT passports). AgentBadge is building the infrastructure for this transition — scanning, identity, and marketplace. <a href=\"/blog/web-becoming-agentic-api-discovery\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: The Web Is Becoming Agentic →</a> <a href=\"/blog/x402-payments\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: x402 Payments →</a>",
  },
  {
    question: "What is the difference between SEO and GEO?",
    answer:
      "SEO (Search Engine Optimization) optimizes websites for search engine crawlers and human queries. GEO (Generative Engine Optimization) optimizes content for generative AI models — making it citable, structured, and authoritative. AgentBadge adds a third layer: Agent Readiness, which optimizes APIs for autonomous AI agents. All three serve different consumers but share principles like structured data and discoverability. <a href=\"/blog/from-seo-to-geo-to-agent-readiness\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: From SEO to GEO to Agent Readiness →</a>",
  },
  // ── SLICE-105-1: Core scanner EPIC Q&A (47, 48, 49, 87, 93, 94, 95, 96, 98, 99) ──
  {
    question: "What is content negotiation for AI agents?",
    answer:
      "Content negotiation lets an AI agent request a specific response format (JSON, markdown, plain text) via HTTP Accept headers. AgentBadge checks whether your API supports agent-friendly content types — not just HTML. When an agent sends `Accept: application/json`, your server should respond with structured data, not a web page. This is a core Agent Readiness principle: agents need machine-readable responses, not human-facing HTML.",
  },
  {
    question: "What is llms.txt and why does AgentBadge check for it?",
    answer:
      "llms.txt is a lightweight standard — similar to robots.txt — that provides LLM-readable information about your site or API. It tells agents what your service does, how to authenticate, and where to find documentation. AgentBadge checks for llms.txt because it's one of the simplest, highest-impact discovery layers: a single file that makes your service instantly understandable to AI agents. <a href=\"/blog/what-ai-agent-needs-to-understand-api\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: What Does an AI Agent Need to Understand an API? →</a>",
  },
  {
    question: "What is an AgentBadge improvement guide?",
    answer:
      "When AgentBadge finds gaps in your API's agent readiness, it generates an improvement guide — a prioritized, actionable list of fixes. Each recommendation explains what to change, why it matters, and how to do it. Improvement guides bridge the gap between scanning and fixing: instead of just reporting a score, AgentBadge tells you exactly what to improve next. <a href=\"/blog/why-openapi-isnt-enough\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: Why Your OpenAPI Spec Isn't Enough →</a>",
  },
  {
    question: "What are semantic checks in AgentBadge?",
    answer:
      "Semantic checks go beyond syntax validation — they verify that your API documentation is internally consistent and contextually correct. For example, AgentBadge checks that your OpenAPI spec's auth schemes match what your well-known endpoints declare, and that your llms.txt claims align with your actual endpoints. Semantic checks catch contradictions that syntax-only validators miss, giving you a deeper level of readiness verification.",
  },
  {
    question: "What is active probing in AgentBadge's scanner?",
    answer:
      "Active probing means AgentBadge sends real HTTP requests to your endpoints — not just parsing your spec. The scanner fetches robots.txt, calls /.well-known/ endpoints, validates OpenAPI schemas, and tests authentication flows. This goes beyond static analysis: if your spec says an endpoint exists but it returns 404, AgentBadge's active probing catches the discrepancy and flags it as a gap.",
  },
];
