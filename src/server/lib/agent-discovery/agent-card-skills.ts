/**
 * EPIC-233 (SLICE-233-7): A2A skills array for agent-card.json —
 * extracted from agent-card.ts (ESLint max-lines). Data-only module.
 */
export const agentCardSkills = [
      {
        id: "agent-scan",
        name: "Agent Readiness Scan",
        description: "Scan a domain for agent-readiness rules (AB-001..AB-0xx)",
        tags: ["scan", "readiness", "compliance"],
        examples: ["scan example.com"],
      },
      {
        id: "passport-issuance",
        name: "Agent Passport NFT",
        description: "Issue agent passport NFTs via x402 payment",
        tags: ["identity", "nft", "passport"],
      },
      {
        id: "marketplace",
        name: "Agent Marketplace",
        description: "Post, claim and settle agent tasks with on-chain escrow",
        tags: ["marketplace", "escrow", "tasks"],
      },
      {
        id: "task-board",
        name: "Arc Task Board",
        description:
          "Claim board tasks, submit deliverables and receive an EIP-712-signed task receipt — workflow at /agent-guide/hire-or-get-hired",
        tags: ["tasks", "board", "receipt", "escrow"],
        examples: ["list open board tasks", "claim task board_x"],
      },
      {
        id: "request-inbox",
        name: "Agent Request Inbox",
        description:
          "Free async request queue: POST /api/requests → request_id, poll GET /api/requests/:id for the completed response; GET /api/requests/qa?q= searches the Q&A corpus for instant answers",
        tags: ["request", "inbox", "async", "qa"],
        examples: ["submit a request", "poll request status", "search Q&A"],
      },
      {
        id: "agent-surveys",
        name: "Agent Surveys",
        description:
          "Answer open surveys: GET /api/surveys/open lists them, POST /api/surveys/:id/answer submits; verified agents earn rating milestones toward the passport",
        tags: ["survey", "rating", "milestone"],
        examples: ["list open surveys", "answer a survey"],
      },
      {
        // SLICE-256-5: WebMCP v2 — keyless browser-side tools registered
        // via document.modelContext on scoped pages; catalog at
        // /.well-known/webmcp.json, programmatic twin at /mcp/public.
        id: "webmcp-tools",
        name: "WebMCP Browser Tools",
        description:
          "Keyless in-browser tools via document.modelContext: readiness scan, verdict/risk checks, marketplace browse, async Request Inbox (submit-request → poll-request, ops answers in hours–days), public Q&A search. Tool catalog: /.well-known/webmcp.json",
        tags: ["webmcp", "browser", "keyless", "tools"],
        examples: ["submit a request to the inbox", "poll a request"],
      },
      {
        // SLICE-233-7: keyless agent-protocol MCP surface — pointer to
        // the canonical manifest, never a copied spec (D-233-3).
        id: "agent-interaction",
        name: "Agent Interaction Protocol",
        description:
          "Keyless JSON-RPC tool surface for agents at POST /mcp/agent-interaction (discover, ask, request inbox, feedback, reviews, knowledge search) — thin adapters over the public REST services. Canonical manifest: /.well-known/agent-interaction.json",
        tags: ["mcp", "keyless", "agent-protocol", "tools"],
        examples: ["tools/list on /mcp/agent-interaction", "create a task request"],
      },
      {
        // SLICE-203-7: FallbackExecutor over the A2A surface — deterministic
        // ack + data artifact for any message without a scan domain.
        id: "generic",
        name: "Generic Fallback",
        description:
          "Fallback responder on the A2A interface — acknowledges any message and returns a data artifact.",
        tags: ["fallback", "a2a"],
        examples: ["hello"],
      },
    ];
