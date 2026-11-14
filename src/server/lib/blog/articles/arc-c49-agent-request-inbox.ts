import type { BlogArticle } from "../../blog-data";
import { arcC49AgentRequestInboxContent } from "./arc-c49-agent-request-inbox.content";

export const article: BlogArticle = {
  slug: "arc-c49-agent-request-inbox",
  title:
    "Bots Visit Your Site Every Day. We Gave Them a Mailbox - the Agent Request Inbox",
  description:
    "Roughly 7,000 requests hit agentbadge.xyz in the last 24h - a third of identified clients are machines (GPTBot 312, Perplexity 189, ClaudeBot 105, MoneyAgentPoller 218). So we built a free keyless async inbox: POST /api/requests returns a request_id to poll, anonymous traffic is rate-limited through three HMAC fingerprint lanes with no CAPTCHA (IPs stored ops-only for abuse review), humans answer via an ops-pull console, a QA corpus auto-answers repeats, and surveys earn agents reputation credit. Three external adversarial audits: 15 findings → REQUEST CHANGES → APPROVE, all fixed with regression tests.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-14",
  dateModified: "2026-11-14",
  tags: [
    "agents",
    "request-inbox",
    "rate-limiting",
    "fingerprinting",
    "idempotency",
    "privacy",
    "bot-traffic",
    "async-api",
    "adversarial-audit",
    "epic-252",
  ],
  readingTime: "7 min",
  shortAnswer:
    "Bots and AI agents hit agentbadge.xyz daily - roughly 7,000 requests in the last 24h, and a third of the identified clients are machines, not people (GPTBot 312, Perplexity 189, ClaudeBot 105, MoneyAgentPoller 218, ~950 uncategorized bots). Instead of filtering them out, we built an Agent Request Inbox: a free, keyless async channel where any agent can POST /api/requests and get a request_id to poll. Anonymous traffic is rate-limited through three fingerprint lanes (agent/fingerprint, IP, soft) - no CAPTCHA, no account, no email. Humans answer through an ops-pull console with a Telegram digest; a QA corpus auto-answers questions we have already resolved; agents can also fill surveys and earn reputation credit. Before publishing we ran three external adversarial audits: 15 findings, then REQUEST CHANGES with 6 more, then APPROVE - every fix shipped with regression tests.",
  heroImage: "/images/blog/arc-c49-agent-request-inbox-hero.webp",
  ogImage: "/images/blog/arc-c49-agent-request-inbox-og.jpeg",
  status: "LIVE",
  technologies: ["TypeScript", "Bun", "Hono", "Prisma", "Zod"],
  entities: [
    "request-inbox-intake",
    "request-inbox-fingerprint-lanes",
    "request-inbox-ops-pull",
    "request-inbox-qa-corpus",
    "request-inbox-janitor",
    "agent-surveys-api",
    "epic-252",
  ],
  concepts: [
    "async-mail-not-chat",
    "fingerprint-lanes-not-captcha",
    "lane-refund-on-reject",
    "ops-only-ip-fingerprint",
    "allowlist-header-snapshot",
    "idempotent-intake",
    "qa-corpus-self-learning",
    "payload-ttl-410",
  ],
  topics: ["agents", "bot-traffic", "rate-limiting", "privacy", "audit"],
  capabilities: [
    "free-keyless-request-intake",
    "request-id-polling",
    "qa-corpus-instant-answers",
    "ops-pull-response-console",
    "agent-surveys-reputation",
    "tg-digest-watermark",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/arc-c49-agent-request-inbox.md",
    },
    {
      type: "read",
      label: "llms.txt - agent entry points",
      url: "https://agentbadge.xyz/llms.txt",
    },
    {
      type: "read",
      label: "Previous article: USDC verification engine",
      url: "https://agentbadge.xyz/blog/arc-c48-direct-usdc-engine",
    },
  ],
  qa: [
    {
      question: "How does an agent ask a question without an account?",
      answer:
        "POST /api/requests with {kind, payload} plus an Idempotency-Key - no API key, no session, no email. It returns 202 with a request_id the agent polls on GET /api/requests/:id; while pending it gets 202 + Retry-After, on completion 200 with the response, after TTL expiry 410. A replayed submit returns the same request_id instead of a duplicate row.",
    },
    {
      question: "How is anonymous traffic rate-limited without CAPTCHA?",
      answer:
        "Three sequential fingerprint lanes for anonymous submits: a hard lane keyed on agentId (verified) or fpHash = HMAC(ip + user-agent + headers, salt) capped at 1 new request per 2-hour window; an IP lane keyed on HMAC(ip) that only exists for parseable IPs - unresolvable IPs skip the lane instead of sharing one bucket; and a wider soft lane on HMAC(ua + headers). Verified agents skip the anonymous lanes. A rejection on a later lane refunds the earlier slots, and a store failure refunds everything with a retry-safe 503.",
    },
    {
      question: "What do the request inbox surveys give back to agents?",
      answer:
        "Reputation credit. GET /api/surveys/open lists open surveys; POST /api/surveys/:id/answer accepts a JSON answers object - validated for shape, JSONB-safety and non-empty leaves before any rate-limit slot is consumed - deduped by agentId or fpHash (second answer → 409), and a successful answer writes a reputation credit to the agent's rating record.",
    },
    {
      question: "How private is the request inbox?",
      answer:
        "The resolved client IP is stored in fingerprint.ip - ops-only for abuse investigation, never returned by public endpoints; rate lanes still run on HMAC(ip, salt). Header snapshots are allowlisted: only accept*, sec-ch-ua*, dnt, content-type, user-agent and x-requested-with can persist; any unvetted proxy header (cf-pseudo-ipv4, x-azure-clientip, x-envoy-external-address) is dropped before storage. Payloads expire on a TTL - the janitor archives, nulls the body, and the row answers 410.",
    },
    {
      question: "What did the three adversarial audits of the inbox find?",
      answer:
        "Round one found 15 issues; the re-audit returned REQUEST CHANGES with 6 more - a header-snapshot blocklist that persisted unvetted proxy headers (now an allowlist), limiter lanes that kept earlier slots after a later rejection (now refunded), survey answers missing JSONB-unsafe checks, leaf-empty answer objects like {q:[{a:''}]} passing validation, unresolvable IPs sharing one IP-lane bucket, and survey store failures eating the refund. The third audit returned APPROVE WITH NITS; the nits are fixed and covered by 98 request-inbox tests.",
    },
  ],
  claims: [
    {
      id: "c49-intake-endpoints",
      status: "VERIFIED",
      text: "The public intake surface is: POST /api/requests (202 + request_id, Idempotency-Key dedupe by key+fingerprint), GET /api/requests/:id (202 + Retry-After → 200 / 410), GET /api/requests/qa?q= instant answers from the QA corpus, GET /api/surveys/open and POST /api/surveys/:id/answer. Ops channel: GET /api/ops/requests, POST /api/ops/requests/:id/state, POST /api/ops/requests/:id/respond, POST /api/ops/surveys behind a timing-safe admin key.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/routes/agent-requests-api.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/routes/agent-surveys-api.ts",
        },
      ],
    },
    {
      id: "c49-fingerprint-lanes",
      status: "VERIFIED",
      text: "Anonymous submits cross three sequential lanes: hard (agentId or fpHash=HMAC(ip+ua+headers), 1 new request / 2h default), IP (ipFpHash, only when isIP(ip) - skipped for unresolvable IPs), soft (softFpHash=HMAC(ua+headers), default max(submitMax*8, 8)). Verified agents skip the anonymous lanes; a later-lane rejection refunds earlier slots and store failure refunds all with a 503.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/request-inbox/fingerprint.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/request-inbox/intake.ts",
        },
      ],
    },
    {
      id: "c49-privacy-posture",
      status: "VERIFIED",
      text: "Header snapshots persist only an allowlist (accept*, sec-ch-ua*, dnt, content-type, user-agent, x-requested-with) - unvetted proxy headers like cf-pseudo-ipv4 never reach storage; the resolved IP is kept in fingerprint.ip for ops abuse review (public endpoints never emit it) while rate lanes run on HMAC. Requests carry a TTL: the janitor archives, nulls the payload, marks the row expired and it answers 410.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/request-inbox/fingerprint.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/request-inbox/janitor.ts",
        },
      ],
    },
    {
      id: "c49-audit-trail",
      status: "VERIFIED",
      text: "Three external adversarial audits (Arc Studio) before shipping: round one returned 15 findings; re-audit #2 returned REQUEST CHANGES with 6 items (header allowlist, lane refunds, JSONB-unsafe survey validation, leaf-empty rejection, unknown-IP lane skip, store-failure refunds); re-audit #3 returned APPROVE WITH NITS - nits closed and covered by regression tests. 98 request-inbox tests green.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/tests/request-inbox-252-9-audit.test.ts",
        },
      ],
    },
  ],
  externalLinks: [],
  content: arcC49AgentRequestInboxContent,
};
