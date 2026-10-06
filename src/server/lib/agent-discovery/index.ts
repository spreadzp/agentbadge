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
export { MANIFEST_REGISTRY, type ManifestEntry } from "./manifests";

import type { DiscoverySources } from "./sources";
import { MANIFEST_REGISTRY } from "./manifests";

export interface GeneratedManifest {
  body: string;
  contentType: string;
}

/** Build every registered manifest from one sources object. */
export function generateAll(src: DiscoverySources): Map<string, GeneratedManifest> {
  const out = new Map<string, GeneratedManifest>();
  for (const m of MANIFEST_REGISTRY) {
    out.set(m.path, { body: m.build(src), contentType: m.contentType });
  }
  return out;
}
