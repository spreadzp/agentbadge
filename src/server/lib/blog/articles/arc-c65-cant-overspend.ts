import type { BlogArticle } from "../../blog-data";
import { arcC65CantOverspendContent } from "./arc-c65-cant-overspend.content";

export const article: BlogArticle = {
  slug: "arc-c65-cant-overspend",
  title:
    "We Gave an AI Agent a Spending Gate It Cannot Break - Then Paid Two Audits to Try",
  description:
    "EPIC-265 hacksgiving agent: a Thanksgiving-shopping agent physically cannot overspend - every purchase passes a mandate gate running byte-verified production spend-enforcement code (sha256-pinned, 43/43 conformance), isolated across two Fly.io Sprites, the shop credential existing only inside a connector the agent is policy-denied from touching. First adversarial audit found 2 critical overspend paths (rounding mismatch, client-declared amounts), fixed same-day; second audit hit the cap with four concurrency attacks and broke nothing. Kill-tested fail-closed: freeze the gate mid-run and purchases become impossible. Clone, run scripts/verify.sh - 20/20.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-28",
  dateModified: "2026-11-28",
  tags: [
    "agent-spend-enforcement",
    "mandate-gate",
    "sprites",
    "connectors",
    "adversarial-audit",
    "fail-closed",
    "hacksgiving",
    "arc",
    "epic-265",
  ],
  readingTime: "9 min",
  shortAnswer:
    "AI agents can now sign up for cloud accounts, hold credentials through connector gateways, and pay for things - what is missing is the layer that decides what the agent is allowed to buy, enforced where the agent cannot negotiate with it. We put a byte-verified, conformance-tested production spending gate between an autonomous shopping agent and its money, then hired two independent adversarial audits to break the cap. The first found two real overspend paths - fixed the same day. The second attacked the fixed gate with four kinds of concurrency and could not break it. Everything is reproducible: clone the repo, run one command.",
  heroImage: "/images/blog/arc-c65-cant-overspend-hero.webp",
  ogImage: "/images/blog/arc-c65-cant-overspend-og.jpeg",
  status: "LIVE",
  technologies: ["TypeScript", "Bun", "Ollama", "Fly.io", "Sprites"],
  entities: [
    "mandate-gate",
    "agent-sprite",
    "gate-sprite",
    "connector-gateway",
    "demo-shop",
    "append-only-ledger",
    "epic-265",
  ],
  concepts: [
    "infrastructure-enforced-budget",
    "server-side-pricing",
    "reserve-before-settle",
    "fail-closed",
    "deny-replan-arc",
    "rolling-24h-cap",
    "byte-verified-vendoring",
    "honest-limits",
  ],
  topics: [
    "agent-spend-enforcement",
    "agentic-commerce",
    "adversarial-audit",
    "sandbox-isolation",
    "arc",
  ],
  capabilities: [
    "mandate-eval-deny-allow",
    "server-side-cart-pricing",
    "budget-reserve-before-settle",
    "append-only-debit-ledger",
    "rolling-24h-cap-enforcement",
    "connector-credential-attachment",
    "replay-deduplication",
    "kill-safe-fail-closed",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/arc-c65-cant-overspend.md",
    },
    {
      type: "read",
      label: "Verify it yourself - the hacksgiving repo",
      url: "https://github.com/spreadzp/hacksgiving-265",
    },
    {
      type: "read",
      label: "Demo video (1:44) - deny, replan, converge",
      url: "https://youtu.be/B0BtgH6Lvko",
    },
    {
      type: "read",
      label: "Previous article: operator accountability",
      url: "https://agentbadge.xyz/blog/arc-c64-operator-accountability",
    },
  ],
  qa: [
    {
      question: "Why can't the agent just bypass the gate?",
      answer:
        "There is no path around it by construction. The shop credential exists only inside the connector gateway - it is attached to requests there and never enters the agent's environment, so a direct agent-to-shop call fails 401 (no credential exists to steal). A direct agent-to-connector call fails 403: the agent sprite lacks the gate label and Fly's own label policy refuses it. The red crosses in the trust-boundary diagram are not firewall rules we hope hold - they are absent credentials and a provider-enforced policy.",
    },
    {
      question: "What did the two adversarial audits actually find?",
      answer:
        "Audit one returned REQUEST CHANGES with 2 critical overspend paths: a rounding mismatch between the gate's pricing and the ledger's debit math, and trust in client-declared amounts. Both were fixed the same day, before any recording - the gate now prices the cart server-side from its own catalog and whatever total the agent claims is decoration. Audit two attacked the fixed gate with four concurrency shapes - 50 parallel curls, 30 same-tick promises, HTTP pipelining, 200 concurrent $1 executions - and could not break the cap: reserve-before-settle against the append-only ledger serializes every spend decision.",
    },
    {
      question: "What does fail-closed mean here, in practice?",
      answer:
        "Mid-run we freeze the gate process with SIGSTOP - not a polite shutdown. The agent attempts purchases and gets HTTP 000: connection dead, no response at all. There is no fallback path, no gate-unavailable-proceeding-optimistically, no silent pass - purchases are simply impossible. Seconds later the supervisor restarts the gate; the ledger is intact, every cent accounted for. If your safety mechanism has an uptime dependency, the honest question is what happens at 3 AM when it does not have uptime - ours becomes a wall.",
    },
    {
      question: "Is the enforcement real production code or demo code?",
      answer:
        "It is a byte-verified snapshot of the production mmf-255 spend-enforcement module: 59 of 62 files byte-identical to the upstream repo at a pinned commit, with 3 disclosed audit-remediation deltas. It passes the module's 43-vector conformance suite inside the deployment sprite, not just in CI. The honest limit: settlement in the demo is demo-credit, an internal balance - but the enforcement point is payment-rail-agnostic production code, and the cap never depended on the agent cooperating.",
    },
  ],
  claims: [
    {
      id: "c65-verify-20-of-20",
      status: "VERIFIED",
      text: "Clone the repo and run scripts/verify.sh: 20/20 checks pass on a clean machine - vendored mmf-255 byte integrity (59/62 byte-identical to upstream at pinned commit), 43/43 conformance vectors, 17 behavioral attack probes including rounding, replay and concurrency shapes.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/hacksgiving-265",
        },
      ],
    },
    {
      id: "c65-demo-video-live",
      status: "VERIFIED",
      text: "One unedited 1:44 run recorded live: three DENY verdicts on the $113 full-table cart against the $100/24h cap (including two reshuffled-cart retries), then round-four convergence to $95 with a real shop receipt tx_c0ad07149622cd04 - plus adversarial probes and the SIGSTOP kill-test in the same take.",
      evidence: [
        {
          type: "demo",
          url: "https://youtu.be/B0BtgH6Lvko",
        },
      ],
    },
  ],
  content: arcC65CantOverspendContent,
};
