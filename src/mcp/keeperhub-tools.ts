import { registerTool } from "@agentbadge/mcp";
import { allKeeperhubTools } from "@agentbadge/keeperhub";
import { getKeeperHubToolContext } from "../server/lib/keeperhub";

export function registerKeeperhubTools(): number {
  const ctx = getKeeperHubToolContext();
  if (!ctx) return 0;
  for (const tool of allKeeperhubTools) {
    const handler = tool.createHandler(ctx);
    registerTool(tool.name, tool.description, tool.inputSchema, handler);
  }
  return allKeeperhubTools.length;
}
