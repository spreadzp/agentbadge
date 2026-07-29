/**
 * DID resolution route.
 *
 * Reference: SLICE-1-3, hackathon-flow.md:116
 *
 * GET /did/:did — parse DID, delegate to getPassportInfo, return W3C DID document
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { getPassportInfo, type PassportInfo } from "@agentgate-hedera/passport";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";

export const didRoutes = new Hono();

const DID_REGEX = /^did:hcs:(\d+\.\d+\.\d+):(\d+)$/;

export function parseDid(did: string): { tokenId: string; serial: number } | null {
  const match = DID_REGEX.exec(did);
  if (!match) return null;
  return { tokenId: match[1], serial: Number(match[2]) };
}

export function buildDidDocument(did: string, passport: PassportInfo) {
  const service: Array<{
    id: string;
    type: string;
    serviceEndpoint: string;
  }> = [];

  if (passport.endpoint) {
    service.push({
      id: `${did}#mcp`,
      type: "MCP",
      serviceEndpoint: passport.endpoint,
    });
  }

  return {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: did,
    verificationMethod: [] as unknown[],
    service,
  };
}

didRoutes.get(
  "/did/:did",
  describeRoute({
    tags: ["DID"],
    summary: "Resolve DID to W3C DID document",
    description: "Parses a did:hcs DID, delegates to getPassportInfo, returns a W3C DID document.",
    responses: {
      200: { description: "DID document returned" },
      400: { description: "Invalid DID format" },
      404: { description: "DID not found or revoked" },
    },
  }),
  async (c) => {
    const did = c.req.param("did");
    const parsed = parseDid(did);

    if (!parsed) {
      return errorResponse(c, 400, ErrorCodes.INVALID_DID_FORMAT, "Invalid DID format");
    }

    const info = await getPassportInfo(parsed.tokenId, parsed.serial);

    if (!info || !info.active) {
      return errorResponse(c, 404, ErrorCodes.PASSPORT_NOT_FOUND, "DID not found or revoked");
    }

    const doc = buildDidDocument(did, info);
    return c.json(doc, 200);
  },
);
