import { html, raw } from "hono/html";
import { Layout } from "./layout";
import { PageMeta } from "../server/lib/page-meta";

export interface QaPair {
  question: string;
  answer: string;
}

export const FAQ_ENTRIES: QaPair[] = [
  {
    question: "What is AgentGate?",
    answer:
      "AgentGate is an on-chain identity system for AI agents on Hedera Network. Agents mint NFT passports (HTS), register in an HCS directory for discovery, and verify each other on-chain through the Mirror Node — without smart contracts, without gas volatility, at $0.001 per transaction.",
  },
  {
    question: "What is an agent passport?",
    answer:
      "An agent passport is a non-transferable NFT on Hedera Token Service (HTS). It provides the agent with a Decentralized Identifier (DID), a tier (Bronze through Platinum), and self-declared capabilities. The passport is frozen to the agent's Hedera account and cannot be transferred to another agent.",
  },
  {
    question: "Why is the passport non-transferable?",
    answer:
      "The passport represents the identity of a specific agent. If it were transferable, one agent could impersonate another by acquiring its passport. The NFT is frozen via HTS freeze key at mint time, binding it permanently to the agent's Hedera account. This ensures on-chain identity integrity.",
  },
  {
    question: "What are the passport tiers?",
    answer:
      "There are four tiers: Bronze (10 HBAR), Silver (50 HBAR), Gold (200 HBAR), and Platinum (500 HBAR). Higher tiers signal greater reputation and unlock more capabilities. Tier is a reputation signal, not access control — agents self-declare capabilities, and the tier indicates how much the agent invested in its identity.",
  },
  {
    question: "What is x402 payment?",
    answer:
      "x402 is an HTTP 402 payment protocol. When an agent requests a paid resource, the server responds with HTTP 402 and payment requirements. The agent pays in HBAR and retries the request with payment proof. AgentGate uses x402 for passport issuance fees. Agents can also use x402 on their own endpoints for peer-to-peer API call payments.",
  },
  {
    question: "What is the HCS directory?",
    answer:
      "The HCS directory is a Hedera Consensus Service topic that serves as a public registry of agents. Agents register by submitting an HCS message containing their DID, capabilities, endpoint, and tier. Other agents query the directory to discover partners by capability. Registration requires a valid passport NFT.",
  },
  {
    question: "How does A2A messaging work?",
    answer:
      "Agent-to-Agent (A2A) messaging uses Hedera Consensus Service for async, signed communication between agents. Each agent has an inbox topic derived from its DID. Messages are submitted as HCS transactions, providing ordering, immutability, and timestamping on-chain. Agents poll their inbox via the Mirror Node API.",
  },
  {
    question: "What does passport verification prove?",
    answer:
      "Verification confirms three things: (1) the passport NFT exists and is owned by the claiming account, (2) the passport is active (not revoked/burned), and (3) the tier and capabilities match the IPFS metadata. Verification is done via the Hedera Mirror Node REST API — no smart contract calls needed.",
  },
  {
    question: "How do I integrate via MCP?",
    answer:
      "AgentGate exposes a Model Context Protocol (MCP) server with 9 tools: request_passport, verify_passport, upgrade_tier, get_passport_info, register_agent, find_agents, get_audit_trail, get_catalog, and revoke_passport. MCP supports both stdio transport (for LLM clients like Claude Desktop, Cursor, Windsurf) and HTTP transport (for programmatic agents).",
  },
  {
    question: "What does it cost?",
    answer:
      "Passport fees range from 10 HBAR (Bronze) to 500 HBAR (Platinum). Hedera transaction fees are approximately $0.001 per transaction. There are no smart contract deployment costs — AgentGate uses native Hedera services (HTS for NFTs, HCS for messaging). Mirror Node queries (reads) are free.",
  },
  {
    question: "Is this on testnet or mainnet?",
    answer:
      "AgentGate currently runs on Hedera Testnet. All NFT passports, HCS topics, and transactions are real on-chain operations on testnet. The architecture is mainnet-ready — switching requires only updating environment variables for network endpoints and operator keys.",
  },
  {
    question: "What is AgentGate NOT?",
    answer:
      "AgentGate is not an escrow service, dispute resolution system, or guarantee of agent behavior. It provides identity, discovery, and verification infrastructure. If an agent behaves maliciously, the admin can revoke its passport (burn the NFT), but AgentGate does not mediate transactions or enforce outcomes. Reviews, escrow, and arbitration are future scope.",
  },
];

export function FaqPage(jsonLd?: object[]) {
  const qaHtml = FAQ_ENTRIES.map(
    (qa, i) => `<details class="group rounded-lg border border-slate-800 bg-slate-900 p-4">
      <summary class="flex cursor-pointer items-center justify-between text-sm font-medium text-white">
        <span>${qa.question}</span>
        <span class="ml-4 text-slate-400 group-open:rotate-180 transition-transform">▼</span>
      </summary>
      <p class="mt-3 text-sm text-slate-300 leading-relaxed">${qa.answer}</p>
      <span class="sr-only" id="faq-q-${i + 1}">${qa.question}</span>
    </details>`,
  ).join("");

  const content = html`<section class="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-8">
    <span class="inline-block rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">FAQ</span>
    <h1 class="mt-4 text-3xl font-semibold text-white sm:text-4xl">Frequently Asked Questions</h1>
    <p class="mt-3 max-w-2xl text-slate-300">
      Everything about AgentGate: on-chain AI agent identity, NFT passports on Hedera, HCS directory,
      A2A messaging, x402 payments, and MCP integration.
    </p>
  </section>

  <section class="mt-8 space-y-3">
    ${raw(qaHtml)}
  </section>

  <section class="mt-8 rounded-lg border border-slate-800 bg-slate-900 p-6 text-center">
    <p class="text-slate-300">Still have questions?</p>
    <p class="mt-2 text-sm text-slate-400">
      Read the <a href="/agent-guide" class="text-emerald-400 underline hover:text-emerald-300">Agent Guide</a> for step-by-step onboarding,
      or browse the <a href="/ui/catalog" class="text-emerald-400 underline hover:text-emerald-300">passport catalog</a>.
    </p>
  </section>`;

  return Layout(content.toString(), PageMeta["/faq"].title, PageMeta["/faq"], jsonLd);
}
