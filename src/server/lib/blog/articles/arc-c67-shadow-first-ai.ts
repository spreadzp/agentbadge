import type { BlogArticle } from "../../blog-data";
import { arcC67ShadowFirstAiContent } from "./arc-c67-shadow-first-ai.content";

export const article: BlogArticle = {
  slug: "arc-c67-shadow-first-ai",
  title:
    "We Plugged an LLM Into Our Review Pipeline - And Built It So the Model Can Never Decide",
  description:
    "EPIC-232 AI Review Automation, live on agentbadge.xyz: six LLM scenarios (classification, summary, knowledge search, answer drafting, feedback extraction, review assist) under four per-scenario modes - off, shadow, assist, supervised - where shadow runs blind and supervised still ends in a human POST. An AiJob outbox worker writes append-only AiRun rows with real token spend, PolicyChange audits every mode flip, and the ReviewDecision table has no code path a model can write to.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-27",
  dateModified: "2026-11-27",
  tags: [
    "ai-automation",
    "shadow-mode",
    "human-in-the-loop",
    "llm-ops",
    "budget-guard",
    "arc",
    "epic-232",
  ],
  readingTime: "8 min",
  shortAnswer:
    "We wired an LLM into six operator scenarios - classification, summaries, knowledge search, answer drafts, feedback extraction, review hints - under four modes where shadow means the model works blind and supervised still ends with a human pressing the button. The decision table has no code path an AI run can write to: ReviewDecision rows come only from a human decide POST, and the aiRunRef link is validated server-side. Every mode change, every call, and every cent of spend lands in append-only rows you can audit - the live meter reads ~$0.0012 against a $2 ceiling.",
  heroImage: "/images/blog/arc-c67-shadow-first-ai-hero.webp",
  ogImage: "/images/blog/arc-c67-shadow-first-ai-og.jpeg",
  status: "LIVE",
  technologies: [
    "TypeScript",
    "Bun",
    "Hono",
    "PostgreSQL",
    "Prisma",
    "Zod",
    "HTMX",
  ],
  entities: [
    "ai-run",
    "ai-job",
    "automation-policy",
    "policy-change",
    "review-decision",
    "ai-run-ref",
    "epic-232",
  ],
  concepts: [
    "shadow-first",
    "human-in-the-loop",
    "declared-vs-effective-mode",
    "append-only-audit",
    "blind-measurement",
    "budget-metering",
    "kill-switch",
    "outbox-worker",
    "provider-agnostic-llm",
    "advisory-ai",
  ],
  topics: [
    "ai-automation",
    "review-pipeline",
    "llm-guardrails",
    "trust",
    "arc",
  ],
  capabilities: [
    "per-scenario-mode-policy",
    "shadow-blind-runs",
    "supervised-prefill",
    "confidence-threshold-escalation",
    "daily-and-monthly-budget-limits",
    "per-stream-budget-partition",
    "append-only-policy-audit",
    "openai-compatible-provider-switch",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/arc-c67-shadow-first-ai.md",
    },
    {
      type: "read",
      label: "Previous article: keyless agent protocol",
      url: "https://agentbadge.xyz/blog/arc-c66-agent-protocol",
    },
    {
      type: "read",
      label: "Typed feedback and human review",
      url: "https://agentbadge.xyz/blog/arc-c61-feedback-review",
    },
  ],
  qa: [
    {
      question: "How does AgentBadge use AI in its review pipeline?",
      answer:
        "Six scenarios assist human operators: classification and summary on incoming interaction requests, knowledge_search and answer_draft for preparing responses, feedback_extract on the feedback lane, and review_assist on review cases. Each runs in one of four per-scenario modes - off (LLM never called, also the default for missing policy rows), shadow (the model answers real input blind and the operator never sees it), assist (suggestion renders next to the form), or supervised (the model pre-fills a form a human still submits). There is no auto mode.",
    },
    {
      question: "Can the AI write a review decision on AgentBadge?",
      answer:
        "No - structurally. ReviewDecision rows are created by exactly one code path: a human decide POST from the case assignee with per-criterion choices. A model run can only link to a decision via aiRunRef, and the link is validated server-side: the run must exist, target the same case, be a review_assist scenario, carry a non-shadow modeAtTime, and have succeeded. A shadow run cited as endorsement is refused.",
    },
    {
      question: "What is shadow mode in the AgentBadge AI layer?",
      answer:
        "Shadow runs the model blind on real production input: the AiJob outbox picks it up, the worker calls the provider, and the result lands in an append-only AiRun row - but the output never reaches operator screens, so the human baseline stays honest. Comparators then join each run to the human outcome on the same subject and count agreed, disagreed, or not-comparable. Thresholds stay null until that shadow data calibrates them.",
    },
    {
      question: "How does the AI spend cap work on agentbadge.xyz?",
      answer:
        "The budget is metered from provider-reported token counts stored on each AiRun row - not estimated. Limits apply at the worker tick: 500 calls per day, a monthly USD ceiling (currently $2), and a per-stream partition of floor(daily/3) so one busy lane cannot starve the others. Calls that fail before reaching the provider do not count. As of publishing, the live meter reads ~$0.0012 for the month against the $2 cap, and a master env kill plus per-scenario kill switches stop spending without a redeploy.",
    },
    {
      question: "What did the verification arc find for the AI review epic?",
      answer:
        "Four layers each caught something. The adversarial audit returned REQUEST CHANGES with one Critical - an operator-asserted aiRunRef that let a shadow run be cited as endorsement - plus nine Highs, remediated to APPROVE WITH NITS across four rounds. A production probe ran 106 checks with zero failures. The owner verification script reports 19 PASS against prod. And the live DeepSeek provider swap exposed a wire-format incompatibility - json_schema is rejected with HTTP 400 while json_object works - fixed with the AI_JSON_MODE env switch before a real feedback_extract shadow run completed the same day.",
    },
  ],
  claims: [
    {
      id: "c67-ai-modes-policy-surface",
      status: "VERIFIED",
      text: "agentbadge.xyz serves /admin/ai policies UI where each of six scenarios (answer_draft, classification, feedback_extract, knowledge_search, review_assist, summary) independently resolves to off|shadow|assist|supervised; missing rows resolve to off, and every change appends an actor+reason PolicyChange row. Verified on prod: unauthenticated routes 401, form tokens are single-use, forged scenario names return unknown_scenario; live audit rows show break_glass transitions with reasons.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/routes/admin-ai-ui.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/ai/policies.ts",
        },
      ],
    },
    {
      id: "c67-ai-cannot-write-decisions",
      status: "VERIFIED",
      text: "ReviewDecision rows are created only through the human decide POST (assignee-scoped, per-criterion results). aiRunRef linking a suggestion to a confirmed decision is validated server-side via validateAiRunRef: run exists, same subject, scenario=review_assist, modeAtTime != shadow, status=success - a shadow run cited as endorsement is refused with invalid_ai_run_ref (audit finding C-1).",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/ai/run-ref.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/reviews/decide.ts",
        },
      ],
    },
    {
      id: "c67-shadow-blind-pipeline",
      status: "VERIFIED",
      text: "Intake enqueues AiJob rows in the same transaction as the accepted report; a worker claims them under a lockedAt CAS lease with maxAttempts, calls an OpenAI-compatible provider, and appends AiRun rows carrying scenario, subject, inputHash, output, confidence, provider, model, promptVersion, tokensTotal, latencyMs, status and modeAtTime. Shadow-mode output never reaches operator screens (audit H-1/H-2 fixes on loader and re-classify paths).",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/ai/worker.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/ai/jobs.ts",
        },
      ],
    },
    {
      id: "c67-budget-meter-real-spend",
      status: "VERIFIED",
      text: "AI spend is metered from provider-reported tokensTotal per AiRun - the live meter reads 'budget: ok - 2 calls today, ~$0.0012 this month' against a $2 monthly cap and 500-call daily limit, with a per-stream partition floor(daily/3) on by default. Pre-provider faults do not burn budget (countProviderCallsSince counts real calls only). Master kill AI_AUTOMATION_ENABLED and per-scenario kills apply at the worker tick without redeploy.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/ai/budget.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/config/env/ai.ts",
        },
      ],
    },
    {
      id: "c67-verification-arc-live-provider",
      status: "VERIFIED",
      text: "EPIC-232 passed four verification layers on prod: arc audit 1C+9H remediated to APPROVE WITH NITS (0C/0H), probe-bot 106 pass / 0 fail, owner verify script 19 PASS / 0 FAIL, and a live DeepSeek deepseek-flash provider swap that exposed the json_schema-vs-json_object incompatibility fixed via AI_JSON_MODE (commit af00cdd0) - followed by a real feedback_extract shadow run with metered usage.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/ai/provider.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/scripts/verify-epic-232.sh",
        },
      ],
    },
  ],
  content: arcC67ShadowFirstAiContent,
};
