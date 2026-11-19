import { toolsFor } from "@agentbadge/webmcp";
import type { DiscoverySources } from "./sources";

/**
 * SLICE-256-5: WebMCP v2 toolset from the shared registry
 * (single source of truth — no hand-maintained lists). Degrades to
 * undefined if the package isn't importable (honest absence).
 */
export function collectWebmcp(): DiscoverySources["webmcp"] {
  try {
    const tools = toolsFor({ exposure: "webmcp" }).map((t) => ({
      name: t.name,
      description: t.description,
      group: t.group,
      writeClass: t.writeClass,
    }));
    return tools.length > 0 ? { tools } : undefined;
  } catch {
    return undefined;
  }
}
