import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { buildLinkGraph } from "../lib/link-graph";

export const linkGraphRoutes = new Hono();

linkGraphRoutes.get(
  "/link-graph",
  describeRoute({
    description: "Returns the internal link graph as JSON with nodes (pages) and edges (relationships).",
    responses: {
      200: {
        description: "Link graph JSON",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                nodes: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      url: { type: "string" },
                      title: { type: "string" },
                      type: { type: "string" },
                    },
                  },
                },
                edges: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      from: { type: "string" },
                      to: { type: "string" },
                      relationship: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }),
  (c) => {
    const graph = buildLinkGraph();
    return c.json(graph);
  },
);
