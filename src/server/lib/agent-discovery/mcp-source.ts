import { getNamespace, listTools } from "@agentbadge/mcp";
import { openApiConfig } from "../../openapi";
import { MCP_NAMESPACES, MCP_NAMESPACE_DESCRIPTIONS, type DiscoverySources } from "./sources";

/** MCP introspection — namespaces + tool listings from the live registry. */
// SLICE-217-14: hide ops tools from public catalogs (llms.txt, agent-card) —
// the [OPS/INTERNAL] description marker plus explicit admin-only names.
const INTERNAL_TOOL_NAMES = new Set(["rebuild_cache"]);
const isPublicTool = (t: { name: string; description?: string }) =>
  !INTERNAL_TOOL_NAMES.has(t.name) && !t.description?.includes("[OPS/INTERNAL]");

export function collectMcpServer(): DiscoverySources["mcpServer"] {
  try {
    const namespaces = MCP_NAMESPACES.map((nsName) => {
      const ns = getNamespace(nsName);
      return {
        name: nsName,
        description: MCP_NAMESPACE_DESCRIPTIONS[nsName] ?? `${nsName} MCP namespace`,
        tools: (ns ? ns.listTools() : []).filter(isPublicTool).map((t) => ({ name: t.name, description: t.description })),
      };
    });
    return {
      name: "agentbadge",
      version: openApiConfig.info.version,
      namespaces,
      tools: listTools().filter(isPublicTool).map((t) => ({ name: t.name, description: t.description })),
    };
  } catch {
    return undefined;
  }
}
