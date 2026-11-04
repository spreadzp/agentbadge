/**
 * SLICE-206-10: OpenAPI x-examples for POST /api/v1/agents/register.
 * Kept in a separate module — agents-register-api.ts is at the
 * max-lines budget; examples are documentation data, not logic.
 */

export const REGISTER_X_EXAMPLES = {
  request: { name: "my-agent", endpoint: "https://agent.example.com" },
  sponsoredRequest: {
    name: "my-agent",
    owner: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
    signature: "0x<eip191-signature>",
    expiresAt: 1762800000,
  },
  response: {
    agent_id: "eip155:5042:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:7",
    registry: "erc-8004",
    registry_tx: "0x<txhash>",
    agent_uri: "data:application/json;base64,…",
    api_key: "agb_<shown-once>",
    tier: "observer",
  },
} as const;
