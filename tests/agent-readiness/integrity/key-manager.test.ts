import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  generateSigningKey,
  saveSigningKey,
  loadSigningKey,
  savePublicKey,
  loadPublicKey,
} from "../../../src/agent-readiness/integrity/key-manager";

describe("SLICE-36-4: Ed25519 Key Manager", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "keymgr-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("generated key has 32-byte private key", () => {
    const key = generateSigningKey("test-key-1");
    expect(key.privateKey).toHaveLength(32);
  });

  it("generated key has 32-byte public key", () => {
    const key = generateSigningKey("test-key-1");
    expect(key.publicKey).toHaveLength(32);
  });

  it("algorithm is ed25519", () => {
    const key = generateSigningKey("test-key-1");
    expect(key.algorithm).toBe("ed25519");
  });

  it("keyId is preserved", () => {
    const key = generateSigningKey("agentbadge-prod-2026-q3");
    expect(key.keyId).toBe("agentbadge-prod-2026-q3");
  });

  it("save → load round-trip produces identical keys", async () => {
    const key = generateSigningKey("round-trip-test");
    const keyPath = join(tempDir, "signing-key.json");
    await saveSigningKey(key, keyPath);
    const loaded = await loadSigningKey(keyPath);

    expect(loaded.keyId).toBe(key.keyId);
    expect(loaded.algorithm).toBe(key.algorithm);
    expect(Array.from(loaded.privateKey)).toEqual(Array.from(key.privateKey));
    expect(Array.from(loaded.publicKey)).toEqual(Array.from(key.publicKey));
  });

  it("savePublicKey → loadPublicKey reads only public key", async () => {
    const key = generateSigningKey("pubkey-test");
    const pubPath = join(tempDir, "pubkey.pub");
    await savePublicKey(key, pubPath);
    const loaded = await loadPublicKey(pubPath);

    expect(loaded.keyId).toBe(key.keyId);
    expect(loaded.algorithm).toBe("ed25519");
    expect(Array.from(loaded.publicKey)).toEqual(Array.from(key.publicKey));
  });

  it("two different key generations produce different keys", () => {
    const key1 = generateSigningKey("key-1");
    const key2 = generateSigningKey("key-2");
    expect(Array.from(key1.privateKey)).not.toEqual(Array.from(key2.privateKey));
    expect(Array.from(key1.publicKey)).not.toEqual(Array.from(key2.publicKey));
  });

  it("key ID format matches agentbadge-prod-* pattern", () => {
    const key = generateSigningKey("agentbadge-prod-2026-q3");
    expect(key.keyId).toMatch(/^agentbadge-prod-\d{4}-q[1-4]$/);
  });
});
