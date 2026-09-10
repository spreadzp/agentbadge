import type { KeeperHubClient } from "@agentbadge/keeperhub";

export interface TriggerInput {
  siteUrl: string;
  score: number;
  rulesPassed: number;
  rulesTotal: number;
  [key: string]: unknown;
}

export interface TriggerResult {
  executionId: string;
  via: "mcp" | "webhook";
}

export interface TriggerOpts {
  webhookUrl?: string;
  webhookKey?: string;
  mode?: "mcp" | "webhook";
}

/**
 * Dual-path trigger seam: primary MCP path + fallback webhook path.
 * Mode switchable by env (KEEPERHUB_TRIGGER_MODE).
 * If mode is "webhook" but no url/key configured, silently falls back to "mcp".
 */
export async function triggerWorkflow(
  client: KeeperHubClient,
  workflowId: string,
  inputs: TriggerInput,
  opts: TriggerOpts,
): Promise<TriggerResult> {
  const mode = opts.mode ?? "mcp";

  if (mode === "mcp" || !opts.webhookUrl || !opts.webhookKey) {
    const { executionId } = await client.executeWorkflow(workflowId, inputs);
    return { executionId, via: "mcp" };
  }

  // Webhook fallback
  const res = await fetch(opts.webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.webhookKey}`,
    },
    body: JSON.stringify(inputs),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Webhook trigger failed: ${res.status} ${body.slice(0, 200)}`);
  }

  const data = (await res.json().catch(() => ({}))) as { executionId?: string; id?: string };
  return { executionId: data.executionId ?? data.id ?? "webhook-unknown", via: "webhook" };
}
