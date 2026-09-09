import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { getConfig } from "../../config/env";
import { getKeeperHubClient, keeperhubDisabledResponse } from "../lib/keeperhub";

export const keeperhubApiRoutes = new Hono();

// GET /keeperhub/status — health + config probe (no KeeperHub network call)
keeperhubApiRoutes.get(
  "/keeperhub/status",
  describeRoute({
    tags: ["KeeperHub"],
    summary: "KeeperHub integration status and config probe",
    description: "Returns whether KeeperHub is enabled, configured server URL, workflow IDs, and trust contract addresses. No network calls.",
  }),
  async (c) => {
    const cfg = getConfig();
    if (!cfg.keeperhub?.enabled) return c.json(keeperhubDisabledResponse(), 503);
    return c.json({
      enabled: true,
      serverUrl: cfg.keeperhub.serverUrl,
      workflows: {
        recordScan: cfg.keeperhub.workflowIds.recordScan ?? null,
        mintPassport: cfg.keeperhub.workflowIds.mintPassport ?? null,
        notify: cfg.keeperhub.workflowIds.notify ?? null,
      },
      trustContracts: {
        registry: cfg.base?.trustRegistry ?? null,
        badge: cfg.base?.trustBadge ?? null,
      },
    });
  },
);

// POST /keeperhub/ping — live KeeperHub connectivity (calls list_workflows)
keeperhubApiRoutes.post(
  "/keeperhub/ping",
  describeRoute({
    tags: ["KeeperHub"],
    summary: "Ping KeeperHub MCP server",
    description: "Calls list_workflows on the KeeperHub MCP to verify connectivity. Returns ok or fail with error text (never 500 — observability).",
  }),
  async (c) => {
    const cfg = getConfig();
    if (!cfg.keeperhub?.enabled) return c.json(keeperhubDisabledResponse(), 503);
    const client = getKeeperHubClient();
    if (!client) return c.json(keeperhubDisabledResponse(), 503);
    try {
      await client.connect();
      const workflows = await client.listWorkflows();
      return c.json({ ok: true, workflows });
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
);
