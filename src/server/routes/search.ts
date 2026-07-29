/**
 * SLICE-17-6: JSON Search Endpoint
 *
 * GET /api/search?q=...&type=agent|task — in-memory substring search
 * across agents (directory cache) and tasks (market cache).
 */

import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";

import { getAll, listTasks } from "@agentgate-hedera/passport";
import { searchResultSchema } from "../openapi";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";

export const searchRoutes = new Hono();

interface AgentSearchResult {
  type: "agent";
  did: string;
  name: string;
  tier: string;
  capabilities: string[];
  skills?: string[];
  active: boolean;
}

interface TaskSearchResult {
  type: "task";
  taskId: string;
  title: string;
  priceHbar: number;
  capabilities: string[];
  status: string;
}

function searchAgents(query: string): AgentSearchResult[] {
  const q = query.toLowerCase();
  return getAll()
    .filter((entry) => {
      if (entry.name.toLowerCase().includes(q)) return true;
      if (entry.did.toLowerCase().includes(q)) return true;
      if (entry.capabilities.some((c) => c.toLowerCase().includes(q))) return true;
      if (entry.skills?.some((s) => s.toLowerCase().includes(q))) return true;
      return false;
    })
    .map((entry) => ({
      type: "agent" as const,
      did: entry.did,
      name: entry.name,
      tier: entry.tier,
      capabilities: entry.capabilities,
      ...(entry.skills ? { skills: entry.skills } : {}),
      active: true,
    }));
}

function searchTasks(query: string): TaskSearchResult[] {
  const q = query.toLowerCase();
  const { tasks } = listTasks({ offset: 0, limit: 1000 });
  return tasks
    .filter((task) => {
      if (task.title.toLowerCase().includes(q)) return true;
      if (task.description.toLowerCase().includes(q)) return true;
      return false;
    })
    .map((task) => ({
      type: "task" as const,
      taskId: task.taskId,
      title: task.title,
      priceHbar: task.priceHbar,
      capabilities: task.capabilities,
      status: task.status,
    }));
}

searchRoutes.get(
  "/api/search",
  describeRoute({
    tags: ["Search"],
    summary: "Search agents and tasks",
    description:
      "Case-insensitive substring search across agent names, DIDs, skills, capabilities and task titles, descriptions. In-memory only, no Mirror Node calls.",
    responses: {
      200: {
        description: "Search results",
        content: {
          "application/json": {
            schema: resolver(searchResultSchema),
          },
        },
      },
      400: { description: "Missing or empty query parameter 'q'" },
    },
  }),
  async (c) => {
    const q = c.req.query("q")?.trim();
    const type = c.req.query("type");

    if (!q) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Query parameter 'q' is required");
    }

    const results: (AgentSearchResult | TaskSearchResult)[] = [];

    if (type === "agent" || !type) {
      results.push(...searchAgents(q));
    }
    if (type === "task" || !type) {
      results.push(...searchTasks(q));
    }

    return c.json({ query: q, results, count: results.length }, 200);
  },
);
