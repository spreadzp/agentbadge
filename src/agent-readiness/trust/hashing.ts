/**
 * SLICE-102-1: Hash utilities for Trust Snapshot.
 *
 * - sha256Hex: SHA-256 hash → "sha256:<hex>" string
 * - merkleRoot: Merkle tree root from array of hashes
 */

import { createHash } from "crypto";

/**
 * Compute SHA-256 hash of input data, return as "sha256:<hex>" string.
 */
export function sha256Hex(data: string | Uint8Array): string {
  const hash = createHash("sha256");
  if (typeof data === "string") {
    hash.update(data, "utf-8");
  } else {
    hash.update(data);
  }
  return "sha256:" + hash.digest("hex");
}

/**
 * Compute Merkle root from an array of hash strings.
 *
 * If < 10 items: use sha256(concat(all_hashes)) for simplicity.
 * If ≥ 10 items: build binary Merkle tree.
 *
 * Empty array → sha256 of empty string.
 */
export function merkleRoot(hashes: string[]): string {
  if (hashes.length === 0) {
    return sha256Hex("");
  }

  if (hashes.length < 10) {
    return sha256Hex(hashes.join(""));
  }

  // Binary Merkle tree
  let level = [...hashes];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(sha256Hex(level[i] + level[i + 1]));
      } else {
        // Odd node: hash with itself
        next.push(sha256Hex(level[i] + level[i]));
      }
    }
    level = next;
  }
  return level[0];
}
