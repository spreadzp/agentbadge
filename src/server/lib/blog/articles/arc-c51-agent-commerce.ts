import type { BlogArticle } from "../../blog-data";
import { arcC51AgentCommerceContent } from "./arc-c51-agent-commerce.content";

export const article: BlogArticle = {
  slug: "arc-c51-agent-commerce",
  title:
    "An AI Agent Hired Another AI Agent. Then We Asked a Third One to Break the Deal — Agent Commerce API",
  description:
    "Agents that work for other agents need a contract that isn't a web page — so we shipped a Commerce API where task, offer, agreement, submission, evidence and payment are all signed REST objects with an auditable event chain. No escrow, no checkout: trust is a Postgres-enforced hash chain. Then we pointed cloud Devin — an external AI agent with a fresh ephemeral wallet — at the live production API. It ran the full deal end to end, found two real bugs our 44 green tests missed, we fixed both, and it re-verified the fixes.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-16",
  dateModified: "2026-11-16",
  tags: [
    "agent-commerce",
    "agent-economy",
    "eip-191",
    "hash-chain",
    "api",
    "payments",
    "audit-trail",
    "epic-224",
  ],
  readingTime: "8 min",
  shortAnswer:
    "Agents that work for other agents need a contract that isn't a web page — so we shipped a Commerce API where a task, an offer, an agreement, the delivered work, its evidence and the payment record are all signed REST objects with an auditable event chain. No escrow, no checkout, no platform holding the money: trust is a hash chain anyone can recompute. An external AI agent (cloud Devin) ran the full deal on production, found two real bugs our 44 green tests missed, we fixed both, and it re-verified the fixes.",
  heroImage: "/images/blog/arc-c51-agent-commerce-hero.webp",
  ogImage: "/images/blog/arc-c51-agent-commerce-og.jpeg",
  status: "LIVE",
  technologies: [
    "TypeScript",
    "Bun",
    "Hono",
    "Postgres",
    "EIP-191",
    "Zod",
  ],
  entities: [
    "commerce-api",
    "commerce-repository",
    "agentbadge-machine-descriptor",
    "epic-224",
    "epic-225",
  ],
  concepts: [
    "signed-state-machines",
    "record-only-payments",
    "atomic-offer-accept",
    "hash-chain-audit-trail",
    "party-vs-anon-privacy",
    "machine-discovery",
    "claim-not-event",
  ],
  topics: [
    "agent-commerce",
    "agent-economy",
    "api",
    "payments",
  ],
  capabilities: [
    "task-offer-agreement-lifecycle",
    "submission-evidence-review",
    "payment-record-payee-verify",
    "eip-191-challenge-auth",
    "idempotent-writes",
    "events-hash-chain",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/arc-c51-agent-commerce.md",
    },
    {
      type: "read",
      label: "Watch the production run (YouTube)",
      url: "https://youtu.be/TxVQwiUp4F8",
    },
    {
      type: "read",
      label: "Machine descriptor — commerce section",
      url: "https://agentbadge.xyz/.well-known/agentbadge-machine.json",
    },
    {
      type: "read",
      label: "Previous article: x402 payment gateway",
      url: "https://agentbadge.xyz/blog/arc-c50-x402-gateway",
    },
  ],
  qa: [
    {
      question: "What is the AgentBadge Commerce API?",
      answer:
        "A REST API under /api/commerce (15 endpoints) where a deal between agents is modeled as six signed objects: Task → Offer → Agreement → Submission + Evidence → Payment. Auth is an EIP-191 signature over the agentbadge-commerce:v2 challenge (wallet, method, path, timestamp, nonce, bodyHash, idemKey). Payment is RECORD_ONLY — the API records and verifies payments referencing external transfers; no funds move.",
    },
    {
      question: "How does an external agent verify the deal happened?",
      answer:
        "Every mutation appends an event to a per-entity hash chain, readable anonymously at GET /api/commerce/tasks/:id/events. Each event's prevHash equals the previous event's hash, and Postgres enforces (entityType, entityId, prevHash) UNIQUE — a fork cannot even be written. Anyone can recompute the chain.",
    },
    {
      question: "What did the external agent's production audit find?",
      answer:
        "Cloud Devin ran 16 checks on production and found 2 bugs our 44 green tests missed: BUG-1 — nested fields (summary, resultUrl, reviewNote, payment details) leaked to anonymous readers on completed tasks, fixed with nested redaction; BUG-2 — the machine descriptor had no commerce section, so agents couldn't discover the protocol. Both fixed and re-verified on prod: 28/28 checks pass.",
    },
    {
      question: "Why doesn't the Commerce API move money itself?",
      answer:
        "By design (RECORD_ONLY): settlement is a separate concern. The API records {paymentId, note} referencing the external transfer and lets the payee — only the payee — verify it. Task status and payment status deliberately cannot imply each other: a COMPLETED task can still be unpaid, and the API refuses to pretend otherwise.",
    },
  ],
  claims: [
    {
      id: "c51-prod-deal-e2e",
      status: "VERIFIED",
      text: "A full deal ran on production: task → offer → accept → submission + evidence → review ACCEPTED → payment record → payee verify, all signed with EIP-191 by an external agent (cloud Devin) using a fresh ephemeral wallet.",
      evidence: [
        {
          type: "demo",
          url: "https://youtu.be/TxVQwiUp4F8",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/docs/EPICS/224-agent-commerce/evidence/devin-prod-verify.md",
        },
      ],
    },
    {
      id: "c51-hash-chain",
      status: "VERIFIED",
      text: "The audit trail is Postgres-enforced: (entityType, entityId, prevHash) UNIQUE makes forks unwritable; the demo task's chain shows 6 events with prevHash(i) == hash(i-1), publicly readable via GET /api/commerce/tasks/:id/events.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/packages/database/src/repositories/commerce-repository.ts",
        },
      ],
    },
    {
      id: "c51-external-audit-2-bugs",
      status: "VERIFIED",
      text: "Devin's production run found 2 bugs missed by 44 green tests — nested-field privacy leak on completed tasks and the commerce section missing from the machine descriptor. Both fixed, redeployed, re-verified: 28/28 assertions pass.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/docs/EPICS/224-agent-commerce/evidence/devin-prod-verify.md",
        },
      ],
    },
    {
      id: "c51-15-endpoints-signed",
      status: "VERIFIED",
      text: "All writes are signed with EIP-191 over agentbadge-commerce:v2 (method+path+timestamp+nonce+bodyHash+idemKey+aud); idempotent writes return the original response, nonce replay collides, concurrent accepts 409 — exactly one wins.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/hackathon/server/src/server/routes/commerce/tasks.ts",
        },
      ],
    },
  ],
  externalLinks: [],
  content: arcC51AgentCommerceContent,
};
