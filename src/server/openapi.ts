import z from "zod";

// ─── Shared Zod schemas for OpenAPI documentation ─────────────────

export const tierSchema = z.enum(["bronze", "silver", "gold", "platinum"]);

export const capabilitySchema = z.enum([
  "api_call",
  "payment",
  "data_provide",
  "data_consume",
  "orchestration",
]);

export const errorSchema = z.object({
  error: z.string().describe("Human-readable error message"),
  code: z.string().describe("Machine-readable error code (stable constant)"),
  retryable: z.boolean().optional().describe("Whether the request can be retried"),
  hint: z.string().optional().describe("Suggested action for the caller"),
});

// ─── Payment schemas (SLICE-67-3) ───────────────────────────────

export const checkoutRequestSchema = z.object({
  productId: z.string().describe("Product identifier (e.g. passport-bronze, directory-listing)"),
  email: z.string().email().optional().describe("Customer email for Stripe Checkout"),
  metadata: z.record(z.string(), z.string()).optional().describe("Additional metadata (accountId, name, etc.)"),
});

export const checkoutResponseSchema = z.object({
  url: z.string().url().describe("Stripe Checkout URL to redirect the customer to"),
  sessionId: z.string().describe("Stripe Checkout Session ID"),
});

// ─── HATEOAS link schemas (SLICE-17-7) ──────────────────────────

export const linkSchema = z.object({
  href: z.string(),
  method: z.enum(["GET", "POST"]).optional().describe("HTTP method (default GET)"),
});

export const linksSchema = z.record(z.string(), linkSchema);

export const passportRequestSchema = z.object({
  accountId: z.string(),
  signature: z.string(),
  tier: tierSchema,
  name: z.string(),
  capabilities: z.array(capabilitySchema),
  endpoint: z.string().optional(),
});

export const passportResponseSchema = z.object({
  tokenId: z.string(),
  serialNumber: z.number(),
  did: z.string(),
  tier: tierSchema,
  hashScanLink: z.string(),
  _links: linksSchema.optional(),
});

export const passportInfoSchema = z.object({
  active: z.boolean(),
  tokenId: z.string(),
  serialNumber: z.number(),
  tier: tierSchema.nullable(),
  capabilities: z.array(capabilitySchema),
  did: z.string(),
  owner: z.string(),
  issuedAt: z.number(),
  endpoint: z.string().optional(),
  _links: linksSchema.optional(),
});

export const registerAgentSchema = z.object({
  did: z.string(),
  tokenId: z.string(),
  serial: z.number(),
  accountId: z.string(),
  name: z.string(),
  capabilities: z.array(capabilitySchema),
  endpoint: z.string(),
  tier: tierSchema,
});

export const upgradeRequestSchema = z.object({
  newTier: tierSchema,
  accountId: z.string(),
});

export const revokeRequestSchema = z.object({
  tokenId: z.string(),
  serial: z.number(),
  reason: z.string(),
});

export const catalogTierSchema = z.object({
  name: tierSchema,
  price: z.number(),
  capabilities: z.array(capabilitySchema),
});

export const auditEventSchema = z.object({
  type: z.string(),
  did: z.string().optional(),
  tokenId: z.string().optional(),
  serial: z.number().optional(),
  timestamp: z.number().optional(),
  tier: z.string().optional(),
  oldTier: z.string().optional(),
  newTier: z.string().optional(),
  reason: z.string().optional(),
});

export const directoryEntrySchema = z.object({
  did: z.string(),
  tokenId: z.string(),
  serial: z.number(),
  accountId: z.string(),
  name: z.string(),
  capabilities: z.array(capabilitySchema),
  endpoint: z.string(),
  tier: tierSchema,
  timestamp: z.number(),
});

export const agentWithActiveSchema = directoryEntrySchema.extend({
  active: z.boolean(),
  skills: z.array(z.string()).optional(),
  _links: linksSchema.optional(),
});

export const listAgentsResponseSchema = z.object({
  agents: z.array(agentWithActiveSchema),
  count: z.number().describe("Number of agents in this page"),
  total: z.number().describe("Total agents matching filters"),
  limit: z.number(),
  offset: z.number(),
});

// ─── Search schemas (SLICE-17-6) ────────────────────────────────

export const searchResultSchema = z.object({
  query: z.string(),
  results: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("agent"),
        did: z.string(),
        name: z.string(),
        tier: z.string(),
        capabilities: z.array(z.string()),
        skills: z.array(z.string()).optional(),
        active: z.boolean(),
      }),
      z.object({
        type: z.literal("task"),
        taskId: z.string(),
        title: z.string(),
        priceHbar: z.number(),
        capabilities: z.array(z.string()),
        status: z.string(),
      }),
    ]),
  ),
  count: z.number(),
});

// ─── A2A Messaging schemas ───────────────────────────────────────

export const sendMessageRequestSchema = z.object({
  from: z.string().min(1).describe("Sender DID (did:hcs:tokenId:serial)"),
  to: z.string().min(1).describe("Recipient DID (did:hcs:tokenId:serial)"),
  body: z.string().min(1).max(4096).describe("Message content (max 4KB)"),
  contentType: z.string().optional().default("text/plain"),
});

export const sendMessageResponseSchema = z.object({
  txId: z.string().describe("HCS transaction ID"),
  messageId: z.string().describe("Consensus timestamp (for later query)"),
  timestamp: z.number().describe("Unix seconds"),
});

export const inboxMessageSchema = z.object({
  from: z.string(),
  to: z.string(),
  body: z.string(),
  contentType: z.string(),
  timestamp: z.number(),
  txId: z.string(),
  consensusTimestamp: z.string().optional(),
});

export const getInboxResponseSchema = z.object({
  messages: z.array(inboxMessageSchema),
  count: z.number(),
});

export const conversationMessageSchema = inboxMessageSchema.extend({
  direction: z.enum(["A→B", "B→A"]),
});

export const getConversationResponseSchema = z.object({
  didA: z.string(),
  didB: z.string(),
  messages: z.array(conversationMessageSchema),
  count: z.number(),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

// ─── Marketplace schemas ─────────────────────────────────────────

export const postTaskRequestSchema = z.object({
  posterDid: z.string().min(1).describe("Poster DID (did:hcs:tokenId:serial)"),
  title: z.string().min(1).max(200).describe("Task title"),
  description: z.string().min(1).max(4096).describe("Task description"),
  priceHbar: z.number().positive().describe("Price in HBAR"),
  capabilities: z.array(z.string()).min(1).describe("Required capabilities"),
  deadline: z.number().optional().describe("Deadline as unix timestamp"),
});

export const postTaskResponseSchema = z.object({
  txId: z.string().describe("HCS transaction ID"),
  taskId: z.string().describe("Generated task ID"),
  timestamp: z.number().describe("Unix seconds"),
});

export const cachedTaskSchema = z.object({
  taskId: z.string(),
  posterDid: z.string(),
  title: z.string(),
  description: z.string(),
  priceHbar: z.number(),
  capabilities: z.array(z.string()),
  deadline: z.number().optional(),
  status: z.enum(["posted", "claimed", "delivered", "completed"]),
  claimerDid: z.string().optional(),
  resultBody: z.string().optional(),
  resultIpfs: z.string().optional(),
  paymentTxId: z.string().optional(),
  txId: z.string(),
  consensusTimestamp: z.string(),
  createdAt: z.number(),
});

export const listTasksResponseSchema = z.object({
  tasks: z.array(cachedTaskSchema),
  count: z.number(),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export const preparePaymentRequestSchema = z.object({
  posterDid: z.string().min(1).describe("Poster DID (did:hcs:tokenId:serial)"),
});

export const preparePaymentResponseSchema = z.object({
  txBytes: z.string().describe("Base64-encoded frozen transaction bytes for offline signing"),
  txId: z.string().describe("Transaction ID"),
  fromAccountId: z.string().describe("Poster's Hedera account ID (source)"),
  toAccountId: z.string().describe("Claimer's Hedera account ID (destination)"),
  amountHbar: z.number().describe("Amount in HBAR"),
});

export const completeTaskRequestSchema = z.object({
  posterDid: z.string().min(1).describe("Poster DID (did:hcs:tokenId:serial)"),
  txBytes: z.string().optional().describe("Base64-encoded frozen transaction bytes from prepare-payment"),
  publicKey: z.string().optional().describe("Signer's public key (DER-encoded hex)"),
  signature: z.string().optional().describe("Base64-encoded signature of the transaction bytes"),
  posterPrivateKey: z.string().optional().describe("Poster's private key (legacy mode, not recommended)"),
});

export const completeTaskResponseSchema = z.object({
  taskId: z.string().describe("Task ID"),
  paymentTxId: z.string().describe("Hedera payment transaction ID"),
  completedAt: z.number().describe("Unix timestamp of completion"),
});

// ─── Server Agent Card schema (SLICE-17-1) ───────────────────────

export const serverAgentCardSchema = z.object({
  name: z.string(),
  description: z.string(),
  url: z.string(),
  version: z.string(),
  capabilities: z.array(z.string()),
  skills: z.array(z.string()),
  endpoints: z.object({
    api: z.string(),
    docs: z.string(),
    mcp: z.string(),
    llms_txt: z.string(),
    guides: z.string(),
    did_resolver: z.string(),
  }),
  payment: z.object({
    protocol: z.string(),
    scheme: z.string(),
    network: z.string(),
    asset: z.string(),
    facilitator: z.string(),
  }),
  blockchain: z.object({
    network: z.string(),
    passport_token_id: z.string().optional(),
    directory_topic_id: z.string().optional(),
    audit_topic_id: z.string().optional(),
  }),
});

// ─── OpenAPI documentation config ─────────────────────────────────

export const rateLimitHeaders: Record<string, { description: string; schema: { type: "integer"; example: number } }> = {
  "X-RateLimit-Limit": {
    description: "Maximum number of requests per window",
    schema: { type: "integer", example: 60 },
  },
  "X-RateLimit-Remaining": {
    description: "Remaining requests in the current window",
    schema: { type: "integer", example: 59 },
  },
  "X-RateLimit-Reset": {
    description: "Unix timestamp when the rate limit window resets",
    schema: { type: "integer", example: 1700000000 },
  },
};

export const openApiConfig = {
  info: {
    title: "AgentBadge API",
    version: "0.1.0",
    description:
      "On-chain identity system for AI agents on Hedera Network. Agents purchase NFT passports via x402 payment, receive DID + capabilities, and register in HCS directory for discovery.",
  },
  servers: [{ url: process.env.BASE_URL ?? "http://localhost:4021", description: "AgentBadge API" }],
  tags: [
    { name: "Passport", description: "Passport issuance and management" },
    { name: "Verify", description: "Passport verification and retrieval" },
    { name: "DID", description: "DID resolution" },
    { name: "Agents", description: "Agent registration and discovery" },
    { name: "Admin", description: "Administrative operations" },
    { name: "Audit", description: "Audit trail" },
    { name: "Catalog", description: "Tier pricing and capabilities" },
    { name: "Health", description: "Health check" },
    { name: "A2A Messaging", description: "Agent-to-agent messaging" },
    { name: "Marketplace", description: "Agent marketplace for task posting and discovery" },
  ],
  "x-rate-limit": {
    defaultLimit: 60,
    windowSeconds: 60,
    scope: "per-IP",
    headers: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
  },
  components: {
    headers: rateLimitHeaders,
  },
};
