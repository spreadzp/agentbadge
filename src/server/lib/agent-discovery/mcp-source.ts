import { getNamespace, listTools } from "@agentbadge/mcp";
import { openApiConfig } from "../../openapi";
import { MCP_NAMESPACES, MCP_NAMESPACE_DESCRIPTIONS, type DiscoverySources } from "./sources";

/** MCP introspection — namespaces + tool listings from the live registry. */
// SLICE-217-14 → EPIC-259-3 → EPIC-259-7: catalog visibility follows the
// registry's anon projection — public catalogs list exactly what an
// anonymous caller sees in tools/list: exposure:"public" AND
// publicTier:"curated". The [OPS/INTERNAL] marker stays as docs only.
const isPublicTool = (t: { exposure?: string; publicTier?: string }) =>
  t.exposure === "public" && t.publicTier === "curated";

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
