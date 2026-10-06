/**
 * EPIC-178 (SLICE-178-1): manifest registry — single point of truth.
 * Slices 178-2/3/7 add entries here (path + contentType + builder);
 * routes and the gen script never know about individual manifests.
 */

import type { DiscoverySources } from "./sources";
import { buildLlmsTxt, buildLlmsFullTxt } from "./llms";

export interface ManifestEntry {
  /** URL path the manifest is served at. */
  path: string;
  /** File name under public/ for the snapshot (relative, no leading /). */
  publicPath: string;
  contentType: string;
  build(src: DiscoverySources): string;
}

export const MANIFEST_REGISTRY: ManifestEntry[] = [
  {
    path: "/llms.txt",
    publicPath: "llms.txt",
    contentType: "text/plain; charset=utf-8",
    build: buildLlmsTxt,
  },
  {
    path: "/llms-full.txt",
    publicPath: "llms-full.txt",
    contentType: "text/plain; charset=utf-8",
    build: buildLlmsFullTxt,
  },
];
