import type { SourceState } from "../../../../src/agent-readiness/scanner/source-state";
import type { ResponseSnapshot } from "../../../../src/agent-readiness/scanner/snapshot";
import { richApiSourceState, snap } from "./source-state";

// ─── Mutated fixture: OpenAPI spec with error responses added ──────
// Adding 4xx/5xx responses should resolve AB-149 (error_semantics)
// causing gap:semantic:error_semantics to disappear.

const openapiWithErrorResponses = JSON.stringify({
  openapi: "3.1.0",
  info: {
    title: "Example Payment API",
    version: "1.0.0",
    description: "A payment processing API for developers.",
  },
  servers: [
    { url: "https://api.example.com", description: "Production" },
  ],
  paths: {
    "/charges": {
      get: {
        summary: "List all charges",
        description: "Retrieves a list of all charges with optional pagination.",
        parameters: [
          {
            name: "limit",
            in: "query",
            description: "Maximum number of charges to return (1-100).",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 100 },
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "A list of charges",
            content: {
              "application/json": {
                example: { data: [{ id: "ch_123", amount: 5000, currency: "usd" }], has_more: false },
              },
            },
          },
          "400": {
            description: "Bad request — invalid parameters",
            content: {
              "application/json": {
                example: { error: "invalid_request", message: "limit must be 1-100" },
              },
            },
          },
          "401": {
            description: "Unauthorized — missing or invalid API key",
          },
          "429": {
            description: "Rate limit exceeded",
            headers: {
              "Retry-After": { schema: { type: "integer" } },
            },
          },
          "500": {
            description: "Internal server error",
          },
        },
      },
      post: {
        summary: "Create a charge",
        description: "Creates a new charge for a customer.",
        requestBody: {
          content: {
            "application/json": {
              example: { amount: 5000, currency: "usd", customer_id: "cus_123" },
            },
          },
        },
        responses: {
          "200": {
            description: "Charge created successfully",
            content: {
              "application/json": {
                example: { id: "ch_123", amount: 5000, currency: "usd", status: "succeeded" },
              },
            },
          },
          "400": {
            description: "Bad request — invalid charge parameters",
          },
          "401": {
            description: "Unauthorized",
          },
          "500": {
            description: "Internal server error",
          },
        },
      },
    },
    "/charges/{id}": {
      get: {
        summary: "Retrieve a charge",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Charge details",
          },
          "404": {
            description: "Charge not found",
          },
        },
      },
      post: {
        summary: "Refund a charge",
        description: "Refunds a charge partially or fully.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Refund processed",
          },
          "404": {
            description: "Charge not found",
          },
        },
      },
    },
    "/customers": {
      get: {
        summary: "List customers",
        responses: {
          "200": {
            description: "List of customers",
          },
          "401": {
            description: "Unauthorized",
          },
        },
      },
    },
  },
});

export const richApiSourceStateWithErrorSchemas: SourceState = {
  ...richApiSourceState,
  snapshots: {
    ...richApiSourceState.snapshots,
    openapi: snap("https://api.example.com/openapi.json", openapiWithErrorResponses),
  } as Record<string, ResponseSnapshot | null>,
};
