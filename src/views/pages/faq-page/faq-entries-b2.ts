// EPIC-140 (SLICE-140-20): FAQ entries faq_entries_b2 (split under the 20KB token-limit cap).
import type { QaPair } from "./data";

export const FAQ_ENTRIES_B2: QaPair[] = [
  {
    question: "How does AgentBadge score?",
    answer:
      "AgentBadge scores across four pillars: Discovery (20%, can agents find you?), Understandability (25%, can agents understand your API?), Executability (30%, can agents successfully call your API?), and Verifiability (25%, can agents trust the results?). Each pillar aggregates multiple categories of checks. The overall score is a weighted average. <a href=\"/how-ai-agents-use-apis\" class=\"text-emerald-400 underline hover:text-emerald-300\">Learn more →</a>",
  },
  {
    question: "What does AgentBadge measure?",
    answer:
      "AgentBadge measures {{RULE_COUNT}} agent readiness rules across {{CATEGORY_COUNT}} categories — discovery, documentation, authentication, executability, and verifiability. Each check produces evidence (HTTP responses, parsed schemas, headers), not opinions. The scanner is deterministic and reproducible: same URL + same ruleset version = same result. <a href=\"/what-is-agent-readiness\" class=\"text-emerald-400 underline hover:text-emerald-300\">Learn more →</a>",
  },
  {
    question: "Can I self-host the scanner?",
    answer:
      "Yes. The scanner is open source (MIT) and can be self-hosted. This is useful for internal APIs not accessible from the public internet, or for teams that want to run scans in CI/CD pipelines. See the <a href=\"https://github.com/agentbadge/agent-readiness-scanner\" class=\"text-emerald-400 underline hover:text-emerald-300\">GitHub repo</a> for setup instructions.",
  },
  {
    question: "Is OpenAPI enough?",
    answer:
      "OpenAPI is necessary but not sufficient. It covers syntax (endpoints, parameters, schemas) but not semantics (what responses mean), execution (auth flows, idempotency), or safety (rate limits, retries). Agents need all 8 context layers. AgentBadge checks for OpenAPI plus llms.txt, MCP, examples, structured metadata, and more. <a href=\"/openapi-vs-agent-readiness\" class=\"text-emerald-400 underline hover:text-emerald-300\">Learn more →</a>",
  },
  {
    question: "How long does a scan take?",
    answer:
      "Most scans complete in 10–30 seconds depending on API size, number of endpoints, and response times. The scanner fetches your OpenAPI spec, robots.txt, llms.txt, well-known files, and probes a sample of endpoints. You see results in real-time as checks complete.",
  },
  {
    question: "Can I scan multiple APIs?",
    answer:
      "Yes. Each scan is independent. You can scan different base URLs, different environments (staging, production), or different API versions. For continuous monitoring of multiple APIs, contact us about enterprise plans.",
  },
  {
    question: "What happens after I scan?",
    answer:
      "You get a detailed report with your overall readiness score, pillar scores, per-rule findings (VERIFIED, MISSING, ERROR), evidence for each check, and fix recommendations. You can download the report as JSON or share the public scan URL with your team.",
  },
  {
    question: "Is AgentBadge open source?",
    answer:
      "The scanner is MIT licensed and available on <a href=\"https://github.com/agentbadge/agent-readiness-scanner\" class=\"text-emerald-400 underline hover:text-emerald-300\">GitHub</a>. The platform (passports, marketplace, dashboard) is proprietary. We believe the scanning tool should be open and auditable — trust comes from transparency.",
  },
  {
    question: "What is KeeperHub integration?",
    answer:
      "AgentBadge integrates with <a href=\"https://app.keeperhub.com\" class=\"text-emerald-400 underline hover:text-emerald-300\">KeeperHub</a> — a workflow automation platform that executes onchain transactions via MCP. When you scan a site with <code>confirm: true</code>, AgentBadge triggers a KeeperHub workflow that records the scan result on Base Sepolia via the TrustRegistry smart contract, then mints a TrustBadge (soulbound NFT) and AgentPassport NFT for the verified site.",
  },
  {
    question: "What chains does AgentBadge use for on-chain recording?",
    answer:
      "AgentBadge operates on two chains: <strong>Arc (eip155:5042)</strong> — agent passports (ERC-721), agent directory, marketplace escrows, USDC payments. <strong>Base Sepolia (chain 84532)</strong> — TrustRegistry (scan recording), TrustBadge (soulbound badge), AgentPassport NFT. (legacy: Hedera Testnet — HTS passports, HCS directory — readable as historical records.)",
  },
  {
    question: "What is the TrustRegistry contract?",
    answer:
      "TrustRegistry is a smart contract on Base Sepolia (<code>0x2e0fb96976a461acfeb7fd4605d6a20311a5da91</code>) that records scan results on-chain. Each scan stores the site URL, score (0-100), rules passed/total, and a timestamp. Only addresses with RECORDER_ROLE can call <code>recordScan()</code>.",
  },
  {
    question: "What is TrustBadge?",
    answer:
      "TrustBadge is a soulbound (non-transferable) NFT on Base Sepolia (<code>0x6e408672e56001dc24a5db68107f9abf900f87e3</code>) minted for sites that pass the readiness scan. It uses a <code>_update</code> hook to prevent transfers — once minted, it stays with the recipient forever. See <a href=\"/agent-guide/concepts/trust-badge\" class=\"text-emerald-400 underline hover:text-emerald-300\">TrustBadge concept →</a>",
  },
  {
    question: "What is the AgentPassport NFT on Base?",
    answer:
      "AgentPassport (<code>0x69043c847e9ee79b7128ec6d280f5f25fc76aba9</code>) is an ERC-721 NFT on Base Sepolia minted via KeeperHub workflow. It represents the agent's on-chain identity on Base, complementing the Arc passport (and the legacy Hedera HTS passport).",
  },
  {
    question: "How do I trigger an on-chain scan recording?",
    answer:
      "Use the <code>confirm: true</code> parameter when calling the scan endpoint, or use the <code>record_scan</code> MCP tool. The server triggers the KeeperHub <code>record-scan</code> workflow, which executes the on-chain transaction and returns the tx hash. Polling takes up to 5 minutes.",
  },
  {
    question: "What is the audit trail SSE stream?",
    answer:
      "AgentBadge provides a Server-Sent Events stream at <code>/audit/stream</code> that delivers real-time onchain events — scan recordings, badge mints, and passport mints. Any client can subscribe to receive push notifications when new events are recorded.",
  },
  {
    question: "What MCP tools are available for KeeperHub?",
    answer:
      "Four MCP tools: <code>record_scan</code> — Trigger on-chain scan recording via KeeperHub. <code>mint_badge</code> — Mint TrustBadge + AgentPassport for a verified site. <code>workflow_status</code> — Check KeeperHub workflow execution status. <code>audit_events</code> — Read on-chain audit events.",
  },
  {
    question: "What is x402 premium scan?",
    answer:
      "Premium scans use the <a href=\"https://x402.org\" class=\"text-emerald-400 underline hover:text-emerald-300\">x402 protocol</a> for payment-gated access. Agents pay with USDC on Base Sepolia via Coinbase Agentic Wallet. The free scan remains available — premium adds on-chain recording, audit trail, and badge minting.",
  },
  {
    question: "Is the @agentbadge/keeperhub package available?",
    answer:
      "Yes — <code>@agentbadge/keeperhub</code> is published on npm. It provides a TypeScript SDK for the KeeperHub MCP API, workflow templates, and contract ABIs.",
  },
  {
    question: "What is Attestcoin cross-chain verification?",
    answer:
      "Attestcoin is a cross-chain verified task marketplace built on the <a href=\"https://creditcoin.org\" class=\"text-emerald-400 underline hover:text-emerald-300\">Creditcoin</a> protocol. AgentBadge integrates Attestcoin to verify AI agent tasks across Ethereum Sepolia and Creditcoin CC3 Testnet. Tasks posted on Ethereum are verified on Creditcoin using on-chain proofs. See <a href=\"/agent-guide/concepts/cross-chain-verification\" class=\"text-emerald-400 underline hover:text-emerald-300\">Cross-Chain Verification concept →</a>",
  },
  {
    question: "How does the Attestcoin task lifecycle work?",
    answer:
      "1. Task posted on Ethereum Sepolia (TaskEscrow contract). 2. Worker A bridges task hash to Creditcoin. 3. Task verified on Creditcoin (TaskMarketplaceASC). 4. AI agent evaluates and claims task. 5. Agent processes and submits result (stored on IPFS). 6. Worker B bridges result hash back to Ethereum. 7. Task completed with on-chain proof on both chains.",
  },
  {
    question: "What chains does Attestcoin use?",
    answer:
      "Attestcoin operates across two chains: <strong>Ethereum Sepolia (chain 11155111)</strong> — TaskEscrow contract for task posting and completion. <strong>Creditcoin CC3 Testnet</strong> — TaskMarketplaceASC and TaskState contracts for task verification and lifecycle.",
  },
  {
    question: "What MCP tools are available for Attestcoin?",
    answer:
      "Three MCP tools: <code>verify_cross_chain_task</code> — Verify a cross-chain task from Ethereum Sepolia on Creditcoin. <code>list_verified_tasks</code> — List all cross-chain tasks verified on Creditcoin. <code>get_task_status</code> — Get detailed status of a cross-chain task.",
  },
  {
    question: "How does the AI agent interact with Attestcoin tasks?",
    answer:
      "The AI agent monitors <code>TaskVerified</code> events, evaluates tasks, claims them, processes results (stored in IPFS), and completes the lifecycle on Creditcoin. The agent can interact via MCP tools or REST API (<code>/api/attestcoin/tasks</code>, <code>/api/attestcoin/verify</code>).",
  },
  {
    question: "Is there a live demo for Attestcoin?",
    answer:
      "Yes — visit <a href=\"/hackathon/attestcoin\" class=\"text-emerald-400 underline hover:text-emerald-300\">/hackathon/attestcoin</a> for a live demo page showing real-time task list, architecture diagram, and block explorer links (Etherscan + Blockscout).",
  },
  {
    question: "Is the @agentbadge/attestcoin package available?",
    answer:
      "Yes — <code>@agentbadge/attestcoin</code> is published on npm. It contains contract ABIs, TypeScript types, SDK wrapper for <code>@gluwa/usc-sdk</code>, Worker A/B code, and AI agent logic.",
  },
];
