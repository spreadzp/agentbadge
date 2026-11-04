// EPIC-206 (SLICE-206-3): keyless public read layer for market tasks.
// Read-only projection — no auth, no owner metadata; budget_status is
// derived (D-206-6 honest cap). SoT for the 206-4 public-MCP facade.
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";
import { getActiveTasks, getTaskById } from "@agentbadge/passport";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { srcAttribution } from "../middleware/src-attribution";
import { BUDGET_STATUSES } from "../lib/machine-entry";
import {
  publicTaskDetail,
  publicTaskStatus,
  publicTaskSummary,
} from "../lib/tasks/public-read";

export const tasksReadRoutes = new Hono();

// 206-12: ?src= attribution on agent-readable entry points.
tasksReadRoutes.use(srcAttribution());

const summaryShape = z.object({
  task_id: z.string(),
  title: z.string(),
  budget: z.number(),
  currency: z.string(),
  budget_status: z.enum(BUDGET_STATUSES),
  deadline: z.string().nullable(),
  required_capabilities: z.array(z.string()),
  status: z.string(),
});

tasksReadRoutes.get(
  "/api/tasks/open",
  describeRoute({
    tags: ["Agent Tasks"],
    summary: "Open market tasks (keyless read)",
    description:
      "Public projection of tasks accepting work: budget + derived " +
      "budget_status (DECLARED_NOT_RESERVED | ESCROWED | PAID), deadline, " +
      "required capabilities. Zero-budget tasks are reputation-only.",
    responses: {
      200: {
        description: "Open tasks",
        content: {
          "application/json": {
            schema: resolver(
              z.object({ tasks: z.array(summaryShape), count: z.number() }),
            ),
          },
        },
      },
    },
  }),
  (c) => {
    const tasks = getActiveTasks()
      .filter((t) => t.status === "posted")
      .map(publicTaskSummary);
    return c.json({ tasks, count: tasks.length });
  },
);

tasksReadRoutes.get(
  "/api/tasks/:id",
  describeRoute({
    tags: ["Agent Tasks"],
    summary: "Market task detail + machine_entry (keyless read)",
    description:
      "Full public task projection including description (acceptance " +
      "criteria) and the per-task machine_entry block — concrete calls " +
      "with this task's id substituted.",
    responses: {
      200: {
        description: "Task detail",
        content: {
          "application/json": { schema: resolver(summaryShape.loose()) },
        },
      },
      404: { description: "Task not found" },
    },
  }),
  (c) => {
    const t = getTaskById(c.req.param("id"));
    if (!t) return errorResponse(c, 404, ErrorCodes.TASK_NOT_FOUND, "Task not found");
    return c.json(publicTaskDetail(t));
  },
);

tasksReadRoutes.get(
  "/api/tasks/:id/status",
  describeRoute({
    tags: ["Agent Tasks"],
    summary: "Task lifecycle status (keyless read)",
    description: "Lightweight status probe for the verify-status phase.",
    responses: {
      200: {
        description: "Task status",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                task_id: z.string(),
                status: z.string(),
                budget_status: z.enum(BUDGET_STATUSES),
                updated_at: z.string(),
              }),
            ),
          },
        },
      },
      404: { description: "Task not found" },
    },
  }),
  (c) => {
    const t = getTaskById(c.req.param("id"));
    if (!t) return errorResponse(c, 404, ErrorCodes.TASK_NOT_FOUND, "Task not found");
    return c.json(publicTaskStatus(t));
  },
);

tasksReadRoutes.get(
  "/api/start-here",
  describeRoute({
    tags: ["Agent Tasks"],
    summary: "Agent entry point (keyless read)",
    description:
      "First call for a foreign agent: pointer to the machine descriptor " +
      "plus the number of currently open tasks and a concrete next call.",
    responses: {
      200: {
        description: "Entry point payload",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                protocol_doc: z.string(),
                protocol_version: z.string(),
                open_tasks: z.number(),
                next_call: z.object({ method: z.string(), path: z.string() }),
                auth_required_for_writes: z.string(),
              }),
            ),
          },
        },
      },
    },
  }),
  (c) => {
    const open = getActiveTasks().filter((t) => t.status === "posted").length;
    return c.json({
      protocol_doc: "/.well-known/agentbadge-machine.json",
      protocol_version: "agentbadge-market/1",
      open_tasks: open,
      next_call: { method: "GET", path: "/api/tasks/open" },
      auth_required_for_writes: "sig-auth (X-Wallet/X-Sig/X-Timestamp)",
    });
  },
);
