import type { BlogArticle } from "../../blog-data";
import { arcC68ProcessMappingContent } from "./arc-c68-process-mapping.content";

export const article: BlogArticle = {
  slug: "arc-c68-process-mapping",
  title:
    "We Taught the Ledger to Answer \"What Process Was This?\" - and It Would Rather Say \"Partial\" Than Guess",
  description:
    "EPIC-236 Process Mapping & Actor Resolution, live on agentbadge.xyz: a read-side interpretation layer over the immutable econ-events ledger. An adapter registry maps sources to typed ProcessEventProjections (supply-chain@0.3.0 claims its stream plus venue deliver/verify), a four-rail actor resolver walks SYSTEM → ERC-8004 → principal → wallet, and lazy versioned projections answer SUPPORTED/PARTIAL/UNSUPPORTED/AMBIGUOUS - naming unresolved fields instead of guessing. Nothing is written back to the ledger.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-28",
  dateModified: "2026-11-28",
  tags: [
    "process-mapping",
    "event-sourcing",
    "actor-resolution",
    "read-model",
    "supply-chain",
    "arc",
    "epic-236",
  ],
  readingTime: "8 min",
  shortAnswer:
    "The economic event ledger is append-only and honest about what happened, but each row is just a kind, some actors, and a payload. EPIC-236 added a read-side interpretation layer: an adapter registry maps events to typed ProcessEventProjections, an actor resolver walks four identity rails, and the API answers SUPPORTED, PARTIAL, UNSUPPORTED, or AMBIGUOUS - naming exactly which fields it could not resolve instead of guessing. Nothing was written back to the ledger.",
  heroImage: "/images/blog/arc-c68-process-mapping-hero.webp",
  ogImage: "/images/blog/arc-c68-process-mapping-og.jpeg",
  status: "LIVE",
  technologies: ["TypeScript", "Bun", "Hono", "Zod", "Vitest"],
  entities: [
    "process-event-projection",
    "economic-event",
    "actor-ref",
    "asset-ref",
    "adapter-registry",
    "epic-236",
  ],
  concepts: [
    "read-side-projection",
    "honest-partial-status",
    "adapter-registry",
    "identity-rail-precedence",
    "versioned-lazy-materialization",
    "claim-scope-discipline",
    "source-event-roundtrip",
    "append-only-ledger",
    "forwards-compatible-unsupported",
  ],
  topics: [
    "process-mapping",
    "event-sourcing",
    "agent-economy",
    "trust",
    "arc",
  ],
  capabilities: [
    "get-projection-by-event-id",
    "get-stream-history-by-source-id",
    "historical-adapter-version-read",
    "typed-issue-reporting",
    "unmapped-unsupported-fallback",
    "four-rail-actor-resolution",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/arc-c68-process-mapping.md",
    },
    {
      type: "read",
      label: "Try it: projections for a live supply chain",
      url: "https://agentbadge.xyz/api/process/projections?source=supply_chain&sourceId=dogfood-1794151620383",
    },
    {
      type: "read",
      label: "Previous article: shadow-first AI",
      url: "https://agentbadge.xyz/blog/arc-c67-shadow-first-ai",
    },
  ],
  qa: [
    {
      question: "What is the process projection API on agentbadge.xyz?",
      answer:
        "GET /api/process/projections serves typed ProcessEventProjections over the immutable econ-events ledger. Query a single event by id (optionally ?version= for a historical adapter interpretation) or a whole stream by ?source&sourceId - for example source=supply_chain&sourceId=dogfood-1794151620383 returns 13 events in seq order, each with kind, status, adapter version, issues, and the interpreted projection (stepType, subjectRefs, actorRefs, domainData).",
    },
    {
      question: "What do SUPPORTED, PARTIAL, UNSUPPORTED and AMBIGUOUS mean in a process projection?",
      answer:
        "SUPPORTED means every actor slot resolved through an identity rail and a subject AssetRef exists. PARTIAL means the projection is valid but names which fields could not resolve - for example ACTOR_UNRESOLVED on actor, counterparty, or roles.custodian with the raw address attached. UNSUPPORTED means no adapter claims that event type (TYPE_UNKNOWN) or the kind is not mapped yet - still a valid 200 response. AMBIGUOUS means two registry refs resolve the same actor to different entities and the conflict is reported rather than guessed.",
    },
    {
      question: "How does the actor resolver identify wallet addresses?",
      answer:
        "Raw actor strings walk four identity rails, strongest first: the SYSTEM registry (internal principals like board, ops, x402), the ERC-8004 passport registry, the API principal registry, then the wallet itself. A wallet with a confirmed agentId resolves on the chain of that registry link - the same address on a different chain is a different identity. Missing chain context yields UNRESOLVED rather than a fabricated eip155 reference; conflicting refs yield AMBIGUOUS.",
    },
    {
      question: "Why does the live supply chain show PARTIAL on production?",
      answer:
        "The one live supply-chain run (dogfood-1794151620383) executed on throwaway test wallets that were never registered in any identity rail, so every actor-bearing projection honestly reports ACTOR_UNRESOLVED per field instead of fabricating SUPPORTED. SUPPORTED projections are proven in CI fixtures (21 real emitted events with digest manifests) and synthetic tests; a live SUPPORTED requires a chain whose actors are registered.",
    },
    {
      question: "How are projection versions handled on agentbadge.xyz?",
      answer:
        "Projections are lazily materialized and cached under (eventId, adapter, version); rows are never overwritten. Adapter bumps follow semver rules - a new kind mapping is minor, a changed interpretation is major. ?version= reads a historical interpretation (?version=0.3.0 returns 200 on the live chain), while an unknown version returns 404 rather than computing an interpretation under a wrong label.",
    },
  ],
  claims: [
    {
      id: "c68-projection-api-live",
      status: "VERIFIED",
      text: "GET /api/process/projections/:eventId and GET /api/process/projections?source&sourceId are live on prod: the supply_chain stream for dogfood-1794151620383 returns 13 events in seq order with per-event status, adapter version 0.3.0, issues, and interpreted projections; ?version=0.3.0 returns the materialized interpretation and ?version=9.9.9 returns 404. Unknown event ids return 404, malformed ids 400 - verified 9/9 PASS by independent cloud Devin run (bugs: none).",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/routes/process/process-api.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/process/projections/materialize.ts",
        },
      ],
    },
    {
      id: "c68-honest-statuses",
      status: "VERIFIED",
      text: "Projection statuses are honest, never fabricated: PARTIAL carries typed issues naming each unresolved field (ACTOR_UNRESOLVED on actor/counterparty/roles.custodian with raw address), UNSUPPORTED is a valid 200 projection for unclaimed sources or unmapped kinds (TYPE_UNKNOWN), AMBIGUOUS reports conflicting resolutions, and SUPPORTED requires all actor slots resolved plus a subject AssetRef. On prod the live chain shows PARTIAL because its actors are unregistered throwaway wallets.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/process/adapters/supply-chain.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/process/projections/types.ts",
        },
      ],
    },
    {
      id: "c68-actor-resolver-rails",
      status: "VERIFIED",
      text: "The actor resolver walks four rails strongest-first - SYSTEM registry, ERC-8004 passport registrations, API principal registry, wallet - resolving a wallet on the chain of its confirmed registration link, not the event's chain guess. Missing chain context produces UNRESOLVED (never a fabricated eip155 ref); conflicting refs on different entities produce AMBIGUOUS; offline/unreachable stores produce UNRESOLVED.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/process/resolver/actor-resolver.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/config/system-actors.ts",
        },
      ],
    },
    {
      id: "c68-versioned-lazy-store",
      status: "VERIFIED",
      text: "The projection store is a rebuildable cache keyed on (eventId, adapter, version) that never overwrites existing rows: materialization is lazy on first request, ?version= serves historical adapter interpretations, unknown versions return 404, and adapter semver rules (minor for new kind mappings, major for changed interpretations) are written into the adapter docstring.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/process/projections/store.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/process/adapters/index.ts",
        },
      ],
    },
    {
      id: "c68-verification-arc",
      status: "VERIFIED",
      text: "EPIC-236 passed production verification: independent cloud Devin run 9/9 PASS with bugs: none (reported to Telegram as message_id=46), owner script scripts/verify-epic-236.sh prod reports 17 PASS / 0 FAIL including a burst that tripped the process limiter into 36x 429, and the CI suite holds 51 process tests plus 21 real emitted fixture events with canonical digest manifests.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/scripts/verify-epic-236.sh",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/tests/process/dogfood-fixtures.test.ts",
        },
      ],
    },
  ],
  content: arcC68ProcessMappingContent,
};
