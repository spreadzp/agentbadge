import type { BlogArticle } from "../../blog-data";
import { arcC64OperatorAccountabilityContent } from "./arc-c64-operator-accountability.content";

export const article: BlogArticle = {
  slug: "arc-c64-operator-accountability",
  title:
    "A Name in a Log Is Not a Person - So We Deleted the Shared Admin Key",
  description:
    "EPIC-264 operator accountability, live on agentbadge.xyz: per-operator opk_ credentials (hash-only storage, plaintext once at mint) with a closed capability set - read, probe, workflow, operator-admin - replace the shared ADMIN_API_KEY and self-typed x-operator-id. Knowledge gaps gained assignedTo/assignedBy/assignedAt/dueAt with persisted gap.assign/gap.due events under CAS pins, durable UNIQUE(gapId,dueAt) breach rows, and a 15-minute kill-safe overdue sweeper. SoD now compares credential-derived principals against persisted events - two-PRINCIPAL, honestly not two-person. Break-glass root exists on purpose and alarms on every use.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-25",
  dateModified: "2026-11-25",
  tags: [
    "operator-accountability",
    "per-operator-credentials",
    "separation-of-duties",
    "knowledge-gaps",
    "sla",
    "admin-auth",
    "arc",
    "epic-264",
  ],
  readingTime: "7 min",
  shortAnswer:
    "Our admin console ran on one shared key and an honor-system nametag - the audit trail knew names, not people. A reader on LinkedIn called the bluff in one line: 'a name in a log is not a person until the credential ties to one person.' We agreed in public, shipped per-operator credentials with scoped capabilities, gave the human work queue an owner and a clock, and deleted the shared key from the request path. The only skeleton key left is a break-glass one that alarms on every touch.",
  heroImage: "/images/blog/arc-c64-operator-accountability-hero.webp",
  ogImage: "/images/blog/arc-c64-operator-accountability-og.jpeg",
  status: "LIVE",
  technologies: ["TypeScript", "Bun", "Hono", "PostgreSQL", "Fly.io"],
  entities: [
    "opk-credential",
    "opc-credential-row",
    "op-principal",
    "gap-ownership",
    "gap-breach-record",
    "break-glass",
    "epic-264",
  ],
  concepts: [
    "credential-equals-identity",
    "capability-scoped-auth",
    "two-principal-not-two-person",
    "owner-and-clock",
    "cas-pinned-assignment",
    "durable-breach-record",
    "break-glass-alarms-on-use",
    "honest-limits",
  ],
  topics: [
    "operator-accountability",
    "admin-auth",
    "separation-of-duties",
    "human-oversight",
    "arc",
  ],
  capabilities: [
    "per-operator-credential-mint",
    "capability-gated-admin-routes",
    "sod-from-persisted-events",
    "gap-ownership-assignment",
    "durable-overdue-breach-records",
    "kill-safe-overdue-sweeper",
    "break-glass-with-alerts",
    "last-operator-guard",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/arc-c64-operator-accountability.md",
    },
    {
      type: "read",
      label: "Previous article: x402 payout proofs in DNS",
      url: "https://agentbadge.xyz/blog/arc-c63-payto-proof",
    },
    {
      type: "read",
      label: "The knowledge engine this builds on",
      url: "https://agentbadge.xyz/blog/arc-c59-knowledge-engine",
    },
  ],
  qa: [
    {
      question: "How did the shared admin key break attribution?",
      answer:
        "One ADMIN_API_KEY opened every /admin/* route; the operator name came from a self-typed x-operator-id header, so any key holder could declare any operator string. The audit trail recorded names faithfully - it just had no way to know the name was the caller. Per-operator opk_ credentials make the credential itself the identity: hash-only storage, plaintext shown once at mint, capabilities scoped per credential.",
    },
    {
      question: "What does 'the queue got an owner and a clock' mean in code?",
      answer:
        "Knowledge gap records carry assignedTo/assignedBy/assignedAt/dueAt. Assignment and deadline changes are persisted audit events (gap.assign, gap.due) written under CAS pins (expectedAssignedTo + expectedDueAt) so a reassign cannot stomp a concurrent deadline move. When dueAt passes, a durable UNIQUE(gapId, dueAt) breach row is written; a 15-minute jittered sweeper emits knowledge.gap_overdue per unemitted row, kill-safe via emittedAt catch-up.",
    },
    {
      question: "Is the separation of duties now truly two-person?",
      answer:
        "It is two-PRINCIPAL, honestly not unconditionally two-person: SoD compares the credential-derived principal against the persisted submit event under the transition lock - same principal is a 403 SEPARATION_OF_DUTIES. But one human can still hold two operator accounts, which is a governance question (who provisions), not a code one. We documented that accepted risk instead of pretending a capability bit creates a second person.",
    },
    {
      question: "What is the break-glass key and why does it exist?",
      answer:
        "A deliberately-armed shared recovery credential (ADMIN_BREAK_GLASS_ENABLED) with read + workflow capabilities only - it can clear a lockout but cannot mint credentials. Every presentation fires an operator_admin.break_glass USE alert, even refused ones. A root that always phones home is a design choice: you cannot delete the recovery path, so you make it loud.",
    },
  ],
  claims: [
    {
      id: "c64-operator-creds-live",
      status: "VERIFIED",
      text: "Production runs per-operator opk_ credentials: first human operator paul-spread (op_01M894P0SFJ2M6KCSKQTZ07R22) seeded via one-shot OPERATOR_SEED_JSON (env wiped on read, unset post-provisioning), six scoped service credentials minted via the admin API - each mutation audit-stamped with the acting op_* principal.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/docs/EPICS/264-operator-accountability/evidence/prod-verify-264.md",
        },
      ],
    },
    {
      id: "c64-admin-sweep-196",
      status: "VERIFIED",
      text: "Probe sweep of the whole /admin/* surface on agentbadge.xyz: 196 probes, 196 PASS - every unauthorized request returns 401 with Cache-Control: no-store, and the auth battery (valid/revoked/disabled/insufficient-capability/junk/wrong-format) returns 6/6 expected statuses.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/docs/EPICS/264-operator-accountability/evidence/prod-verify-264.md",
        },
      ],
    },
    {
      id: "c64-sod-under-cred",
      status: "VERIFIED",
      text: "SoD is enforced from credential-derived principals against persisted audit events under the transition lock: on prod, probe-a submitted, probe-b verified, probe-b's own publish was refused - the item is stranded at VERIFIED as designed, with the event trail attributing each transition to a distinct op_* credential.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/docs/EPICS/264-operator-accountability/evidence/prod-verify-264.md",
        },
      ],
    },
    {
      id: "c64-gap-ownership-durable-breach",
      status: "VERIFIED",
      text: "Knowledge gaps carry assignedTo/assignedBy/assignedAt/dueAt with persisted gap.assign/gap.due events under CAS pins (expectedAssignedTo + expectedDueAt); overdue writes durable UNIQUE(gapId, dueAt) breach rows emitted by a 15-minute kill-safe sweeper, and reopen clears the ownership tuple while the reopened event snapshots the previous owner and lapsed deadline.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/knowledge/gaps-ownership.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/knowledge/overdue-sweep.ts",
        },
      ],
    },
    {
      id: "c64-break-glass-alarmed",
      status: "VERIFIED",
      text: "Break-glass drill on prod: ADMIN_BREAK_GLASS_ENABLED armed use returns 200 on a read surface and 403 on operator-admin surfaces (cannot mint credentials), and operator_admin.break_glass USE warn fires on every presentation including refused ones.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/docs/EPICS/264-operator-accountability/evidence/prod-verify-264.md",
        },
      ],
    },
  ],
  content: arcC64OperatorAccountabilityContent,
};
