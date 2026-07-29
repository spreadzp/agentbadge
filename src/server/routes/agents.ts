/**
 * Agent registration + discovery routes.
 *
 * Reference: SLICE-2-1, SLICE-2-2, hackathon-flow.md:117-118, CONTEXT.md:37-39
 *
 * POST /agents/register — validates passport ownership, AgentCard consistency,
 *   submits HCS directory + audit messages, updates in-memory cache.
 *
 * GET /agents — list all agents with active status from Mirror Node.
 * GET /agents?capability=X — filter by capability.
 * GET /agents/:did — single agent lookup by DID.
 */

import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";

import type { Capability, Tier, DirectoryMessage } from "@agentgate-hedera/hedera-core";
import { getNftInfo, submitAuditMessage, submitDirectoryMessage } from "@agentgate-hedera/hedera-core";
import { agentWithActiveSchema, listAgentsResponseSchema, errorSchema } from "../openapi";
import { upsert, getAll, get as getEntry, type DirectoryEntry, logger } from "@agentgate-hedera/passport";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import { agentLinks } from "../lib/hateoas";

/** Request body for POST /agents/register. */
export interface RegisterAgentBody {
  did: string;
  tokenId: string;
  serial: number;
  accountId: string;
  name: string;
  capabilities: Capability[];
  endpoint: string;
  tier: Tier;
  skills?: string[];
}

/** AgentCard manifest shape (.well-known/agent-card.json). */
interface AgentCard {
  name: string;
  did: string;
  passportTokenId: string;
  passportSerial: number;
  capabilities: string[];
  tier: string;
  endpoints: Record<string, unknown>;
}

/** Result of AgentCard consistency check. */
type AgentCardResult =
  | { status: "consistent" }
  | { status: "conflict"; cardDid: string }
  | { status: "unreachable"; error: string };

const AGENT_CARD_TIMEOUT_MS = 5000;

/**
 * Validate that an endpoint URL is a valid HTTP(S) URL.
 * Rejects non-HTTP schemes and localhost in production mode.
 * (SLICE-7-13)
 */
export function validateEndpointUrl(endpoint: string): { valid: boolean; error?: string } {
  if (!endpoint) {
    return { valid: false, error: "Endpoint URL is required" };
  }

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { valid: false, error: "Invalid endpoint URL format" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      valid: false,
      error: `Endpoint URL must use http or https scheme, got: ${url.protocol}`,
    };
  }

  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction) {
    const hostname = url.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return { valid: false, error: "Localhost endpoints not allowed in production" };
    }
  }

  return { valid: true };
}

export const agentRoutes = new Hono();

/**
 * Fetch the agent's .well-known/agent-card.json manifest.
 * Returns null on network error or timeout.
 */
async function fetchAgentCard(endpoint: string): Promise<AgentCard | null> {
  try {
    const url = `${endpoint.replace(/\/$/, "")}/.well-known/agent-card.json`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AGENT_CARD_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as AgentCard;
  } catch {
    return null;
  }
}

/**
 * Check AgentCard DID consistency with request DID.
 */
function checkAgentCardConsistency(did: string, card: AgentCard | null): AgentCardResult {
  if (!card) {
    return { status: "unreachable", error: "AgentCard endpoint unreachable" };
  }
  if (card.did !== did) {
    return { status: "conflict", cardDid: card.did };
  }
  return { status: "consistent" };
}

/** Directory entry with active flag for API responses. */
interface AgentWithActive extends DirectoryEntry {
  active: boolean;
}

/**
 * Batch-check NFT active status via Mirror Node.
 * `deleted: true` → `active: false` (CONTEXT.md:37).
 * Parallelized with Promise.all for performance.
 */
async function checkActiveStatus(entries: DirectoryEntry[]): Promise<AgentWithActive[]> {
  const results = await Promise.all(
    entries.map(async (entry) => {
      try {
        const nft = await getNftInfo(entry.tokenId, entry.serial);
        const active = nft ? !nft.deleted : false;
        return { ...entry, active };
      } catch {
        // Mirror Node error — assume inactive
        return { ...entry, active: false };
      }
    }),
  );
  return results;
}

agentRoutes.get(
  "/agents",
  describeRoute({
    tags: ["Agents"],
    summary: "List all registered agents",
    description:
      "Returns agents from the in-memory directory cache with active/inactive status. Supports pagination (limit/offset) and filtering by capability and skill.",
    responses: {
      200: {
        description: "Agents retrieved",
        content: {
          "application/json": {
            schema: resolver(listAgentsResponseSchema),
          },
        },
      },
    },
  }),
  async (c) => {
    const capability = c.req.query("capability") as Capability | undefined;
    const skill = c.req.query("skill");
    const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "100", 10) || 100, 1), 100);
    const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);

    let entries = getAll();

    if (capability) {
      entries = entries.filter((e) => e.capabilities.includes(capability));
    }
    if (skill) {
      entries = entries.filter((e) => e.skills?.includes(skill));
    }

    const total = entries.length;
    const paginated = entries.slice(offset, offset + limit);
    const agents = await checkActiveStatus(paginated);
    const agentsWithLinks = agents.map((a) => ({ ...a, _links: agentLinks(a.did) }));

    return c.json({ agents: agentsWithLinks, count: agentsWithLinks.length, total, limit, offset }, 200);
  },
);

agentRoutes.get(
  "/agents/:did",
  describeRoute({
    tags: ["Agents"],
    summary: "Get agent by DID",
    responses: {
      200: { description: "Agent found" },
      404: {
        description: "Agent not found",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const did = c.req.param("did");
    const entry = getEntry(did);

    if (!entry) {
      return errorResponse(c, 404, ErrorCodes.AGENT_NOT_FOUND, "Agent not found");
    }

    const [agent] = await checkActiveStatus([entry]);
    return c.json({ agent: { ...agent, _links: agentLinks(did) } }, 200);
  },
);

agentRoutes.post(
  "/agents/register",
  describeRoute({
    tags: ["Agents"],
    summary: "Register agent in HCS directory",
    description:
      "Validates passport ownership, checks AgentCard consistency, submits HCS directory + audit messages.",
    responses: {
      200: { description: "Agent registered" },
      400: {
        description: "Missing required fields or invalid JSON",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
      403: {
        description: "Passport not found, revoked, or ownership mismatch",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
      409: {
        description: "AgentCard DID conflict",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    let body: RegisterAgentBody;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
    }

    const { did, tokenId, serial, accountId, name, capabilities, endpoint, tier, skills } = body;

    if (!did || !tokenId || !serial || !accountId || !name || !capabilities || !endpoint || !tier) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required fields");
    }

    // 0. Validate endpoint URL format (SLICE-7-13)
    const urlCheck = validateEndpointUrl(endpoint);
    if (!urlCheck.valid) {
      return errorResponse(c, 400, ErrorCodes.INVALID_ENDPOINT_URL, urlCheck.error ?? "Invalid endpoint URL");
    }

    // 1. Verify passport ownership via Mirror Node
    const nft = await getNftInfo(tokenId, serial);
    if (!nft) {
      return errorResponse(c, 403, ErrorCodes.PASSPORT_NOT_FOUND, "Passport not found");
    }
    if (nft.deleted) {
      return errorResponse(c, 403, ErrorCodes.PASSPORT_REVOKED, "Passport revoked");
    }
    if (nft.account_id !== accountId) {
      return errorResponse(c, 403, ErrorCodes.PASSPORT_OWNERSHIP_MISMATCH, "Passport ownership mismatch");
    }

    // 2. AgentCard consistency check
    const card = await fetchAgentCard(endpoint);
    const cardResult = checkAgentCardConsistency(did, card);
    if (cardResult.status === "conflict") {
      return errorResponse(
        c, 409, ErrorCodes.AGENTCARD_DID_CONFLICT,
        `AgentCard DID conflict: expected ${did}, got ${cardResult.cardDid}`,
      );
    }

    const warning =
      cardResult.status === "unreachable"
        ? `AgentCard unreachable: ${cardResult.error}`
        : undefined;

    // 3. Build + submit directory message
    const timestamp = Math.floor(Date.now() / 1000);
    const dirMessage: DirectoryMessage = {
      type: "agent_register",
      did,
      tokenId,
      serial,
      accountId,
      name,
      capabilities,
      endpoint,
      tier,
      timestamp,
    };
    await submitDirectoryMessage(dirMessage);

    // 4. Submit audit message
    await submitAuditMessage({
      type: "agent_registered",
      did,
      tokenId,
      serial,
      timestamp,
    });

    // 5. Update in-memory cache
    const entry: DirectoryEntry = {
      did,
      tokenId,
      serial,
      accountId,
      name,
      capabilities,
      endpoint,
      tier,
      timestamp,
      ...(skills ? { skills } : {}),
    };
    upsert(entry);

    logger.info("agent_registered", { did, name, capabilities, tokenId, serial });

    // 6. Return response
    const response: { registered: true; warning?: string } = { registered: true };
    if (warning) {
      response.warning = warning;
    }
    return c.json(response, 200);
  },
);
