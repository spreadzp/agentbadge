import type { BlogArticle } from "../../blog-data";
import { arcC63PaytoProofContent } from "./arc-c63-payto-proof.content";

export const article: BlogArticle = {
  slug: "arc-c63-payto-proof",
  title:
    "We Published Our Own Payout Address in DNS - and the Check Caught a Bug Before the Rule Even Existed",
  description:
    "EPIC-258 x402 payout proofs, live on agentbadge.xyz: a signed out-of-band proof set (DNS TXT at _x402-payto + /.well-known/x402-payto.json) that the seller endpoint cannot touch, dogfooded on our own domain before the rule existed - where it caught a real DoH parsing bug. Checkers AB-188/189 report VERIFIED/CONFLICT/GAP/UNCHECKED (unchecked is not absent), freshness fields stamp when we saw each quote, and a stateless recheck ontology classifies DROPPED/ROTATED/SCOPE_CHANGED/REAPPEARED - where SERVFAIL is never a revocation.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-25",
  dateModified: "2026-11-25",
  tags: [
    "x402",
    "payto-proof",
    "dns",
    "payment-security",
    "agent-payments",
    "arc",
    "epic-258",
  ],
  readingTime: "7 min",
  shortAnswer:
    "When an AI agent pays an API with crypto, the address it pays comes from the seller - the one party that profits from lying. A draft spec called x402payto1 flips this: the business publishes its payout addresses out-of-band, signed, where the seller endpoint cannot touch them. We dogfooded it on our own domain before writing a single rule - and our own check caught a real parsing bug in the way public DNS resolvers answer TXT queries. Then three strangers on LinkedIn independently pushed the same question: what happens when an address leaves the proof set? So we built that too.",
  heroImage: "/images/blog/arc-c63-payto-proof-hero.webp",
  ogImage: "/images/blog/arc-c63-payto-proof-og.jpeg",
  status: "LIVE",
  technologies: ["TypeScript", "Bun", "Hono", "DNS-over-HTTPS", "x402"],
  entities: [
    "x402payto1",
    "ab-188",
    "ab-189",
    "ab-190",
    "payto-proof-set",
    "diff-payto-reports",
    "epic-258",
  ],
  concepts: [
    "out-of-band-proof",
    "self-reported-vs-published",
    "confirmed-absence",
    "unchecked-is-not-absent",
    "proof-freshness",
    "stateless-recheck",
    "transition-ontology",
    "dogfood-before-rule",
    "dual-resolver-agreement",
  ],
  topics: ["x402", "payment-proofs", "dns-security", "trust", "arc"],
  capabilities: [
    "dns-txt-proof-resolution",
    "well-known-proof-fetch",
    "dual-doh-resolver-agreement",
    "payto-set-verification",
    "proof-freshness-assessment",
    "stateless-recheck-diff",
    "confirmed-absence-detection",
    "scanner-verdict-taxonomy",
  ],
  rules: ["AB-188", "AB-189", "AB-190"],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/arc-c63-payto-proof.md",
    },
    {
      type: "read",
      label: "Previous article: feedback & review advisory verdicts",
      url: "https://agentbadge.xyz/blog/arc-c61-feedback-review",
    },
    {
      type: "read",
      label: "Counterparty trust layer",
      url: "https://agentbadge.xyz/blog/arc-c58-counterparty-trust",
    },
    {
      type: "read",
      label: "@agentbadge/x402-payto-proof on npm",
      url: "https://www.npmjs.com/package/@agentbadge/x402-payto-proof",
    },
  ],
  qa: [
    {
      question: "How does an agent verify an x402 payout address?",
      answer:
        "Resolve the domain's published proof set out-of-band - a DNS TXT record at _x402-payto.<domain> and/or /.well-known/x402-payto.json - then compare every payTo address in the live 402 challenge's accepts[] against that set. AgentBadge checkers AB-188 (x402 quotes) and AB-189 (MPP/L402 challenges) report VERIFIED, CONFLICT, GAP, or unchecked - where unchecked means 'could not verify', never evidence of absence.",
    },
    {
      question: "What happens when a proven payout address leaves the proof set?",
      answer:
        "diffPaytoReports classifies the transition per member: DROPPED only on confirmed absence (a live re-lookup with both DoH resolvers agreeing - never a cache hit), ROTATED for drop+add in one move, SCOPE_CHANGED for a provenance move, REAPPEARED for an address coming back, and recheck_unchecked for resolver failures - a SERVFAIL is never a revocation.",
    },
    {
      question: "Is a stale or old proof still valid?",
      answer:
        "Yes - freshness is informational, never a downgrade. Every evidence row carries observed_at (when we saw the quote, per probe, with probe_id and observer labels) plus issued_age_days; proofs older than 30 days get a stale_issued flag, and a proof dated in the future gets flagged - but an old proof that still verifies is still verified.",
    },
    {
      question: "What did the audit find before this shipped?",
      answer:
        "Arc Studio adversarial review returned BLOCK: 2 Critical, 4 High, 14 Medium - every critical/high reproduced. The best catch was a false revocation: a well-known fetch timeout could silently mark a site-tier proof DROPPED. Remediation shipped per-tier absence confirmation (site tier requires DNS ok plus site answered), dual-DoH agreement (no winner-picking), site-verdicts gated on dnsState, and a skip_reasons cap - all verified by 1342 scanner tests + 63 lib tests. Published as @agentbadge/x402-payto-proof@0.2.2.",
    },
  ],
  claims: [
    {
      id: "c63-dns-proof-live",
      status: "VERIFIED",
      text: "agentbadge.xyz publishes a live x402payto1 proof: DNS TXT at _x402-payto.agentbadge.xyz plus /.well-known/x402-payto.json serving a signed payTo set; the public /agent-readiness.json scan reports AB-188 VERIFIED (dns_signed), AB-189 VERIFIED, AB-190 VERIFIED.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/wiring/ops.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/docs/EPICS/258-x402-payout-proof/OPS-PAYTO-PROOF.md",
        },
      ],
    },
    {
      id: "c63-recheck-ontology",
      status: "VERIFIED",
      text: "diffPaytoReports is a pure stateless module classifying proof-set transitions: still_verified, newly_proven, DROPPED (only on confirmed absence - live lookup, resolvers agreeing, never a cache hit), ROTATED, SCOPE_CHANGED, REAPPEARED, recheck_unchecked (SERVFAIL never a revocation), CONFLICT. Covered by 21 unit + 3 e2e tests.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/agent-readiness/payto-recheck/diff.ts",
        },
      ],
    },
    {
      id: "c63-evaluator-on-npm",
      status: "VERIFIED",
      text: "The evaluator is published open-source as @agentbadge/x402-payto-proof@0.2.2 - zero-IO, deterministic, caller-supplied clock; freshness surface (observed_at, issued_age_days, stale_issued) added in 0.2.0 and audit remediations in 0.2.1/0.2.2.",
      evidence: [
        {
          type: "github",
          url: "https://www.npmjs.com/package/@agentbadge/x402-payto-proof",
        },
      ],
    },
    {
      id: "c63-audit-remediation",
      status: "VERIFIED",
      text: "Arc Studio R1 returned BLOCK (2C/4H/14M, all C/H reproduced); remediation shipped per-tier confirmsAbsence, dual-DoH agreement, site-verdict dns-gate, exempt-ready-set dedup, and 11 medium fixes - 1342/1342 server + 63/63 lib tests green. Full report committed at reviews/payto-proof-REVIEW.md.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/reviews/payto-proof-REVIEW.md",
        },
      ],
    },
    {
      id: "c63-probe-prod-verified",
      status: "VERIFIED",
      text: "Probe-bot prod regression on v501: the run caught a real method-guard bug (PUT/DELETE/PATCH/POST returned 200 on the static payto file - fixed to 405 with Allow), deep-assert scenarios verify domain/payTo/0x-shapes and AB-188/189/190 VERIFIED live.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/scripts/probe-bot/scenarios/payto-proof-surface.ts",
        },
      ],
    },
  ],
  content: arcC63PaytoProofContent,
};
