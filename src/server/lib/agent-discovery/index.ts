/**
 * EPIC-178 (SLICE-178-1): agent-discovery package barrel.
 *
 * Boundary rule: builders are pure (sources injected); `collectSources()`
 * is the only function allowed to read env/modules; `enumeratePublicRoutes()`
 * reads a Hono app's route table. `generateAll()` walks the registry —
 * the single fan-out used by routes and `scripts/gen-discovery.ts`.
 */

export {
  collectSources,
  enumeratePublicRoutes,
  type DiscoverySources,
  type DiscoverySku,
} from "./sources";
export { buildLlmsTxt, buildLlmsFullTxt } from "./llms";
export { buildAgentCard } from "./agent-card";
export {
  buildAgentEvaluation,
  buildOwnerQuestions,
} from "./evaluation";
export {
  buildApiCatalog,
  buildErc8004Agent,
  buildMcpServerCard,
  buildOauthProtectedResource,
  buildSecurityTxt,
  buildDidJson,
} from "./wellknown";
export { MANIFEST_REGISTRY, type ManifestEntry } from "./manifests";

import type { DiscoverySources } from "./sources";
import { MANIFEST_REGISTRY } from "./manifests";

export interface GeneratedManifest {
  body: string;
  contentType: string;
  /** Present when the entry is a redirect (agent.json → agent-card.json). */
  redirectTo?: string;
  cacheMaxAge: number;
}

/**
 * Build every enabled manifest from one sources object. Disabled entries
 * (feature gates like did.json) produce no map entry → routes return 404.
 */
export function generateAll(src: DiscoverySources): Map<string, GeneratedManifest> {
  const out = new Map<string, GeneratedManifest>();
  for (const m of MANIFEST_REGISTRY) {
    if (m.enabled && !m.enabled(src)) continue;
    out.set(m.path, {
      body: m.build ? m.build(src) : "",
      contentType: m.contentType,
      redirectTo: m.redirectTo?.(src),
      cacheMaxAge: m.cacheMaxAge ?? 300,
    });
  }
  return out;
}
