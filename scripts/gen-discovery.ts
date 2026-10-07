/**
 * EPIC-178 (SLICE-178-1): generate committed discovery snapshots.
 *
 * `bun run gen:discovery` → writes public/<manifest> for every entry in
 * MANIFEST_REGISTRY from live sources (openapi routes via createApp(),
 * blog data, tiers, env). Deterministic: same sources → byte-identical
 * output; the committed snapshot is the drift test.
 *
 * index.ts guards Bun.serve with `import.meta.main`, so importing the
 * app here is side-effect-light (module wiring only).
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

// SLICE-178-5: GEN_DISCOVERY_OUT redirects output (CI drift-check
// writes to a scratch dir and diffs, without touching public/).
const PUBLIC_DIR =
  process.env.GEN_DISCOVERY_OUT ?? join(import.meta.dir, "..", "public");

async function main() {
  const { createApp } = await import("../src/server/index");
  const { collectSources, generateAll } = await import(
    "../src/server/lib/agent-discovery"
  );
  const { writeDiscoverySnapshots } = await import(
    "../src/server/lib/agent-discovery/snapshot"
  );

  const app = createApp();
  const sources = collectSources(app);
  const manifests = generateAll(sources);

  mkdirSync(PUBLIC_DIR, { recursive: true });
  const written = writeDiscoverySnapshots(manifests, PUBLIC_DIR);
  for (const rel of written) console.log(`wrote ${rel}`);
  console.log(`gen-discovery: ${written.length} files → ${PUBLIC_DIR}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("gen-discovery failed:", e);
  process.exit(1);
});
