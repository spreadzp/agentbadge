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

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PUBLIC_DIR = join(import.meta.dir, "..", "public");

async function main() {
  const { createApp } = await import("../src/server/index");
  const { collectSources, generateAll, MANIFEST_REGISTRY } = await import(
    "../src/server/lib/agent-discovery"
  );

  const app = createApp();
  const sources = collectSources(app);
  const manifests = generateAll(sources);

  mkdirSync(PUBLIC_DIR, { recursive: true });
  for (const entry of MANIFEST_REGISTRY) {
    // publicPath="" → env-dependent or gated (security.txt Expires,
    // did.json) — served live at boot, never snapshotted (D-178-11).
    if (!entry.publicPath) continue;
    const m = manifests.get(entry.path);
    if (!m || m.redirectTo) continue;
    const file = join(PUBLIC_DIR, entry.publicPath);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, m.body, "utf-8");
    console.log(`wrote public/${entry.publicPath} (${m.body.length} bytes)`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("gen-discovery failed:", e);
  process.exit(1);
});
