/**
 * Agent guide routes for Demand Registry.
 *
 * SLICE-46-12: Agent-facing documentation for demand API.
 * GET /agent-guide/demand          — Markdown docs
 * GET /agent-guide/demand/schema.json — JSON schema
 */

import { Hono } from "hono";

export const demandGuideRoutes = new Hono();

const DEMAND_MARKDOWN = `# Demand Registry API

## Overview

Agents can register demand for capabilities the team doesn't currently list.
This helps the team understand market needs and prioritize new capabilities.

**Important:** Demand does NOT auto-create capabilities. Transition from REQUESTED to AVAILABLE
requires human review.

## Endpoints

### POST /api/demand/request

Register demand for a capability.

**Request:**
\`\`\`json
{
  "capability_query": "solidity audit",
  "context": "We need smart contract audits for Hedera"
}
\`\`\`

**Response:** \`202 Accepted\`
\`\`\`json
{
  "demand_id": "demand-1",
  "capability_query": "solidity audit",
  "count": 1,
  "priority": "backlog",
  "status": "accepted"
}
\`\`\`

**Rate limiting:** 10 requests per hour per IP.

### Query Normalization

Queries are normalized (lowercase, trimmed, whitespace collapsed).
Repeated requests for the same normalized query increment the count
and update \`last_seen\`.

### Priority Levels

| Level      | Count    | Description                    |
|------------|----------|--------------------------------|
| backlog    | 1-4      | Initial demand, monitoring     |
| candidate  | 5-19     | Growing demand, under review   |
| priority   | 20+      | High demand, likely to be built|

### Fields

| Field              | Type   | Description                          |
|--------------------|--------|--------------------------------------|
| capability_query   | string | The requested capability (max 200)   |
| context            | string | Optional context (max 1000)          |

## Constraints

- Demand does NOT auto-create capabilities
- Human review required for REQUESTED → AVAILABLE transition
- In-memory storage (data may reset on restart)
`;

const DEMAND_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "DemandRequest",
  description: "Schema for registering capability demand",
  type: "object",
  required: ["capability_query"],
  properties: {
    capability_query: {
      type: "string",
      minLength: 1,
      maxLength: 200,
      description: "The capability being requested",
    },
    context: {
      type: "string",
      maxLength: 1000,
      description: "Optional context for the demand",
    },
  },
  additionalProperties: false,
};

demandGuideRoutes.get("/agent-guide/demand", (c) => {
  return c.text(DEMAND_MARKDOWN, 200, {
    "Content-Type": "text/markdown; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  });
});

demandGuideRoutes.get("/agent-guide/demand/schema.json", (c) => {
  return c.json(DEMAND_SCHEMA, 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  });
});
