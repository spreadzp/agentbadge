/**
 * EPIC-178 (SLICE-178-2): pure builder for `.well-known/agent-card.json`.
 * Zero IO — every value comes from `DiscoverySources`. Registered in
 * manifests.ts; routes/gen script are generic.
 *
 * Canonical spec (EPIC-178 §Каноническая спека, verified):
 * - agent-card.json → A2A v1.0, `application/a2a+json`
 */

import { agentCardAuthBlock } from "../did-auth-docs";
import type { DiscoverySources } from "./sources";

const json = (v: unknown): string => JSON.stringify(v, null, 2) + "\n";

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
      { url: `${b}/a2a`, protocolBinding: "HTTP+JSON", protocolVersion: "1.0" },
    ],
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: true,
    },
    securitySchemes: {
      x402: {
        type: "http",
        scheme: "x402",
        description: "x402 exact on Arc USDC",
      },
    },
    security: [{ x402: [] }],
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
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
      ],
      endpoints: {
        api: `${b}/api/specs`,
        docs: "https://agentbadge.gitbook.io/agentbadge-docs",
        documentation: "https://agentbadge.gitbook.io/agentbadge-docs",
        mcp: `${b}/mcp`,
        gitbook_mcp:
          "https://agentbadge.gitbook.io/agentbadge-docs/~gitbook/mcp",
        llms_txt: `${b}/llms.txt`,
        llms_full_txt: `${b}/llms-full.txt`,
        guides: `${b}/agent-guide/context`,
        did_resolver: `${b}/did`,
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
        agents_txt: `${b}/agents.txt`,
        keeperhub_scan: `${b}/api/keeperhub/scan`,
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
        network: env?.hederaNetwork ?? "testnet",
        passport_token_id: env?.passportTokenId,
        directory_topic_id: env?.directoryTopicId,
        audit_topic_id: env?.auditTopicId,
        multi_chain: {
          base_sepolia: {
            chain_id: 84532,
            contracts: {
              trust_registry: env?.contracts?.trustRegistry ?? "",
              trust_badge: env?.contracts?.trustBadge ?? "",
              agent_passport: env?.contracts?.agentPassportBase ?? "",
            },
            purpose:
              "On-chain scan recording, TrustBadge soulbound NFT, AgentPassport NFT via KeeperHub",
          },
          ethereum_sepolia: {
            chain_id: 11155111,
            contracts: { task_escrow: env?.contracts?.taskEscrow ?? "" },
            purpose: "Attestcoin cross-chain task posting",
          },
          creditcoin_testnet: {
            chain_id: 1023,
            contracts: {
              task_marketplace_asc: env?.contracts?.taskMarketplaceAsc ?? "",
              task_state: env?.contracts?.taskState ?? "",
            },
            purpose: "Attestcoin cross-chain task verification and lifecycle",
          },
        },
      },
    },
  });
}
