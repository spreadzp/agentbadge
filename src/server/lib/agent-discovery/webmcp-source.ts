import { toolsFor } from "@agentbadge/webmcp";
import { serverMirrorTools } from "../agent-interaction/webmcp-page-tools";
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
    // SLICE-233-6: the /for-agents shelf also registers server-side
    // mirror tools absent from the published package — the served
    // surface (what document.modelContext actually lists) includes
    // them. Self-dedupes on package republish.
    for (const m of serverMirrorTools()) {
      if (!tools.some((t) => t.name === m.name)) {
        tools.push({
          name: m.name,
          description: m.description,
          group: m.group,
          writeClass: m.writeClass,
        });
      }
    }
    return tools.length > 0 ? { tools } : undefined;
  } catch {
    return undefined;
  }
}
