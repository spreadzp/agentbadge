/**
 * Agent Card route — ERC-8004 compatible agent identity endpoint.
 *
 * GET /api/agent/:did/card — returns agent-card.json for a given DID.
 *
 * SLICE-90-15
 */

import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";
import { isEvmDid, parseEvmDid, passportToAgentCard } from "@agentbadge/evm-core";
import { getChainAdapter } from "../lib/chain-adapter-factory";

const agentCardResponseSchema = z.object({
  id: z.string(),
  type: z.enum(["CREATOR", "EXECUTOR", "UNKNOWN"]),
  capabilities: z.array(z.string()),
  tier: z.number(),
  issuer: z.string(),
  issuedAt: z.string(),
  revoked: z.boolean(),
  metadataUri: z.string(),
});

export const agentCardRoutes = new Hono();

agentCardRoutes.get(
  "/api/agent/:did/card",
  describeRoute({
    description: "Get ERC-8004 agent card for a given DID",
    responses: {
      200: {
        description: "ERC-8004 agent card",
        content: {
          "application/json": {
            schema: resolver(agentCardResponseSchema),
          },
        },
      },
      404: {
        description: "DID not found or not an EVM DID",
      },
    },
  }),
  async (c) => {
    const did = c.req.param("did");

    if (!isEvmDid(did)) {
      return c.json({ error: "Not an EVM DID", did }, 404);
    }

    const parsed = parseEvmDid(did);
    if (!parsed) {
      return c.json({ error: "Invalid DID format", did }, 404);
    }

    try {
      const adapter = await getChainAdapter();
      const passport = await adapter.getPassportInfo(parsed.nftAddress, parsed.tokenId);

      if (!passport) {
        return c.json({ error: "Passport not found", did }, 404);
      }

      // EvmChainAdapter returns EvmPassportInfo which extends NftInfo
      // with passportType and capabilities fields
      const evmPassport = passport as import("@agentbadge/evm-core").EvmPassportInfo;
      const card = passportToAgentCard(evmPassport, did);
      return c.json(card, 200, {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: "Failed to fetch passport", detail: message }, 500);
    }
  },
);
