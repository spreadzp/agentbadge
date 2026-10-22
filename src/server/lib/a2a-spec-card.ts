/**
 * SLICE-203-7: A2A v1.0 agent card for the SDK request handler —
 * proto shape (supportedInterfaces, securityRequirements). Feeds
 * DefaultRequestHandler (version checks + GetExtendedAgentCard).
 *
 * The PUBLIC /.well-known/agent-card.json is generated separately by
 * agent-discovery/agent-card.ts (static manifest) — keep both consistent.
 */

import type { AgentCard } from "@a2a-js/sdk";

export const agentCard = (): AgentCard => {
  const baseUrl = (process.env.BASE_URL ?? "https://agentbadge.xyz").replace(
    /\/$/,
    "",
  );
  const iface = {
    url: `${baseUrl}/a2a`,
    tenant: "",
    protocolVersion: "1.0",
  };
  return {
    name: "agentbadge",
    version: "1.0.0",
    description:
      "AgentBadge A2A agent — agent-readiness scans over the A2A protocol.",
    supportedInterfaces: [
      { ...iface, protocolBinding: "JSONRPC" },
      { ...iface, protocolBinding: "HTTP+JSON" },
    ],
    provider: {
      organization: "AgentBadge",
      url: "https://agentbadge.xyz",
    },
    documentationUrl: `${baseUrl}/.well-known/agent-card.json`,
    iconUrl: "",
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: true,
      extensions: [],
    },
    securitySchemes: {
      eip191: {
        scheme: {
          $case: "apiKeySecurityScheme",
          value: {
            location: "header",
            name: "X-Sig",
            description:
              "EIP-191 personal_sign over the agentbadge-action:v1 canonical challenge. Required headers: X-Agent-Id, X-Wallet, X-Sig, X-Timestamp, X-Nonce (nonce via GET /a2a/challenge). Unsigned or invalid-signature requests downgrade to the anonymous tier.",
          },
        },
      },
      x402: {
        scheme: {
          $case: "apiKeySecurityScheme",
          value: {
            location: "header",
            name: "X-PAYMENT",
            description:
              "x402 payment payload (EIP-3009 USDC authorization) for paid execution tiers.",
          },
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
        name: "agent-scan",
        description:
          "Agent-readiness scan for a domain — send e.g. 'scan example.com'.",
        tags: ["scan", "agent-readiness"],
        examples: ["scan example.com"],
        inputModes: ["text/plain"],
        outputModes: ["application/json"],
      },
      {
        id: "generic",
        name: "generic",
        description:
          "Fallback responder — acknowledges any message and returns a data artifact.",
        tags: ["echo"],
        examples: ["hello"],
        inputModes: ["text/plain"],
        outputModes: ["application/json"],
      },
    ],
    signatures: [],
  } as unknown as AgentCard;
};
