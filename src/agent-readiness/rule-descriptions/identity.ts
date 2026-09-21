import type { RuleDescription } from "./index";

export const identityRules: RuleDescription[] = [
  {
    rule_id: "AB-056",
    category: "identity",
    icon: "🪪",
    title: "WebFinger Identity Lookup",
    short_description: "Your site can answer 'who is this?' queries from AI agents.",
    user_value: "Agents need to verify your identity before trusting your API. Without this, you're an anonymous server that agents will avoid.",
    wrong_example: "No identity endpoint. Agents have no way to verify who you are.",
    right_example: "Agents can look up your identity and confirm you're a legitimate service.",
    effort_hint: "moderate",
    estimated_cost: "$10-50",
  },
  {
    rule_id: "AB-057",
    category: "identity",
    icon: "🆔",
    title: "DID Document",
    short_description: "Your site provides a Decentralized Identifier document for on-chain identity verification.",
    user_value: "A DID document lets agents verify your identity on the blockchain, providing cryptographic proof of who you are.",
    wrong_example: "No DID document. Agents can't verify your identity cryptographically.",
    right_example: "A DID document provides cryptographic proof of your identity.",
    effort_hint: "complex",
    estimated_cost: "$100+",
  },
  {
    rule_id: "AB-112",
    category: "identity",
    icon: "key",
    title: "OAuth Authorization Server metadata (RFC 9728)",
    short_description: "OAuth Authorization Server Metadata published at /.well-known/oauth-authorization-server.",
    user_value: "Agents discover OAuth endpoints (authorization, token, introspection) through this metadata per RFC 9728.",
    wrong_example: "No /.well-known/oauth-authorization-server endpoint.",
    right_example: "{ \"issuer\": \"https://api.example.com\", \"authorization_endpoint\": \"...\", \"token_endpoint\": \"...\" } at /.well-known/oauth-authorization-server.",
    effort_hint: "moderate",
    estimated_cost: "$0",
  }
];
