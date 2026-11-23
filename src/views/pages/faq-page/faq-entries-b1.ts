// EPIC-140 (SLICE-140-20): FAQ entries faq_entries_b1 (split under the 20KB token-limit cap).
import type { QaPair } from "./data";

export const FAQ_ENTRIES_B1: QaPair[] = [
  {
    question: "Is AgentBadge the same as the npm package \"agentbadge\"?",
    answer:
      "No. AgentBadge (agentbadge.xyz) is the agent-readiness platform for websites and APIs — deterministic checks, NFT passports on Arc, and a USDC agent marketplace. The unscoped npm package \"agentbadge\" and the github.com/Emreceyhnn/Agentbadge repository are a different, unrelated project that scores code repositories for AI coding agents. Our npm packages ship only under the <code>@agentbadge/*</code> scope — e.g. <code>@agentbadge/scanner</code>.",
  },
  {
    question: "What is the AgentBadge readiness badge?",
    answer:
      "The AgentBadge readiness badge is an SVG image that displays your current readiness score and grade (A through F). You can embed it in your README, website, or API docs to show agents and developers that your API has been scanned. The badge links back to your full report on AgentBadge, providing a verifiable trust signal — similar to a CI badge, but for agent readiness.",
  },
  {
    question: "What are confidence levels in AgentBadge's evidence engine?",
    answer:
      "AgentBadge's evidence engine assigns confidence levels to each finding based on the source quality. A direct response from your API has higher confidence than an inference from documentation. Evidence is classified by source class (primary, secondary, inferred) and confidence (high, medium, low). This means you can trust that a VERIFIED status came from real observed behavior, not a guess — making AgentBadge's scores reproducible and auditable.",
  },
  {
    question: "How many checks does AgentBadge run?",
    answer:
      "AgentBadge runs {{RULE_COUNT}} checks across {{CATEGORY_COUNT}} categories, covering discovery (robots.txt, llms.txt, OpenAPI), authentication (OAuth2, API keys, well-known), documentation (content negotiation, error schemas), execution (rate limits, idempotency), and verification (semantic consistency, runtime tests). Each check produces a status (VERIFIED, INFERRED, CONFLICT, MISSING) with captured evidence. <a href=\"/blog/inside-an-agent-readiness-scanner\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: Inside an Agent Readiness Scanner →</a>",
  },
  {
    question: "What is DNS-AID and how does AgentBadge use it?",
    answer:
      "DNS-AID is a DNS-based agent identification protocol that lets agents publish their identity and capabilities via DNS TXT records. AgentBadge checks for DNS-AID records as part of its discovery checks — agents can be discovered not just via HTTP endpoints but also via DNS, providing an alternative discovery channel that works even when HTTP endpoints are unavailable. This is part of AgentBadge's multi-layer discovery approach.",
  },
  {
    question: "What is WebMCP and how does it relate to AgentBadge?",
    answer:
      "WebMCP is a web-native variant of the Model Context Protocol that exposes MCP tools over HTTP instead of stdio. This lets agents discover and call tools via standard web requests without a local MCP client. AgentBadge checks for WebMCP endpoints (like /.well-known/mcp.json) as part of its tool discovery checks, ensuring your service is accessible to both stdio-based and web-based AI agents.",
  },
  // ── SLICE-105-2: Platform EPIC Q&A (51, 52, 53, 54, 55, 84, 88, 90) ──
  {
    question: "What is llms-full.txt and how does it differ from llms.txt?",
    answer:
      "llms.txt is a concise summary file that tells AI agents what your service does and where to find documentation. llms-full.txt is the extended version — it includes full documentation content, not just links. AgentBadge serves both: llms.txt for quick discovery and llms-full.txt for agents that need complete documentation in a single fetch. This two-tier approach mirrors robots.txt vs sitemap.xml — one for discovery, one for depth.",
  },
  {
    question: "How does AgentBadge handle support and contact?",
    answer:
      "AgentBadge provides support via email at support@agentbadge.xyz and a contact form at agentbadge.xyz/contact. For developer questions, the team is available on Telegram and Discord. Support covers scanner setup, passport issuance, marketplace integration, and MCP server development. The team also offers professional services for organizations that need custom agent infrastructure or GEO consulting.",
  },
  {
    question: "What are author bios in AgentBadge and why do they matter?",
    answer:
      "AgentBadge blog articles include structured author bios with credentials, expertise areas, and links to professional profiles. These bios serve as E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness) signals — both for search engines evaluating content quality and for AI agents assessing source reliability. Author bios help agents determine whether a source is authoritative before citing it, which is critical for agent readiness content.",
  },
  {
    question: "What is the AgentBadge agency model?",
    answer:
      "AgentBadge operates as an agency for the agentic web — providing three core services: agent readiness scanning (the scanner), on-chain identity (NFT passports), and a peer-to-peer marketplace (task escrow). The agency model means we don't just build tools — we help organizations become agent-ready through consulting, implementation, and verification. This is the business layer behind the open-source scanner.",
  },
  {
    question: "How does AgentBadge handle noindex and canonical tags?",
    answer:
      "AgentBadge uses noindex tags to prevent search engines from indexing low-value pages (pagination, filtered views, API responses) while keeping high-value content crawlable. Canonical tags are set on every page to consolidate duplicate content signals. This ensures search engines and AI agents find the canonical version of each page — important for both SEO and agent readiness, since agents need to cite the correct URL.",
  },
  {
    question: "What are short answers in AgentBadge's FAQ?",
    answer:
      "AgentBadge FAQ entries are designed with concise answers (2-4 sentences) that can be directly cited by AI agents and voice assistants. Each answer leads with the key concept, includes the AgentBadge brand name, and links to deeper content. This short-answer format ensures agents get complete information in a single fetch — no need to parse long articles for a quick answer. It's the FAQ equivalent of a featured snippet.",
  },
  // ── SLICE-105-3: Blog article Q&A (grounded in published articles) ──
  {
    question: "Why does AgentBadge say 'don't certify — measure'?",
    answer:
      "Certification gives a binary pass/fail label that becomes stale. Measurement gives a reproducible score based on observed evidence. AgentBadge follows the measurement philosophy: every check produces a status (VERIFIED, INFERRED, CONFLICT, MISSING) backed by captured evidence, so you always know what was actually tested. This is why AgentBadge scans are reproducible — same URL, same ruleset, same result. <a href=\"/blog/how-do-you-measure-agent-readiness\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: How Do You Measure Agent Readiness? →</a>",
  },
  {
    question: "What does AgentBadge's scanner actually do when it scans my API?",
    answer:
      "AgentBadge's scanner fetches your robots.txt, llms.txt, OpenAPI spec, well-known endpoints, and authentication flows — then runs {{RULE_COUNT}} checks across {{CATEGORY_COUNT}} categories. Each check produces evidence (HTTP responses, parsed schemas, discovered URLs) and a status. The scanner also performs active probing: sending real requests to verify your endpoints work as documented. The full report includes a score, grade, gap analysis, and fix recommendations. <a href=\"/blog/inside-an-agent-readiness-scanner\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: Inside an Agent Readiness Scanner →</a> <a href=\"/comparisons/agentbadge-vs-postman\" class=\"text-emerald-400 underline hover:text-emerald-300\">See comparison: AgentBadge vs Postman →</a>",
  },
  {
    question: "What problems does AgentBadge solve that OpenAPI alone doesn't?",
    answer:
      "OpenAPI covers 2-3 of the 8 context layers an AI agent needs: capabilities and inputs. AgentBadge covers all 8: discovery, capabilities, inputs, authentication, semantics, output, errors, and safety. OpenAPI tells agents what endpoints exist — AgentBadge checks whether agents can actually discover, authenticate, call, and trust those endpoints. The scanner also verifies that your OpenAPI spec matches your actual API behavior, catching drift between declared and observed. <a href=\"/blog/why-openapi-isnt-enough\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: Why Your OpenAPI Spec Isn't Enough →</a> <a href=\"/comparisons/agentbadge-vs-swagger\" class=\"text-emerald-400 underline hover:text-emerald-300\">See comparison: AgentBadge vs Swagger →</a>",
  },
  {
    question: "How does MCP complement REST APIs for AI agents?",
    answer:
      "REST APIs require agents to read documentation, understand HTTP semantics, and construct requests manually. MCP (Model Context Protocol) provides a structured tool interface — agents call named tools with typed parameters and get structured responses. AgentBadge checks for both: REST endpoints via OpenAPI and MCP tools via server descriptors. The future is hybrid: REST for human developers, MCP for AI agents, with OpenAPI bridging both. <a href=\"/blog/mcp-vs-api\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: MCP vs API →</a> <a href=\"/comparisons/agentbadge-vs-mcp\" class=\"text-emerald-400 underline hover:text-emerald-300\">See comparison: AgentBadge vs MCP →</a>",
  },
  {
    question: "How do x402 payments work with AI agents on Arc?",
    answer:
      "x402 uses HTTP 402 (Payment Required) to let AI agents pay for API calls autonomously. When an agent requests a paid resource, the server responds with 402 and payment requirements. The agent pays in USDC on Arc and retries with payment proof. AgentBadge uses x402 for passport issuance fees, and the scanner checks whether your API supports x402 for agent-to-service payments. This enables autonomous commerce: agents can discover, pay for, and use APIs without human intervention. <a href=\"/blog/x402-payments\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: x402 Payments →</a>",
  },
  {
    question: "What is the SEO → GEO → Agent Readiness progression?",
    answer:
      "SEO optimizes websites for search engine crawlers (Google). GEO optimizes content for generative AI responses (ChatGPT, Perplexity). Agent Readiness optimizes APIs for autonomous AI agents. Each layer targets a different consumer but shares principles: structured data, discoverability, and machine-readability. AgentBadge is the first platform to measure all three layers, with a focus on the third — Agent Readiness — which is the newest and least understood. <a href=\"/blog/from-seo-to-geo-to-agent-readiness\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: From SEO to GEO to Agent Readiness →</a>",
  },
  {
    question: "How does API discovery work for AI agents in the agentic web?",
    answer:
      "AI agents discover APIs through machine-readable layers: llms.txt for capability summaries, agents.txt for auth and contact info, MCP server descriptors for tool-level discovery, and /.well-known/ endpoints for configuration. Traditional SEO (HTML meta tags, sitemaps) helps but isn't sufficient — agents need structured, parseable discovery layers. AgentBadge checks all these layers and reports which ones your API provides. <a href=\"/blog/web-becoming-agentic-api-discovery\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: The Web Is Becoming Agentic →</a>",
  },
  {
    question: "Does my API need SEO if it has Agent Readiness?",
    answer:
      "Yes — SEO and Agent Readiness serve different consumers. SEO serves search engines and human users who find your API via Google. Agent Readiness serves AI agents that discover and call your API programmatically. A good SEO score means humans can find you; a good Agent Readiness score means agents can use you. AgentBadge measures both, because the agentic web requires both layers — human discovery (SEO) and agent execution (Agent Readiness). <a href=\"/blog/api-has-seo-agent-readiness\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: Your API Has SEO. Does It Have Agent Readiness? →</a>",
  },
  {
    question: "What are the 8 layers of context an AI agent needs?",
    answer:
      "AgentBadge identifies 8 context layers: discovery (can agents find you?), capabilities (what can your API do?), inputs (what parameters are needed?), authentication (how does an agent log in?), semantics (what do responses mean?), output (what format are responses in?), errors (how are failures communicated?), and safety (are there rate limits and guardrails?). OpenAPI covers 2-3 layers; the rest need llms.txt, MCP, examples, and structured metadata. <a href=\"/blog/what-ai-agent-needs-to-understand-api\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: What Does an AI Agent Need to Understand an API? →</a>",
  },
  {
    question: "What makes AgentBadge's scanner different from other API scanners?",
    answer:
      "AgentBadge's scanner is evidence-based, reproducible, and agent-focused. Unlike LLM-based analyzers that give subjective opinions, AgentBadge runs deterministic checks with captured evidence — every VERIFIED status has HTTP responses or parsed schemas behind it. The scanner is also reproducible: same URL + same ruleset version = same result. And it checks for agent-specific features (llms.txt, MCP, x402, agents.txt) that traditional API scanners ignore. <a href=\"/blog/inside-an-agent-readiness-scanner\" class=\"text-emerald-400 underline hover:text-emerald-300\">Read: Inside an Agent Readiness Scanner →</a>",
  },
  // ── SLICE-118-1: Gap-filling entries ──
  {
    question: "How do I get started with AgentBadge?",
    answer:
      "Go to <a href=\"/\" class=\"text-emerald-400 underline hover:text-emerald-300\">agentbadge.xyz</a>, enter your API base URL in the scanner, and click Scan. You'll get a readiness score, evidence-backed findings, and fix recommendations in under a minute. No signup required for the free scan.",
  },
  {
    question: "Do I need to sign up to scan my API?",
    answer:
      "No. The scanner is free and requires no signup. Enter your API base URL and click Scan. You only need an account for continuous monitoring, passports, and marketplace features.",
  },
  {
    question: "What programming languages are supported?",
    answer:
      "AgentBadge scans any HTTP API regardless of backend language. The scanner checks your API's responses, headers, and documentation — not your source code. Whether your API is built in Node.js, Python, Go, Rust, Java, or anything else, the scanner works the same way.",
  },
];
