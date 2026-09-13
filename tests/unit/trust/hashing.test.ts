import { describe, it, expect } from "vitest";
import { sha256Hex, merkleRoot } from "../../../src/agent-readiness/trust/hashing";

/**
 * SLICE-102-1: Hash utilities tests.
 */

describe("SLICE-102-1: sha256Hex()", () => {
  it("produces correct SHA-256 hash for known input", () => {
    // SHA-256 of empty string
    const result = sha256Hex("");
    expect(result).toBe("sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("produces correct SHA-256 for 'abc'", () => {
    const result = sha256Hex("abc");
    expect(result).toBe("sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("returns sha256: prefix", () => {
    const result = sha256Hex("test");
    expect(result.startsWith("sha256:")).toBe(true);
    expect(result.length).toBe(71); // "sha256:" (7) + 64 hex chars
  });

  it("handles Uint8Array input", () => {
    const data = new TextEncoder().encode("abc");
    const result = sha256Hex(data);
    expect(result).toBe("sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("produces different hashes for different inputs", () => {
    const a = sha256Hex("hello");
    const b = sha256Hex("world");
    expect(a).not.toBe(b);
  });
});

describe("SLICE-102-1: merkleRoot()", () => {
  it("returns sha256 of empty string for empty array", () => {
    const result = merkleRoot([]);
    expect(result).toBe("sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("uses concat hash for single item (< 10)", () => {
    const h = "sha256:abc123";
    const result = merkleRoot([h]);
    // Single item < 10: sha256(concat(all_hashes)) = sha256(h)
    const expected = sha256Hex(h);
    expect(result).toBe(expected);
  });

  it("uses concat hash for 2 items (< 10)", () => {
    const h1 = "sha256:aaa";
    const h2 = "sha256:bbb";
    const result = merkleRoot([h1, h2]);
    const expected = sha256Hex(h1 + h2);
    expect(result).toBe(expected);
  });

  it("uses concat hash for 4 items (< 10)", () => {
    const hashes = ["sha256:a", "sha256:b", "sha256:c", "sha256:d"];
    const result = merkleRoot(hashes);
    const expected = sha256Hex(hashes.join(""));
    expect(result).toBe(expected);
  });

  it("uses concat hash for 9 items (< 10)", () => {
    const hashes = Array.from({ length: 9 }, (_, i) => `sha256:h${i}`);
    const result = merkleRoot(hashes);
    const expected = sha256Hex(hashes.join(""));
    expect(result).toBe(expected);
  });

  it("builds binary Merkle tree for 10 items", () => {
    const hashes = Array.from({ length: 10 }, (_, i) => `sha256:h${i}`);
    const result = merkleRoot(hashes);
    // Should NOT be simple concat hash
    const concatResult = sha256Hex(hashes.join(""));
    expect(result).not.toBe(concatResult);
    // Should be a valid sha256: string
    expect(result.startsWith("sha256:")).toBe(true);
    expect(result.length).toBe(71);
  });

  it("builds binary Merkle tree for 100 items", () => {
    const hashes = Array.from({ length: 100 }, (_, i) => `sha256:h${i}`);
    const result = merkleRoot(hashes);
    expect(result.startsWith("sha256:")).toBe(true);
    expect(result.length).toBe(71);
  });

  it("handles odd number of items in Merkle tree (11)", () => {
    const hashes = Array.from({ length: 11 }, (_, i) => `sha256:h${i}`);
    const result = merkleRoot(hashes);
    expect(result.startsWith("sha256:")).toBe(true);
  });

  it("produces deterministic output", () => {
    const hashes = Array.from({ length: 10 }, (_, i) => `sha256:h${i}`);
    const r1 = merkleRoot(hashes);
    const r2 = merkleRoot(hashes);
    expect(r1).toBe(r2);
  });
});
