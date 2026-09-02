/**
 * Passport verification & retrieval routes.
 *
 * Reference: SLICE-1-2, hackathon-flow.md:111-113
 *
 * GET /passport/:tokenId/:serial   — single passport info
 * GET /passport/address/:address   — passports by owner address
 * GET /passports                   — all passports (paginated)
 */

import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";

import { passportInfoSchema, errorSchema } from "../openapi";
import {
  getPassportInfo,
  listPassportsByAddress,
  listAllPassports,
} from "@agentbadge/passport";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import { passportLinks } from "../lib/hateoas";

export const verifyRoutes = new Hono();

// Register /passport/address/:address BEFORE /passport/:tokenId/:serial
// to avoid the parametric route catching "address" as tokenId.
verifyRoutes.get(
  "/passport/address/:address",
  describeRoute({
    tags: ["Verify"],
    summary: "List passports by owner address",
    responses: {
      200: { description: "Passports retrieved" },
      400: {
        description: "Address is required",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
      500: {
        description: "Retrieval failed",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const address = c.req.param("address");

    if (!address) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Address is required");
    }

    try {
      const passports = await listPassportsByAddress(address);
      return c.json({ passports }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return errorResponse(c, 500, ErrorCodes.MIRROR_NODE_UNAVAILABLE, `Retrieval failed: ${message}`, { retryable: true });
    }
  },
);

verifyRoutes.get(
  "/passport/:tokenId/:serial",
  describeRoute({
    tags: ["Verify"],
    summary: "Get passport info",
    description: "Retrieves passport information by token ID and serial number.",
    responses: {
      200: {
        description: "Passport found",
        content: {
          "application/json": { schema: resolver(passportInfoSchema) },
        },
      },
      400: {
        description: "Invalid tokenId or serial",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
      404: {
        description: "Passport not found",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
      500: {
        description: "Verification failed",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const tokenId = c.req.param("tokenId");
    const serialStr = c.req.param("serial");
    const serial = Number(serialStr);

    if (!tokenId || Number.isNaN(serial)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid tokenId or serial");
    }

    try {
      const info = await getPassportInfo(tokenId, serial);
      if (!info) {
        return errorResponse(c, 404, ErrorCodes.PASSPORT_NOT_FOUND, "Passport not found");
      }
      return c.json({ ...info, _links: passportLinks(tokenId, serial) }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return errorResponse(c, 500, ErrorCodes.MIRROR_NODE_UNAVAILABLE, `Verification failed: ${message}`, { retryable: true });
    }
  },
);

verifyRoutes.get(
  "/passports",
  describeRoute({
    tags: ["Verify"],
    summary: "List all passports (paginated)",
    responses: {
      200: { description: "Passports retrieved" },
      400: {
        description: "tokenId query param or env is required",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
      500: {
        description: "Retrieval failed",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const tokenId = c.req.query("tokenId") ?? process.env.PASSPORT_TOKEN_ID;

    if (!tokenId) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "tokenId query param or PASSPORT_TOKEN_ID env is required");
    }

    try {
      const passports = await listAllPassports(tokenId);
      return c.json({ passports }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return errorResponse(c, 500, ErrorCodes.MIRROR_NODE_UNAVAILABLE, `Retrieval failed: ${message}`, { retryable: true });
    }
  },
);
