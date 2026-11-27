import type { BlogArticle } from "../../blog-data";
import { arcC66AgentProtocolContent } from "./arc-c66-agent-protocol.content";

export const article: BlogArticle = {
  slug: "arc-c66-agent-protocol",
  title:
    "One Endpoint, Eight Tools: A Keyless Agent Protocol With Signed Webhooks, Verified on Production",
  description:
    "agentbadge.xyz now answers agents directly: one well-known manifest and one JSON-RPC endpoint expose a whitelist of eight live tools - keyless reads, optional agb_ keyed lane, idempotent submit with per-request whsec_ secrets, and terminal-state callbacks signed t,v1 over the raw body. The manifest is honest to a fault (webhooks.status: degraded), and an external audit went BLOCK on two criticals - all fixed and re-verified, receipts inside.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-27",
  dateModified: "2026-11-27",
  tags: [
    "agent-protocol",
    "mcp",
    "json-rpc",
    "webhooks",
    "request-inbox",
    "hmac",
    "ssrf",
    "epic-233",
  ],
  readingTime: "10 min",
  shortAnswer:
    "agentbadge.xyz exposes an agent-interaction protocol: GET /.well-known/agent-interaction.json is a generated capability manifest, and POST /mcp/agent-interaction answers plain JSON-RPC (no SSE, no batch) with a whitelist of eight tools - discover, ask, get_request_status, create_task_request, search_knowledge, submit_feedback, request_review, report_problem - all status:live and all riding the same code paths and rate buckets as the REST endpoints they mirror. Reads are keyless; an optional Bearer agb_ lifts the lane from anon 60/min to keyed 120/min. create_task_request validates callback_url before persisting (HTTPS-only, every resolved IP must be public) and returns a per-request webhook_secret once; on terminal state the outbox delivers a POST signed X-AgentBadge-Signature: t,v1 where v1 = HMAC(secret, t.body) - verified byte-for-byte on a live delivery. External audit came back BLOCK (2 Criticals - first-safe-IP DNS pin, DNS-rebinding delivery window - plus 4 Highs); every Critical and High is fixed and re-verified, verdict APPROVE WITH NITS, and the manifest honestly prints webhooks.status degraded because the outbox is still in-process.",
  heroImage: "/images/blog/arc-c66-agent-protocol-hero.webp",
  ogImage: "/images/blog/arc-c66-agent-protocol-og.jpeg",
  status: "LIVE",
  technologies: [
    "TypeScript",
    "Bun",
    "Hono",
    "Postgres",
    "Prisma",
    "JSON-RPC",
    "MCP",
    "WebMCP",
  ],
  entities: [
    "agent-request",
    "webhook-outbox",
    "agent-interaction-registry",
    "epic-233",
  ],
  concepts: [
    "keyless-agent-protocol",
    "whitelist-roster",
    "parity-by-construction",
    "id-as-capability",
    "idempotent-submit",
    "per-request-webhook-secret",
    "honest-manifest",
    "dns-pinned-delivery",
    "shared-rate-buckets",
  ],
  topics: [
    "agent-protocol",
    "mcp",
    "json-rpc",
    "webhooks",
    "security",
    "rate-limiting",
    "api",
  ],
  capabilities: [
    "agent-interaction-manifest",
    "json-rpc-tools-list-call",
    "keyless-request-submit",
    "idempotent-replay",
    "signed-webhook-delivery",
    "ssrf-guarded-callback",
    "typed-not-found-polling",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/arc-c66-agent-protocol.md",
    },
    {
      type: "read",
      label: "Live capability manifest (8 tools)",
      url: "https://agentbadge.xyz/.well-known/agent-interaction.json",
    },
    {
      type: "read",
      label: "JSON-RPC endpoint - unauthenticated probe: tools/list",
      url: "https://agentbadge.xyz/mcp/agent-interaction",
    },
    {
      type: "read",
      label: "WebMCP carrier page (keyless shelf)",
      url: "https://agentbadge.xyz/for-agents",
    },
    {
      type: "read",
      label: "Previous article: operator accountability",
      url: "https://agentbadge.xyz/blog/arc-c64-operator-accountability",
    },
  ],
  qa: [
    {
      question: "What is the agent-interaction protocol on agentbadge.xyz?",
      answer:
        "A keyless protocol surface: GET /.well-known/agent-interaction.json returns a generated capability manifest and POST /mcp/agent-interaction answers plain JSON-RPC (no SSE, no sessions, no batch) with a whitelist of eight tools - discover, ask, get_request_status, create_task_request, search_knowledge, submit_feedback, request_review, report_problem. Manifest and tools/list come from one registry so they cannot drift; every tool is status:live and mirrors an existing REST backend through shared helpers and shared rate buckets.",
    },
    {
      question: "Do agents need an API key to use the endpoint?",
      answer:
        "No - reads are fully keyless on the anon lane (60 req/min per IP). An optional Bearer agb_ key lifts the caller into the keyed lane (120 req/min per verified agentId). Write tools accept the same optional key; the domain submit lane (~1 request per 2h per fingerprint HMAC(ip|UA|headers-digest)) applies regardless, with idempotent replays free. agb_ credentials never appear in the page-context WebMCP shelf.",
    },
    {
      question: "How do signed webhooks work for agent requests?",
      answer:
        "create_task_request accepts a callback_url validated before persist - HTTPS only, DNS resolved, every resolved IP must be public (SSRF guard). On a terminal transition the outbox delivers a POST with X-AgentBadge-Signature: t=<unix>,v1=<hex>, where v1 = HMAC-SHA256(secret, t + '.' + raw-body) inside a 300s tolerance. The secret is whsec_<base64url-43>, derived per request as HMAC(master, request:<id>) and returned exactly once at submit - each receiver verifies their own letters and cannot forge another request's signature.",
    },
    {
      question: "What did the external audit find on the agent protocol surface?",
      answer:
        "BLOCK on round one: 2 Criticals (the DNS pin returned the first safe IP instead of requiring all resolved IPs to be public; delivery re-resolved the hostname, opening a DNS-rebinding window - now fetchPinned per hop) plus 4 Highs (shared HMAC key -> per-request whsec_; IPv6 private-prefix gaps; abuse guard failing open; manifest claiming unproven durability - now honestly degraded). Rounds two and three re-verified everything: APPROVE WITH NITS, audit gate passed, with a 42-test hardening suite.",
    },
    {
      question: "Where is the protocol deliberately less than perfect?",
      answer:
        "Three named seams: the webhook outbox is in-process memory (queued rows die on restart; the durable Postgres adapter is staged in @agentbadge/database 0.6.61, server wiring pending - hence webhooks.status: degraded in the manifest), rate buckets are per-machine in-memory (a shared Redis lane is the upgrade path), and the hard submit lane is intentionally harsh at ~1 request per 2h per fingerprint.",
    },
  ],
  claims: [
    {
      id: "c66-eight-tools-live",
      status: "VERIFIED",
      text: "One JSON-RPC endpoint exposes a whitelist of eight tools - all status:live, generated from one registry so the manifest and tools/list cannot drift; anything outside the roster gets a typed -32601 that lists the available names.",
      evidence: [
        {
          type: "demo",
          url: "https://agentbadge.xyz/.well-known/agent-interaction.json",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/agent-interaction/registry.ts",
        },
      ],
    },
    {
      id: "c66-keyless-reads-keyed-lane",
      status: "VERIFIED",
      text: "Read tools are keyless (anon 60/min per IP); an optional Bearer agb_ lifts the lane to keyed 120/min. The domain submit lane is ~1 request per 2h per fingerprint with idempotent replay free - verified on prod by submitting from a second egress IP (fresh lane, instant accept) vs the same fingerprint (typed RATE_LIMITED with retry_after_seconds).",
      evidence: [
        {
          type: "demo",
          url: "https://agentbadge.xyz/mcp/agent-interaction",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/request-inbox/submit-lanes.ts",
        },
      ],
    },
    {
      id: "c66-signed-webhooks-per-request-secret",
      status: "VERIFIED",
      text: "Terminal transitions enqueue a webhook POST signed X-AgentBadge-Signature: t,v1 over the raw body; the per-request whsec_ secret (HMAC-derived from request id) is returned once at submit. Verified byte-for-byte on a live delivery: computed v1 matched the header; a forged body produced a different hash.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/webhooks/sign.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/scripts/verify-epic-233.sh",
        },
      ],
    },
    {
      id: "c66-audit-block-to-approve",
      status: "VERIFIED",
      text: "External audit round one: BLOCK - 2 Criticals (first-safe-IP DNS pin, DNS-rebinding delivery window), 4 Highs, 17 Mediums. All Criticals and Highs fixed and re-verified; round three verdict APPROVE WITH NITS, audit gate passed, 42-test hardening suite.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/tests/agent-interaction/audit-hardening-233-10.test.ts",
        },
      ],
    },
    {
      id: "c66-honest-degraded-manifest",
      status: "VERIFIED",
      text: "The manifest prints webhooks.status: degraded with a durability note - the outbox is in-process until the staged Postgres adapter (@agentbadge/database 0.6.61) is wired in; honesty about the floor instead of an unproven durable claim.",
      evidence: [
        {
          type: "demo",
          url: "https://agentbadge.xyz/.well-known/agent-interaction.json",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/agent-interaction/manifest.ts",
        },
      ],
    },
  ],
  externalLinks: [],
  content: arcC66AgentProtocolContent,
};
