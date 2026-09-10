import type { Assertion } from "../../rule-engine/assertion-builder";
import type { Evidence } from "../../rule-engine/evidence.types";
import type { CapabilitiesSection } from "../profile-schema";
import { SECTION_CATEGORY_MAP } from "../section-map";
import { extractPaths, type EndpointEntry } from "./openapi-paths";

/**
 * SLICE-101-3: Capability & Endpoint Extractor.
 *
 * Pure function: extracts capabilities section from assertions.
 * Filters by SECTION_CATEGORY_MAP.capabilities categories.
 * Returns undefined if zero applicable assertions (section omitted).
 */

export function extractCapabilities(assertions: Assertion[]): CapabilitiesSection | undefined {
  const categories = SECTION_CATEGORY_MAP.capabilities;
  const applicable = assertions.filter((a) => categories.includes(a.category));

  if (applicable.length === 0) return undefined;

  // Endpoints from OpenAPI evidence
  const endpoints: EndpointEntry[] = [];
  const protocols = new Set<string>();
  const skills = new Set<string>();

  for (const a of applicable) {
    if (a.status !== "VERIFIED" && a.status !== "INFERRED") continue;

    for (const e of a.evidence) {
      // OpenAPI evidence → endpoints + REST protocol
      if (e.type === "openapi") {
        protocols.add("REST");
        const eps = extractPaths(e);
        for (const ep of eps) {
          if (endpoints.length < 50) endpoints.push(ep);
        }
      }

      // MCP evidence → MCP protocol
      const url = (e as { url?: string }).url ?? "";
      const detail = (e as { semantic_detail?: string }).semantic_detail ?? "";
      if (url.includes("mcp") || detail.includes('"protocol":"mcp"') || a.category === "webmcp") {
        protocols.add("MCP");
      }

      // WebMCP category → WebMCP protocol
      if (a.category === "webmcp") {
        protocols.add("WebMCP");
      }

      // Agent-card / well-known evidence → A2A protocol
      if (url.includes("agent-card") || url.includes("well-known")) {
        protocols.add("A2A");
      }

      // Skills from semantic_detail (agent-card, agents.txt)
      if (detail) {
        try {
          const parsed = JSON.parse(detail);
          if (parsed.skills && Array.isArray(parsed.skills)) {
            for (const s of parsed.skills) {
              if (typeof s === "string") skills.add(s);
            }
          }
        } catch {
          // Not JSON, skip
        }
      }
    }
  }

  // Section meta
  const contributing = applicable.filter((a) => a.status === "VERIFIED" || a.status === "INFERRED");
  const confidences = contributing.map((a) => a.confidence).filter((c) => c > 0);
  const confidence = confidences.length > 0
    ? confidences.reduce((s, c) => s + c, 0) / confidences.length
    : 0;

  const sources = new Set<string>();
  for (const a of contributing) {
    for (const e of a.evidence) {
      sources.add(e.type);
    }
  }

  const verifiedAt = applicable
    .map((a) => a.verified_at || a.timestamp)
    .filter(Boolean)
    .sort()
    .pop() ?? new Date().toISOString();

  const gaps = applicable
    .filter((a) => a.status === "GAP")
    .map((a) => a.rule_id);

  return {
    data: {
      endpoints,
      protocols: Array.from(protocols),
      skills: Array.from(skills),
    },
    source: Array.from(sources).join(", "),
    confidence,
    verified_at: verifiedAt,
    stale: false,
    gaps,
  };
}
