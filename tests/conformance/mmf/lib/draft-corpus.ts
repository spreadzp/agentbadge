/**
 * EPIC-263-3: loader for the vendored MMF v0.5-clamp DRAFT corpus —
 * tests/conformance/mmf/draft-v05-clamp/ pinned to commit a91b7f4
 * (frozen shape, DM 2026-11-23 15:28). Separate from lib/corpus.ts
 * (v0.4.24 release corpus) — the two pins never mix.
 *
 * MANIFEST.json carries the provenance: commit_sha, fetched_at, and a
 * sha256 per fetched file. verifyManifest() recomputes — a re-vendored
 * or corrupted file fails closed before any vector runs.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ClampCoreVector,
  CorpusFile,
  DelegationVector,
} from "./mmf-types";

export interface DraftManifest {
  upstream: string;
  branch: string;
  commit_sha: string;
  fetched_at: string;
  draft_version: string;
  note?: string;
  /** filename → sha256 (fetched files only). */
  files: Record<string, string>;
  upstream_paths?: Record<string, string>;
  generated?: Record<string, string>;
}

export const DRAFT_FILES = [
  "mmf-v0.5-clamp-proposal.md",
  "clamp-core.json",
  "clamp-delegation.json",
] as const;

export function draftDir(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../draft-v05-clamp",
  );
}

export function loadDraftManifest(
  dir: string = draftDir(),
): DraftManifest {
  return JSON.parse(
    readFileSync(path.join(dir, "MANIFEST.json"), "utf8"),
  ) as DraftManifest;
}

const sha256File = (p: string) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

/** Recompute sha256 of every fetched file and compare to MANIFEST —
 *  returns the mismatched filenames (empty = pin intact). */
export function verifyManifest(
  dir: string = draftDir(),
  manifest: DraftManifest = loadDraftManifest(dir),
): string[] {
  const bad: string[] = [];
  for (const [name, expected] of Object.entries(manifest.files)) {
    const p = path.join(dir, name);
    let actual: string;
    try {
      actual = sha256File(p);
    } catch {
      bad.push(`${name}:missing`);
      continue;
    }
    if (actual !== expected) bad.push(`${name}:sha256-mismatch`);
  }
  return bad;
}

export interface DraftCorpus {
  core: CorpusFile<ClampCoreVector>;
  delegation: CorpusFile<DelegationVector>;
  manifest: DraftManifest;
  /** sha256 of the two vector files (VectorResult.corpus_sha256 inputs). */
  sha256: { core: string; delegation: string };
}

export function loadDraftCorpus(dir: string = draftDir()): DraftCorpus {
  const bad = verifyManifest(dir, loadDraftManifest(dir));
  if (bad.length > 0) {
    throw new Error(
      `draft corpus pin violated: ${bad.join(", ")} — re-vendor via scripts/fetch-mmf-draft-v05.sh`,
    );
  }
  const manifest = loadDraftManifest(dir);
  const core = JSON.parse(
    readFileSync(path.join(dir, "clamp-core.json"), "utf8"),
  ) as CorpusFile<ClampCoreVector>;
  const delegation = JSON.parse(
    readFileSync(path.join(dir, "clamp-delegation.json"), "utf8"),
  ) as CorpusFile<DelegationVector>;
  return {
    core,
    delegation,
    manifest,
    sha256: {
      core: manifest.files["clamp-core.json"],
      delegation: manifest.files["clamp-delegation.json"],
    },
  };
}
