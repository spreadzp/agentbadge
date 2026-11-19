import type { BlogArticle } from "../../blog-data";
import { arcC53FinopsControlRoomContent } from "./arc-c53-finops-control-room.content";

export const article: BlogArticle = {
  slug: "arc-c53-finops-control-room",
  title:
    "No Transition Without a Receipt: an Operator's Control Room for Agent Money",
  description:
    "Agents settle payments without a human in the loop - so we built the room where a human can still see and act. /admin/finance/* - 15 routes behind one auth gate: payment traces, reconciliation exceptions, refunds that complete only behind a chain-verified txHash, and an append-only AdminAction on every operator move. Verified by 8 audit rounds and an external agent on production - which still found one real bug, now fixed.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-19",
  dateModified: "2026-11-19",
  tags: [
    "admin-finops",
    "payments",
    "audit-trail",
    "refunds",
    "reconciliation",
    "api",
    "epic-226",
  ],
  readingTime: "8 min",
  shortAnswer:
    "Agents already pay each other on their own - signed deals, x402, Stripe, chain transfers. When money moves without a human in the loop, you still need a room where a human can look. We built /admin/finance/* - 15 routes behind a single auth gate where an operator can trace every verification attempt on a payment, run a reconciliation scan, resolve an exception, and complete a refund only behind a chain-verified transaction hash. Every operator action appends an AdminAction - append-only, operator-attributed, no silent writes. Then we made it prove itself: 8 rounds of independent AI audit until findings ran out, and an external agent attacking production that still found one real bug (publicly cacheable 401s - fixed, redeployed, re-verified).",
  heroImage: "/images/blog/arc-c53-finops-control-room-hero.webp",
  ogImage: "/images/blog/arc-c53-finops-control-room-og.jpeg",
  status: "LIVE",
  technologies: [
    "TypeScript",
    "Bun",
    "Hono",
    "Postgres",
    "HTMX",
    "Prisma",
  ],
  entities: [
    "admin-finance",
    "admin-action",
    "refund-intent",
    "reconciliation-exception",
    "verify-refund-tx",
    "record-only",
    "epic-226",
    "epic-225",
  ],
  concepts: [
    "audit-always",
    "no-fabricated-confirmations",
    "revenue-not-recorded",
    "fail-closed",
    "typed-errors",
    "append-only-admin-actions",
    "refund-intent-lifecycle",
    "exception-detection-dedupe",
    "external-agent-verification",
  ],
  topics: [
    "admin-finops",
    "payments",
    "agent-economy",
    "api",
    "audit-trail",
  ],
  capabilities: [
    "admin-authenticated-finance-reads",
    "operator-attributed-mutations",
    "verified-refund-completion",
    "reconciliation-exception-scan",
    "csv-report-export",
    "record-only-revenue-exclusion",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/arc-c53-finops-control-room.md",
    },
    {
      type: "read",
      label: "Unauthenticated probe: uniform 401 + no-store",
      url: "https://agentbadge.xyz/admin/finance/payments",
    },
    {
      type: "read",
      label: "Previous article: agent trust layers",
      url: "https://agentbadge.xyz/blog/arc-c52-agent-trust-layers",
    },
  ],
  qa: [
    {
      question: "What is the /admin/finance/* surface and who can use it?",
      answer:
        "15 admin routes behind one adminAuth middleware: payments list and detail (with every verification attempt and trace), an exceptions queue, an audit-trail page, and reports (HTML plus ?format=csv export). Access requires the shared ADMIN_API_KEY passed as X-Admin-Key or Authorization: Bearer - compared via sha256 + timingSafeEqual. Anonymous callers get an identical 401 JSON envelope with cache-control: no-store on every route. A human operator reaches the HTMX dashboard through a header-injecting extension/proxy or uses curl; each action form carries a required self-declared operator field recorded in the audit row.",
    },
    {
      question: "How does a refund complete without fabricated confirmations?",
      answer:
        "POST /admin/finance/payments/:id/refund opens a RefundIntent (OPEN). POST /admin/finance/refunds/:id/complete requires a txHash checked by an injected VerifyRefundTx adapter against the chain; txHash is unique at the database level so one transaction cannot complete two refunds. If no verifier is wired - as on production today - the route answers a typed fail-closed 503 PROVIDER_ERROR before the intent lookup, instead of pretending success.",
    },
    {
      question: "How are reconciliation exceptions detected and resolved?",
      answer:
        "POST /admin/finance/exceptions/detect scans for ledger/provider drift and opens ReconciliationException rows, deduplicated so repeated scans report skipped rather than stacking duplicates - the detect call itself writes a DETECT_EXCEPTIONS AdminAction. POST /exceptions/:id/resolve takes an operator name and note and is idempotent: re-resolving answers instead of double-writing.",
    },
    {
      question: "Why don't RECORD_ONLY rows count as revenue?",
      answer:
        "RECORD_ONLY marks commerce logged for bookkeeping that never settled through the payment rails. The reports read-model has no code path that adds those rows to gross/fees/net - they surface only as an informational recordedOnly block (production today: 3 rows, 55.00 USD). No operator flag can accidentally include them.",
    },
    {
      question: "What did the audit rounds and the external production check find?",
      answer:
        "Arc Studio ran 8 review rounds: rounds 1-3 request-changes with Critical/High, rounds 4-7 a shrinking Medium tail (lock-unlink race in payment mutex, exception starvation via over-long subjectRef, unverified duplicate-skip), round 8 zero Critical/High/Medium. An external cloud Devin then probed production read-only: all 15 routes returned identical 401s, fabricated refund completion hit typed 503, detect was idempotent and audited - but it found 401 envelopes were publicly cacheable (public, max-age=300). Fixed by adding /admin/ to the no-store prefixes, redeployed as commit 4119016, re-verified live.",
    },
  ],
  claims: [
    {
      id: "c53-admin-finance-surface-live",
      status: "VERIFIED",
      text: "The admin FinOps surface is live on production: 15 routes under /admin/finance/* - dashboard, payments list/detail, exceptions, audit, reports (HTML + CSV) - all behind adminAuth; unauthenticated GET and POST calls return an identical 401 JSON envelope with cache-control: no-store.",
      evidence: [
        {
          type: "demo",
          url: "https://agentbadge.xyz/admin/finance/payments",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/hackathon/server/src/server/routes/finops/finops.ts",
        },
      ],
    },
    {
      id: "c53-audit-always",
      status: "VERIFIED",
      text: "Every admin mutation appends an AdminAction row with operator, payload and result - verified on production: two exceptions/detect calls produced exactly two DETECT_EXCEPTIONS rows attributed to operator DEVIN-TEST.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/hackathon/server/src/server/lib/finops/admin-actions.ts",
        },
      ],
    },
    {
      id: "c53-refund-fail-closed",
      status: "VERIFIED",
      text: "POST /admin/finance/refunds/:id/complete is fail-closed on production: without a wired VerifyRefundTx adapter it returns 503 PROVIDER_ERROR 'refund tx verification is not configured on this backend' before the intent lookup - fabricated txHashes cannot mark refunds complete.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/hackathon/server/src/server/routes/finops/finops-ops.ts",
        },
      ],
    },
    {
      id: "c53-recorded-only-excluded",
      status: "VERIFIED",
      text: "RECORD_ONLY commerce rows are excluded from revenue by the read-model itself: production reports CSV shows gross/fees/net 0.00 with a separate informational recordedOnly block (count 3, volume 55.00 USD).",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/hackathon/server/src/server/lib/finops/read-models.ts",
        },
      ],
    },
    {
      id: "c53-external-verify-cache-bug",
      status: "VERIFIED",
      text: "External cloud-Devin production verification (session devin-2f3fc48a0984496ea503172d4fddc8f6, 2026-11-19) confirmed auth gating, typed errors, idempotent detect and audit attribution - and found one real defect: 401 envelopes carried cache-control public,max-age=300. Fixed in commit 97e5f24, redeployed as 4119016, re-verified: unauthenticated calls now return no-store.",
      evidence: [
        {
          type: "demo",
          url: "https://agentbadge.xyz/admin/finance/payments",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/docs/DEVIN/LOGS/cloud/dispatch-2026-11-19-226.log",
        },
      ],
    },
  ],
  externalLinks: [],
  content: arcC53FinopsControlRoomContent,
};
