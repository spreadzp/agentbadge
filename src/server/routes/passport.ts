/**
 * Passport issuance route.
 *
 * Reference: SLICE-1-1, hackathon-flow.md:251-282
 *
 * POST /passport/request — x402 payment + wallet ownership proof → mint NFT
 *
 * Signature verification runs in signatureVerificationMiddleware BEFORE x402
 * payment middleware — see SLICE-7-1, middleware/signature-verification.ts.
 */

import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";

import type { Tier, Capability } from "@agentgate-hedera/hedera-core";
import { passportRequestSchema, passportResponseSchema, errorSchema } from "../openapi";
import { issuePassport, type IssuePassportResult } from "@agentgate-hedera/passport";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import { passportLinks } from "../lib/hateoas";

/** Request body for POST /passport/request. */
export interface PassportRequestBody {
  accountId: string;
  signature: string;
  tier: Tier;
  name: string;
  capabilities: Capability[];
  endpoint?: string;
  skills?: string[];
  imageUrl?: string;
}

/** Response body for successful issuance. */
export interface PassportResponse {
  tokenId: string;
  serialNumber: number;
  did: string;
  tier: Tier;
  hashScanLink: string;
  _links?: Record<string, { href: string; method?: string }>;
}

export const passportRoutes = new Hono();

passportRoutes.post(
  "/passport/request",
  describeRoute({
    tags: ["Passport"],
    summary: "Issue agent passport NFT",
    description:
      "Mints an HTS NFT passport for the agent after x402 payment and wallet ownership verification.",
    ...({
      "x-payment-info": {
        protocols: ["x402"],
        price: {
          asset: "HBAR",
          amounts: { bronze: 5, silver: 25, gold: 100, platinum: 500 },
        },
        facilitator: process.env.x402_FACILITATOR_URL ?? "",
        network: process.env.HEDERA_NETWORK ?? "testnet",
      },
    } as Record<string, unknown>),
    responses: {
      200: {
        description: "Passport issued successfully",
        content: {
          "application/json": { schema: resolver(passportResponseSchema) },
        },
      },
      400: {
        description: "Missing required fields or invalid JSON",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
      401: {
        description: "Signature verification failed",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
      500: {
        description: "Passport issuance failed",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    let body: PassportRequestBody;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
    }

    const { accountId, signature, tier, name, capabilities, endpoint, skills, imageUrl } = body;

    if (!tier || !name || !capabilities) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required fields");
    }

    try {
      const result: IssuePassportResult = await issuePassport(
        accountId,
        signature,
        tier,
        name,
        capabilities,
        endpoint,
        skills,
        imageUrl,
      );

      const response: PassportResponse = {
        tokenId: result.tokenId,
        serialNumber: result.serialNumber,
        did: result.did,
        tier: result.tier,
        hashScanLink: result.hashScanLink,
        _links: passportLinks(result.tokenId, result.serialNumber),
      };

      return c.json(response, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return errorResponse(c, 500, ErrorCodes.INTERNAL_ERROR, `Passport issuance failed: ${message}`, { retryable: true });
    }
  },
);
