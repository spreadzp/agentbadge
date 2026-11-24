import type { BlogArticle } from "../../blog-data";
import { arcC56MmfConformanceAuditContent } from "./arc-c56-mmf-conformance-audit.content";

export const article: BlogArticle = {
  slug: "arc-c56-mmf-conformance-audit",
  title:
    "We Ran Someone Else's 92-Vector Spec Against Our Money Gate - and Published the Divergences",
  description:
    "EPIC-255 MMF conformance audit: Mandata's sha256-pinned 92-vector corpus (v0.4.24) executed against the production x402 spend gate - 35 PASS, 7 DIVERGENCE-BUG, 33 DIVERGENCE-MODEL, 15 NOT_MAPPABLE - with equivalence grades, committed results, four-model independent verification, spec-author rulings, and the v0.5-clamp proposal the divergence spawned.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-24",
  dateModified: "2026-11-24",
  tags: [
    "conformance",
    "mmf",
    "mandata",
    "x402",
    "spend-gate",
    "audit",
    "arc",
    "epic-255",
  ],
  readingTime: "9 min",
  shortAnswer:
    "Shedrack Aji's Mandata project published a conformance corpus for MMF - the Mandate Format that describes what an agent is allowed to spend. 92 vectors, sha256-pinned, opinionated. Instead of claiming we conform, we ran the corpus against our actual production spend gate - the code that guards real x402 payments, warts and all. 35 vectors pass as-is. 7 expose real bugs we are now fixing in a separate epic - plus four more bug classes our own probes found while we were at it. 33 describe a model we deliberately do not implement. 15 test dimensions our system simply does not have. We wrote the classification rules before we ran the suite, committed the raw per-vector JSON, and sent the divergence table back to the spec's author for review. His rulings moved one of our classifications, opened a v0.5 spec proposal, and turned the run into the third implementation of MMF - the first, in his words, 'written against the spec rather than alongside it.'",
  heroImage: "/images/blog/arc-c56-mmf-conformance-audit-hero.webp",
  ogImage: "/images/blog/arc-c56-mmf-conformance-audit-og.jpeg",
  status: "LIVE",
  technologies: [
    "TypeScript",
    "Bun",
    "Vitest",
    "Hono",
    "PostgreSQL",
    "Ed25519",
    "MMF",
  ],
  entities: [
    "mandate",
    "conformance-vector",
    "spend-gate",
    "reservation",
    "ledger-entry",
    "delegation-record",
    "evidence-chain",
    "epic-255",
  ],
  concepts: [
    "conformance-corpus",
    "equivalence-grade",
    "honest-divergence",
    "scalar-projection",
    "fail-closed",
    "hash-chained-evidence",
    "velocity-window",
    "idempotent-replay",
    "independent-verification",
  ],
  topics: [
    "conformance",
    "agent-payments",
    "x402",
    "audit",
    "arc",
  ],
  capabilities: [
    "spend-gate-enforcement",
    "conformance-vector-execution",
    "per-vector-verdicts",
    "equivalence-grading",
    "deterministic-results",
    "spec-author-review",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/arc-c56-mmf-conformance-audit.md",
    },
    {
      type: "read",
      label: "Previous article: feedback infrastructure live",
      url: "https://agentbadge.xyz/blog/arc-c61-feedback-review",
    },
    {
      type: "view-code",
      label: "Mandata - MMF spec, corpus and reference gate",
      url: "https://github.com/ashedrack/mandata",
    },
    {
      type: "view-code",
      label: "Delta findings and spec rulings (issue #32)",
      url: "https://github.com/ashedrack/mandata/issues/32",
    },
  ],
  qa: [
    {
      question: "What is MMF and the Mandata conformance corpus?",
      answer:
        "MMF (the Mandate Format) is Shedrack Aji's open-source specification for bounded spending authority - per-tx caps, budgets, payee allowlists, velocity, delegation, lifecycle and hash-chained evidence - published with a Python reference gate and a 92-vector JSON conformance corpus (pinned at tag v0.4.24). Each vector gives a mandate spec, a transaction (or ordered steps), and the expected verdict, so 'two gates behave identically' becomes a checkable fact rather than a claim.",
    },
    {
      question: "What did the 92-vector run find in AgentBadge's spend gate?",
      answer:
        "Four honest numbers, not one score: 35 PASS, 7 DIVERGENCE-BUG, 33 DIVERGENCE-MODEL, 15 NOT_MAPPABLE (plus 2 GATE_EXCEPTION and 0 harness errors). The bugs are real: $0 and negative amounts reserve successfully, a malformed UTF-16 payee passes (V36, reclassified to BUG on the spec author's ruling), void evades the velocity counter, a check-then-insert race pushes $160 through a $100 cap, a corrupted ledger.json both opens the gate and silently overwrites history, denies leave no trace, and retries double-charge caps. All seven are filed into EPIC-234.",
    },
    {
      question: "How was the conformance run verified independently?",
      answer:
        "The committed suite regenerates deterministically and was re-run on fresh clones of the mmf-255 branch by four independent models - SWE-2 Max, Nemotron 3.5 Lightning High, GPT-6 Luna and Claude Haiku 5.5 - all reporting clean: 43/43 tests green, results/*.json byte-identical, corpus sha256 5/5 intact, no network or credentials needed. Convergent findings reclassified two vectors via a test-only fix (faa882dc) without touching the production gate. The planned cloud-agent run was quota-blocked and is disclosed as such.",
    },
    {
      question: "What did the audit change in the MMF spec itself?",
      answer:
        "The delta findings shipped as an open issue on the Mandata repo with eight spec questions; the author's rulings moved one classification (V36 MODEL to BUG) and confirmed the rest. Our 13 delegation divergences became his v0.5 draft for optional clamp-to-owner-cap semantics (issue #33) with 21 new vectors, frozen at a91b7f4 with three of our review asks adopted. With his TypeScript port merged (PR #34), MMF has three implementations - ours the first written by someone who did not write the spec.",
    },
  ],
  claims: [
    {
      id: "c56-corpus-executed-on-production-gate",
      status: "VERIFIED",
      text: "Mandata's 92-vector MMF conformance corpus (vendored at tag v0.4.24, commit 9aba772, sha256-pinned in CORPUS.md) was executed against the AgentBadge production x402 spend gate through real Hono contexts on fresh stores - no production edits, no spec emulation in the harness. Committed results: 35 PASS / 7 DIVERGENCE-BUG / 33 DIVERGENCE-MODEL / 15 NOT_MAPPABLE / 2 GATE_EXCEPTION / 0 HARNESS_ERROR in tests/conformance/mmf/results/*.json.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/tests/conformance/mmf/results/report.json",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/tests/conformance/mmf/MAPPING.md",
        },
      ],
    },
    {
      id: "c56-seven-bugs-filed-epic-234",
      status: "VERIFIED",
      text: "The corpus caught seven real bugs - unsafe amounts reserving, malformed payee accepted (V36, reclassified MODEL to BUG on the spec author's ruling), void-based velocity evasion, a check-then-insert race ($160/$320 through a $100 cap), corrupted ledger.json opening the gate and overwriting history, traceless denials, and retries double-charging caps - all filed into the EPIC-234 hardening epic via EPIC-234-CANDIDATES.md; the gate code was not edited to make vectors pass.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/tests/conformance/mmf/EPIC-234-CANDIDATES.md",
        },
        {
          type: "github",
          url: "https://github.com/ashedrack/mandata/issues/32",
        },
      ],
    },
    {
      id: "c56-four-model-independent-verification",
      status: "VERIFIED",
      text: "Four independent models (SWE-2 Max, Nemotron 3.5 Lightning High, GPT-6 Luna, Claude Haiku 5.5) verified the suite on fresh clones of branch mmf-255: 43/43 tests green, results byte-identical across regenerations, corpus sha256 5/5 OK, no network or secrets required. Convergent findings were fixed test-only in faa882dc; the planned cloud-agent verification was quota-blocked and is disclosed in the article.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/docs/EPICS/255-mmf-conformance/reviews/DEVIN-FINDINGS.md",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/tests/conformance/mmf/vectors/CORPUS.md",
        },
      ],
    },
    {
      id: "c56-run-spawned-v05-clamp-proposal",
      status: "VERIFIED",
      text: "The divergence table was reviewed by the spec author before publication: eight spec questions answered with rulings on ashedrack/mandata#32, and the 13 delegation divergences became his v0.5 draft for optional clamp-to-owner-cap semantics (#33) - 21 new vectors (K01-K16, KD01-KD05), frozen at a91b7f4 with three AgentBadge review asks adopted (mandatory effective_cap, check-id-not-denial line, and the §7 sentence marking 'same amount, new tx_id, after cap change' as deliberately deferred pending a tighten op). His own zero-dependency TypeScript port merged as PR #34, making MMF a three-implementation spec.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/ashedrack/mandata/issues/33",
        },
        {
          type: "github",
          url: "https://github.com/ashedrack/mandata/pull/34",
        },
      ],
    },
  ],
  content: arcC56MmfConformanceAuditContent,
};
