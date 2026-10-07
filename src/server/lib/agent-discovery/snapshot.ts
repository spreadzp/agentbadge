/**
 * SLICE-178-5: snapshot writer + drift comparator for committed
 * discovery files.
 *
 * `writeDiscoverySnapshots()` is the single write path shared by
 * `scripts/gen-discovery.ts` (real generation → public/) and tests
 * (synthetic manifests → tmp-dir). Entries with empty `publicPath` are
 * env-gated/runtime-only and are never snapshotted (D-178-11).
 *
 * `snapshotDirDiff()` is the drift oracle behind the CI gate
 * `bun run gen:discovery && git diff --exit-code public/...`: given two
 * directories it returns the relative paths whose bytes differ (or exist
 * on one side only). Empty result → no drift.
 */

import {
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  existsSync,
  statSync,
} from "node:fs";
import { join, relative } from "node:path";

import { MANIFEST_REGISTRY } from "./manifests";
import type { GeneratedManifest } from "./index";

/**
 * Write every snapshot-eligible manifest under `outDir`, keyed by its
 * registry `publicPath`. Returns the list of written relative paths.
 */
export function writeDiscoverySnapshots(
  manifests: Map<string, GeneratedManifest>,
  outDir: string,
): string[] {
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const entry of MANIFEST_REGISTRY) {
    if (!entry.publicPath) continue;
    const m = manifests.get(entry.path);
    if (!m || m.redirectTo) continue;
    const file = join(outDir, entry.publicPath);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, m.body, "utf-8");
    written.push(entry.publicPath);
  }
  return written;
}

/** Collect all files under `dir` as relative POSIX paths. */
function listFiles(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, base));
    else out.push(relative(base, p).split("\\").join("/"));
  }
  return out;
}

/**
 * Byte-wise recursive diff of two directories. Returns sorted relative
 * paths that differ (missing on either side counts as a difference).
 */
export function snapshotDirDiff(dirA: string, dirB: string): string[] {
  const filesA = new Set(listFiles(dirA));
  const filesB = new Set(listFiles(dirB));
  const all = [...new Set([...filesA, ...filesB])].sort();
  const diff: string[] = [];
  for (const rel of all) {
    const pa = join(dirA, rel);
    const pb = join(dirB, rel);
    if (!filesA.has(rel) || !filesB.has(rel)) {
      diff.push(rel);
      continue;
    }
    if (!readFileSync(pa).equals(readFileSync(pb))) diff.push(rel);
  }
  return diff;
}
