/**
 * SLICE-255-1: typed loader for the vendored Mandata MMF corpus.
 *
 * Corpus = ashedrack/mandata spec/vectors/ @ tag v0.4.24 (see
 * ../vectors/CORPUS.md for pin + SHA-256 manifest).
 *
 * Design constraints (decisions.md):
 *  - `tx.amount_json` stays a raw lexical string (D-255-Q16 scalar
 *    projection) — never coerced to number on load.
 *  - Loader is faithful: unknown keys pass through via index
 *    signatures, nothing is dropped (round-trip lossless).
 *  - Embedded conventions are carried, not interpreted here:
 *    prior_txns, registry.revoked/unavailable, steps, then_*.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  CoreVector,
  CorpusFile,
  CredentialVector,
  DelegationVector,
  EvidenceVector,
  LifecycleVector,
  MmfCorpus,
  MmfTrack,
} from "./mmf-types";

export type * from "./mmf-types";

export const CORPUS_FILES = [
  "core",
  "delegation",
  "lifecycle",
  "credential",
  "evidence",
] as const satisfies readonly MmfTrack[];

export function vectorsDir(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../vectors",
  );
}

function readJson<T>(dir: string, name: string): T {
  return JSON.parse(
    readFileSync(path.join(dir, `${name}.json`), "utf8"),
  ) as T;
}

export function loadCorpus(dir: string = vectorsDir()): MmfCorpus {
  const core = readJson<CorpusFile<CoreVector>>(dir, "core");
  const delegation = readJson<CorpusFile<DelegationVector>>(
    dir,
    "delegation",
  );
  const lifecycle = readJson<CorpusFile<LifecycleVector>>(
    dir,
    "lifecycle",
  );
  const credential = readJson<CredentialVector[]>(dir, "credential");
  const evidence = readJson<CorpusFile<EvidenceVector>>(dir, "evidence");
  return {
    core,
    delegation,
    lifecycle,
    credential,
    evidence,
    all: [
      ...core.vectors.map((vector) => ({
        track: "core" as const,
        vector,
      })),
      ...delegation.vectors.map((vector) => ({
        track: "delegation" as const,
        vector,
      })),
      ...lifecycle.vectors.map((vector) => ({
        track: "lifecycle" as const,
        vector,
      })),
      ...credential.map((vector) => ({
        track: "credential" as const,
        vector,
      })),
      ...evidence.vectors.map((vector) => ({
        track: "evidence" as const,
        vector,
      })),
    ],
  };
}

/** sha256 of each vendored file, keyed by track name. */
export function corpusSha256(
  dir: string = vectorsDir(),
): Record<MmfTrack, string> {
  const out = {} as Record<MmfTrack, string>;
  for (const f of CORPUS_FILES) {
    out[f] = createHash("sha256")
      .update(readFileSync(path.join(dir, `${f}.json`)))
      .digest("hex");
  }
  return out;
}

/**
 * Parse `sha256sum`-format lines (`<64-hex>  <name>.json`) out of
 * CORPUS.md. Returns filename → hex map.
 */
export function parseCorpusManifest(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of md.split("\n")) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+(\S+\.json)$/);
    if (m) out[m[2]] = m[1];
  }
  return out;
}

/** `desc` is the common key; some vectors (V30) use `description`. */
export function vectorDesc(v: {
  desc?: string;
  description?: string;
}): string {
  return v.desc ?? v.description ?? "";
}
