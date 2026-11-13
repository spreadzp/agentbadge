import type { BlogArticle } from "../../blog-data";
import { devinCloudAuditContent } from "./devin-cloud-audit.content";

export const article: BlogArticle = {
  slug: "devin-cloud-audit",
  title:
    "We Pointed an Autonomous AI Engineer at Our Own Repo - It Found a Real Bug",
  description:
    "Field report: a free Devin Cloud (SWE-2) session audited the public agentbadge repo and returned 4 findings. We verified each claim by hand with file:line evidence - zero false positives, one real security bug (unauthenticated domain-verification invalidation), and a fix PR the agent opened itself.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-13",
  dateModified: "2026-11-13",
  tags: [
    "ai-audit",
    "autonomous-agents",
    "code-review",
    "security",
    "agentic-web",
    "devin",
    "transparency",
    "field-report",
  ],
  readingTime: "7 min",
  shortAnswer:
    "We ran a free Devin Cloud session against the public agentbadge repo; it returned 4 findings - an unauthenticated challenge endpoint that lets anyone invalidate domain verification, a missing CI gate for bun run gate, a fresh clone that cannot install (file: dependency outside the repo), and committed build artifacts. We hand-verified every claim with file:line evidence: zero false positives, precise counts unverified (Node-vs-Bun methodology caveat), fix PR for the security bug opened by the agent.",
  status: "EXPERIMENT",
  technologies: [
    "TypeScript",
    "Bun",
    "Hono",
    "Devin Cloud",
    "SWE-2",
    "GitHub Actions",
  ],
  entities: [
    "spreadzp-agentbadge-repo",
    "trust-challenge-endpoint",
    "devin-cloud-session",
    "bun-run-gate",
  ],
  concepts: [
    "claim-verification",
    "evidence-backed-audit",
    "agent-produces-human-verifies",
    "stateless-hmac-challenge",
    "honest-methodology-caveats",
    "dogfooding",
  ],
  topics: [
    "autonomous-agents",
    "code-audit",
    "security",
    "agent-workflows",
    "verification",
  ],
  capabilities: [
    "autonomous-repo-audit",
    "file-line-evidence-claims",
    "agent-opened-fix-pr",
    "human-verified-claims",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/devin-cloud-audit.md",
    },
    {
      type: "read",
      label: "Audited repository",
      url: "https://github.com/spreadzp/agentbadge",
    },
    {
      type: "read",
      label: "Challenge endpoint source",
      url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/routes/trust.ts",
    },
    {
      type: "read",
      label: "Agent Guide",
      url: "https://agentbadge.xyz/agent-guide",
    },
  ],
  qa: [
    {
      question: "What exactly did we ask the agent to do?",
      answer:
        "One Devin Cloud session, one prompt: clone the spreadzp/agentbadge repo, review the codebase, report concrete improvement suggestions. No hints or file pointers. The session ran on Devin's VM against commit 059eea2f and cost nothing - SWE-2 sessions are free (2 concurrent per user on the Teams plan).",
    },
    {
      question: "What did it find?",
      answer:
        "Four findings, zero false positives: F-1 an unauthenticated GET /api/trust/:domain/challenge endpoint that overwrites stored domain-verification tokens (in-memory Map, no size limit, lost on restart despite a 90-day claim, !== instead of constant-time); F-2 no CI job runs bun run gate; F-3 a fresh clone cannot install because @agentbadge/payments resolves via file:../../packages/payments outside the repo plus blank-env test failures and tests reading ../docs/EPICS; F-4 committed build artifacts including an 854KB agentbadge-report.json.",
    },
    {
      question: "How did we verify the audit before believing it?",
      answer:
        "Each finding was re-derived from source with file:line evidence - route definitions, the challenge store implementation, workflow files, package.json, git ls-files. All four confirmed on first inspection in about fifteen minutes of human attention. Two numeric claims (310 tsc errors, 272/830 failing test files) were recorded as confirmed-with-asterisk: they came from a Node.js run while the suite is Bun-native, a caveat the agent itself flagged.",
    },
    {
      question: "What happened after the audit?",
      answer:
        "The same cloud session was resumed to fix F-1: replace the stateful token map with a stateless HMAC challenge (agentbadge-verify= + HMAC(secret, domain+epoch)), extend the trust tests, and open a PR. A second session audits agentbadge.xyz (robots, sitemap, structured data, link health). At the time of writing both are in flight; the human review document tracks which findings land as fixes versus documented-accepted.",
    },
    {
      question: "What does this prove about agent-native workflows?",
      answer:
        "The bottleneck moved: an autonomous agent produced a competent audit for free in under an hour, and the expensive part became verification and decision-making. The loop that worked - agent produces claims, human verifies against ground truth, agent executes the approved fix, human reviews the diff - is the same claim/provenance/verification shape our own supply-chain stack formalizes.",
    },
  ],
  claims: [
    {
      id: "devin-audit-f1-confirmed",
      status: "VERIFIED",
      text: "GET /api/trust/:domain/challenge is unauthenticated and each call overwrites the stored challenge token for that domain; tokens live in a process-memory Map with no size limit, expire-on-paper after 90 days but die on restart, and are compared with plain !== (trust.ts:281).",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/routes/trust.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/agent-readiness/trust/challenge-store.ts",
        },
      ],
    },
    {
      id: "devin-audit-f2-confirmed",
      status: "VERIFIED",
      text: "No CI workflow runs bun run gate (tsc --noEmit && eslint && vitest && check:openapi): the three workflows cover only the scanner smoke test, architecture-graph check and weekly board conformance.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/tree/main/.github/workflows",
        },
      ],
    },
    {
      id: "devin-audit-f3-confirmed",
      status: "VERIFIED",
      text: "A fresh clone cannot install: package.json depends on @agentbadge/payments via file:../../packages/payments outside the repo; .env.example leaves required vars blank so hundreds of test files fail env validation; ~9-11 spec tests read ../docs/EPICS outside the repo; the blog links to packages/payments/src which does not exist in this repo.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/package.json",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/.env.example",
        },
      ],
    },
    {
      id: "devin-audit-f4-confirmed",
      status: "VERIFIED",
      text: "Committed build artifacts and planning docs: agentbadge-report.json (854KB) and coverage/coverage-summary.json are in git, plus ~10 hackathon-era markdown docs in the repo root.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/agentbadge-report.json",
        },
      ],
    },
    {
      id: "devin-audit-methodology-caveat",
      status: "VERIFIED",
      text: "The agent's numeric counts (310 tsc errors, 272/830 failing test files, ~620 env-validation failures) come from a Node.js run and were not reproduced locally; the suite is Bun-native and the agent itself noted Bun's runtime breaks vi.mocked. Direction confirmed, exact numbers unverified.",
    },
  ],
  externalLinks: [],
  content: devinCloudAuditContent,
};
