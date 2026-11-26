import type { BlogArticle } from "../../blog-data";
import { arcC62AgentSurfaceContent } from "./arc-c62-agent-surface.content";

export const article: BlogArticle = {
  slug: "arc-c62-agent-surface",
  title:
    "The Agent-Surface Bugs OWASP Never Named - Six Rounds of Multi-Model Adversarial Audit",
  description:
    "We pointed three external AI reviewers (DeepSeek, Gemini, Grok) at our own production surface for six adversarial rounds before selling a scanner: 17 real bugs, all fixed and re-verified on production, score 71.15 (C) → 94.7 (A). The taxonomy of eight classes that only exist when the reader of your site is a machine: anonymous execute surface, SSRF encodings, self-published attack map, dead trust chain, advertised-404s, wrong-door rate limits, wrong error semantics, scanner lying both ways - with the curl commands to check each fix.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-26",
  dateModified: "2026-11-26",
  tags: [
    "agent-surface",
    "security-audit",
    "ssrf",
    "mcp",
    "agent-readiness",
    "dogfooding",
    "arc",
  ],
  readingTime: "9 min",
  shortAnswer:
    "We sell a scanner that measures how ready a site is for AI agents - so before selling it we pointed three external AI reviewers at our own production surface for six adversarial rounds. They found 17 real bugs, all fixed and re-verified on production. None was exotic. All were in classes that have no OWASP category yet, because they only exist when the reader of your site is a machine. This is that taxonomy - with the curl commands to check each fix.",
  heroImage: "/images/blog/arc-c62-agent-surface-hero.webp",
  ogImage: "/images/blog/arc-c62-agent-surface-og.jpeg",
  status: "LIVE",
  technologies: ["TypeScript", "Bun", "Hono", "MCP", "JSON-RPC", "EdDSA"],
  entities: [
    "agent-surface-taxonomy",
    "mcp-tool-exposure",
    "ssrf-deny-list",
    "did-web",
    "llms-txt",
    "agent-card",
    "epic-259",
    "epic-262",
  ],
  concepts: [
    "anonymous-execute-surface",
    "ssrf-ip-encodings",
    "self-published-attack-map",
    "dead-trust-chain",
    "advertised-404s",
    "wrong-door-rate-limit",
    "honest-error-semantics",
    "false-gap-vs-false-verified",
    "provenance-tagged-facts",
    "external-adversarial-review",
  ],
  topics: [
    "agent-readiness",
    "security",
    "ssrf",
    "mcp-security",
    "audit-methodology",
    "arc",
  ],
  capabilities: [
    "mcp-tool-exposure-gating",
    "ssrf-encoding-normalization",
    "deny-by-default-tool-classification",
    "detached-jws-descriptor-signing",
    "provenance-tagged-fact-model",
    "negative-matrix-testing",
    "post-deploy-reaudit",
  ],
  rules: ["AB-158", "AB-046", "AB-060"],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/arc-c62-agent-surface.md",
    },
    {
      type: "read",
      label: "Next article: payout proofs signed in DNS",
      url: "https://agentbadge.xyz/blog/arc-c63-payto-proof",
    },
    {
      type: "read",
      label: "Free agent-readiness scan",
      url: "https://agentbadge.xyz/services/scanner",
    },
    {
      type: "read",
      label: "The callable public contract",
      url: "https://agentbadge.xyz/api/specs",
    },
  ],
  qa: [
    {
      question: "What are agent-surface bugs?",
      answer:
        "Bug classes that only exist when the reader of your site is a machine, not a human: anonymous callers listing and calling your full MCP tool catalog, SSRF through IP encodings a URL validator never normalizes, an OpenAPI document that indexes your admin routes for attackers, a published DID that signs nothing, machine-readable docs (llms.txt, agent card) advertising endpoints that 404, rate limits covering the wrong transport, server errors phrased as crashes instead of refusals, and a scanner reporting facts it never observed.",
    },
    {
      question: "How many bugs did the multi-model audit find on agentbadge.xyz?",
      answer:
        "Seventeen real bugs across six rounds with three external reviewers (DeepSeek, Gemini, Grok). Every one was fixed and re-verified on production - zero 'will fix later'. DeepSeek's own precision was measured too: 15 real findings against 5 false positives (75%), each adjudicated on evidence. The self-scan score moved 71.15 (grade C) to 94.7 (grade A), 134 of 159 checks verified.",
    },
    {
      question: "How was the anonymous MCP execute surface fixed?",
      answer:
        "A deny-by-default exposure tier on every tool - public / authenticated / admin, unclassified defaults to admin - enforced at one point across JSON-RPC, REST aliases and batch arrays. Anonymous tools/list now returns a 15-tool curated set (down from 76, which included ops and admin tools), llms.txt and the agent card advertise exactly that set, drift is gated in CI, and a 28-case negative matrix (tool × caller × transport) spies that handlers never execute.",
    },
    {
      question: "Which SSRF encodings bypassed the scanner URL guard?",
      answer:
        "Bracketed IPv6 (http://[::1]/ produced a 500), Oracle Cloud's metadata address 192.0.0.192 (hung, range unblocked), multicast 224.0.0.1 and [ff02::1] (not in the threat model), and DNS-level reachability via nip.io → 169.254.x.x plus metadata.google.internal. Fixes normalize [v6] brackets and hex-mapped ::ffff: forms before classification, and the deny-list now covers 192.0.0.0/24, 192.88.99.0/24, 198.18.0.0/15, 240.0.0.0/4, 224.0.0.0/4 and ff00::/8 - every vector retestable: all return 403 or an honest 400, never 500 or a hang.",
    },
    {
      question: "Can the fixes be checked externally?",
      answer:
        "Yes - every fix is live on production: anonymous tools/list at https://agentbadge.xyz/mcp returns the 15-tool curated set; SSRF probes against /api/scan?url= for the deny vectors return 403/400; the signed descriptor at /.well-known/agentbadge.json verifies with the key in /.well-known/did.json; and /api/specs exposes 322 public paths with zero admin routes.",
    },
  ],
  claims: [
    {
      id: "c62-audit-closed",
      status: "VERIFIED",
      text: "Six rounds × three external reviewers (DeepSeek, Gemini, Grok) against the production surface: 17 real bugs, all fixed and re-verified on production. Self-scan moved 71.15 (C) → 94.7 (A), 134/159 checks verified. Review corpus: docs/REVIEW/2311/.",
      evidence: [
        {
          type: "github",
          url: "https://agentbadge.xyz/services/scanner",
        },
      ],
    },
    {
      id: "c62-anonymous-tools-curated",
      status: "VERIFIED",
      text: "Anonymous tools/list returns a 15-tool curated set (was 76 including ops/admin names) - exposure tier deny-by-default, one enforcement point across JSON-RPC, REST aliases and batch arrays, 28-case negative matrix.",
      evidence: [
        {
          type: "github",
          url: "https://agentbadge.xyz/mcp",
        },
      ],
    },
    {
      id: "c62-ssrf-vectors-closed",
      status: "VERIFIED",
      text: "Nine SSRF encodings probed, seven real gaps closed: bracketed IPv6, Oracle metadata range, multicast, nip.io and metadata.google.internal DNS reachability - all now return 403 or honest 400, never 500 or a timeout.",
      evidence: [
        {
          type: "github",
          url: "https://agentbadge.xyz/api/scan?url=http://224.0.0.1/",
        },
      ],
    },
    {
      id: "c62-trust-chain-verified",
      status: "VERIFIED",
      text: "Dead trust chain fixed: /.well-known/agentbadge.json carries a detached EdDSA JWS over the canonicalized descriptor, kid matching did.json verificationMethod, payload committing to descriptor_sha256 - one GET + one key resolution = end-to-end verified artifact.",
      evidence: [
        {
          type: "github",
          url: "https://agentbadge.xyz/.well-known/agentbadge.json",
        },
      ],
    },
    {
      id: "c62-dogfood-loop-closed",
      status: "VERIFIED",
      text: "Full server pipeline run end-to-end against production - scan → signed report → attestation → public verify → diff → alerts → export → billing → transfer: 30/30 assertions green (DOGFOOD-002); attestation survives redeploys in Postgres.",
      evidence: [
        {
          type: "github",
          url: "https://agentbadge.xyz/api/specs",
        },
      ],
    },
  ],
  content: arcC62AgentSurfaceContent,
};
