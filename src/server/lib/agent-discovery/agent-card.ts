/**
 * EPIC-178 (SLICE-178-2): pure builder for `.well-known/agent-card.json`.
 * Zero IO — every value comes from `DiscoverySources`. Registered in
 * manifests.ts; routes/gen script are generic.
 *
 * Canonical spec (EPIC-178 §Каноническая спека, verified):
 * - agent-card.json → A2A v1.0, `application/a2a+json`
 */

import { agentCardAuthBlock } from "../did-auth-docs";
import { BRAND_DISAMBIGUATION } from "../brand";
import type { DiscoverySources } from "./sources";

const json = (v: unknown): string => JSON.stringify(v, null, 2) + "\n";

/**
 * F6 (D-218-4): contract keys with no configured address are omitted
 * from the card rather than serialized as `""` — an empty string is not
 * a contract address and breaks schema consumers. If no contracts are
 * configured for a chain, the `contracts` key itself is dropped.
 */
function withContracts(
  contracts: Record<string, string | undefined>,
): { contracts?: Record<string, string> } {
  const entries = Object.entries(contracts).filter(
    (entry): entry is [string, string] => Boolean(entry[1]),
  );
  return entries.length ? { contracts: Object.fromEntries(entries) } : {};
}

export function buildAgentCard(src: DiscoverySources): string {
  const b = src.baseUrl;
  const env = src.wellKnownEnv;
  return json({
    name: "AgentBadge",
    description:
      src.apiInfo?.description ??
      "Agent readiness scanner + x402 paid services on Arc",
    version: src.apiInfo?.version ?? "0.0.0",
    provider: { organization: "AgentBadge", url: b },
    supportedInterfaces: [
      // SLICE-203-7: /a2a now serves the real A2A v1.0 surface — JSON-RPC
      // (preferred, SDK transports select it first) + REST HTTP+JSON.
      {
        url: `${b}/a2a`,
        protocolBinding: "JSONRPC",
        tenant: "",
        protocolVersion: "1.0",
      },
      {
        url: `${b}/a2a`,
        protocolBinding: "HTTP+JSON",
        tenant: "",
        protocolVersion: "1.0",
      },
    ],
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: true,
    },
    securitySchemes: {
      // A2A v1.0 proto-wire scheme shape (SDK AgentCard.fromJSON parses this).
      eip191: {
        apiKeySecurityScheme: {
          location: "header",
          name: "X-Sig",
          description:
            "EIP-191 personal_sign over the agentbadge-action:v1 canonical challenge. Required headers: X-Agent-Id, X-Wallet, X-Sig, X-Timestamp, X-Nonce (nonce via GET /a2a/challenge). Unsigned or invalid requests downgrade to the anonymous tier.",
        },
      },
      x402: {
        apiKeySecurityScheme: {
          location: "header",
          name: "X-PAYMENT",
          description:
            "x402 payment payload (EIP-3009 USDC authorization, exact on Arc) for paid execution tiers.",
        },
      },
    },
    securityRequirements: [
      { schemes: { eip191: { list: [] } } },
      { schemes: { x402: { list: [] } } },
    ],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
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
        // SLICE-203-7: FallbackExecutor over the A2A surface — deterministic
        // ack + data artifact for any message without a scan domain.
        id: "generic",
        name: "Generic Fallback",
        description:
          "Fallback responder on the A2A interface — acknowledges any message and returns a data artifact.",
        tags: ["fallback", "a2a"],
        examples: ["hello"],
      },
    ],
    documentationUrl: "https://agentbadge.gitbook.io/agentbadge-docs",
    // Vendor extension block — legacy AgentBadge fields kept under one
    // namespaced key so the canonical A2A shape stays clean.
    "x-agentbadge": {
      capabilities: [
        "passport_issuance",
        "passport_verification",
        "agent_directory",
        "a2a_messaging",
        "marketplace",
        "audit_trail",
        "did_resolution",
        "compliance_checking",
        "agent_skills_discovery",
        "web_bot_auth",
        "agency_services",
        "work_requests",
        "demand_registry",
        "on_chain_scan_recording",
        "trust_badge_minting",
        "keeperhub_workflows",
        "cross_chain_task_verification",
        "attestcoin_protocol",
        "task_board",
        "task_receipts",
        "request_inbox",
        "agent_surveys",
        "webmcp",
      ],
      // SLICE-256-5: registry-driven WebMCP v2 tool names — honest
      // inventory, never hand-maintained (absent when source missing).
      ...(src.webmcp
        ? {
            webmcp_tools: src.webmcp.tools.map((t) => t.name),
            webmcp_tool_count: src.webmcp.tools.length,
          }
        : {}),
      disambiguation: BRAND_DISAMBIGUATION, // SLICE-259-25: vs unscoped npm `agentbadge`
      endpoints: {
        api: `${b}/api/specs`,
        docs: "https://agentbadge.gitbook.io/agentbadge-docs",
        documentation: "https://agentbadge.gitbook.io/agentbadge-docs",
        mcp: `${b}/mcp`,
        mcp_public: `${b}/mcp/public`,
        webmcp_json: `${b}/.well-known/webmcp.json`,
        gitbook_mcp:
          "https://agentbadge.gitbook.io/agentbadge-docs/~gitbook/mcp",
        llms_txt: `${b}/llms.txt`,
        llms_full_txt: `${b}/llms-full.txt`,
        agent_workflows: `${b}/.well-known/agent-workflows.json`, // SLICE-259-18 (v1)
        // SLICE-206-9: machine-readable price list (USDC, x402 flags)
        pricing_json: `${b}/pricing.json`,
        pricing_md: `${b}/pricing.md`,
        // SLICE-206-8: 3-call onboarding walkthrough
        getting_started: `${b}/agent-guide/getting-started`,
        guides: `${b}/agent-guide/context`,
        did_resolver: `${b}/did/{did}`,
        api_catalog: `${b}/.well-known/api-catalog`,
        oauth_protected_resource: `${b}/.well-known/oauth-protected-resource`,
        erc8004: `${b}/.well-known/erc8004-agent.json`,
        mcp_server_card: `${b}/.well-known/mcp/server-card.json`,
        auth_md: `${b}/auth.md`,
        verification_md: `${b}/verification.md`,
        reputation_md: `${b}/reputation.md`,
        agent_skills: `${b}/.well-known/agent-skills/index.json`,
        web_bot_auth: `${b}/.well-known/http-message-signatures-directory`,
        http_message_signatures: `${b}/.well-known/http-message-signatures-directory`,
        agency_json: `${b}/agency.json`,
        services: `${b}/services`,
        team_capabilities: `${b}/agent-guide/team/capabilities`,
        heartbeat_md: `${b}/heartbeat.md`,
        skill_json: `${b}/skill.json`,
        team_capabilities_json: `${b}/agent-guide/team/capabilities.json`,
        team_services: `${b}/agent-guide/team/services`,
        team_availability: `${b}/agent-guide/team/availability`,
        team_contact: `${b}/agent-guide/team/contact`,
        team_match: `${b}/agent-guide/team/match`,
        work_requests: `${b}/api/work-requests`,
        demand_request: `${b}/api/demand/request`,
        // SLICE-259-19: copy-pasteable ?q= example — bare-400 without q
        // was the top agent error on this surface.
        qa_search_example: `${b}/api/requests/qa?q=how+do+I+verify+a+verdict`,
        agents_txt: `${b}/agents.txt`,
        keeperhub_scan: `${b}/api/keeperhub/scan`,
        board: `${b}/api/board/cards`,
        board_guide: `${b}/agent-guide/hire-or-get-hired`,
        task_receipt_schema: `${b}/.well-known/task-receipt.schema.json`,
        audit_stream: `${b}/audit/stream`,
        audit_webhook: `${b}/audit/webhook`,
        attestcoin_tasks: `${b}/api/attestcoin/tasks`,
        attestcoin_verify: `${b}/api/attestcoin/verify`,
        attestcoin_demo: `${b}/hackathon/attestcoin`,
      },
      auth: agentCardAuthBlock(b),
      "ab:payment": {
        protocol: "x402",
        scheme: "exact",
        // EPIC-194-7 audit (M-6): payments run on Arc USDC, not Hedera HBAR —
        // the hederaNetwork env describes HCS topics, not the payment rail.
        network: `eip155:${env?.evmChainId ?? "5042"}`,
        asset: "USDC",
        facilitator: env?.facilitatorUrl,
      },
      blockchain: {
        // SLICE-218-8 (D-218-11/13): EVM-first — Arc is the primary
        // settlement network (matches ab:payment). The Hedera/HCS
        // identity stack stays readable under `legacy` — existing
        // agents keep working; new agents mint on EVM.
        network: `eip155:${env?.evmChainId ?? "5042"}`,
        asset: "USDC",
        legacy: {
          network: env?.hederaNetwork ?? "testnet",
          stack: "Hedera testnet (HCS/HBAR)",
          note: "Legacy identity stack — read-only verify. Deprecated for new agents: EVM passport mint + Arc Task Board + USDC.",
          passport_token_id: env?.passportTokenId,
          directory_topic_id: env?.directoryTopicId,
          audit_topic_id: env?.auditTopicId,
        },
        multi_chain: {
          base_sepolia: {
            chain_id: 84532,
            ...withContracts({
              trust_registry: env?.contracts?.trustRegistry,
              trust_badge: env?.contracts?.trustBadge,
              agent_passport: env?.contracts?.agentPassportBase,
            }),
            purpose:
              "On-chain scan recording, TrustBadge soulbound NFT, AgentPassport NFT via KeeperHub",
          },
          ethereum_sepolia: {
            chain_id: 11155111,
            ...withContracts({ task_escrow: env?.contracts?.taskEscrow }),
            purpose: "Attestcoin cross-chain task posting",
          },
          creditcoin_testnet: {
            chain_id: 1023,
            ...withContracts({
              task_marketplace_asc: env?.contracts?.taskMarketplaceAsc,
              task_state: env?.contracts?.taskState,
            }),
            purpose: "Attestcoin cross-chain task verification and lifecycle",
          },
        },
      },
    },
  });
}
