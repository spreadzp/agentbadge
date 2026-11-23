// EPIC-262 (SLICE-262-0a): intel scaffold — feature flag, key resolution,
// status + well-known key registry, end-to-end sign/verify of the env pair.
import { describe, it, expect } from "vitest";
import { sign, createPrivateKey, verify, createPublicKey } from "node:crypto";
import { Hono } from "hono";
import { loadIntel } from "../../src/config/env/intel";
import {
  resolveIntelSigningKey,
  toPublicKeyEntry,
  INTEL_API_VERSION,
} from "../../src/server/lib/intel/keys";
import {
  createIntelApiRoutes,
  createIntelKeysRoutes,
} from "../../src/server/routes/intel";
import { generateSigningKey } from "../../src/agent-readiness/integrity/key-manager";
import type { IntelEnvConfig } from "../../src/config/env";

const SEED_B64 = Buffer.alloc(32, 7).toString("base64"); // deterministic test seed

const cfgWith = (over: Partial<IntelEnvConfig> = {}): IntelEnvConfig => ({
  enabled: true,
  keyId: "intel-test-1",
  signingPrivateKey: SEED_B64,
  evidenceRetentionDays: 400,
  ...over,
});

function buildApp(key: ReturnType<typeof resolveIntelSigningKey>): Hono {
  const app = new Hono();
  app.route("/api/intel", createIntelApiRoutes({ key }));
  app.route("/", createIntelKeysRoutes({ key }));
  return app;
}

describe("SLICE-262-0a: loadIntel env section", () => {
  it("defaults: disabled, dev key id, no seed", () => {
    const saved = { ...process.env };
    delete process.env.INTEL_ENABLED;
    delete process.env.INTEL_KEY_ID;
    delete process.env.INTEL_SIGNING_PRIVATE_KEY;
    const cfg = loadIntel();
    process.env = saved;
    expect(cfg.enabled).toBe(false);
    expect(cfg.keyId).toBe("intel-dev-1");
    expect(cfg.signingPrivateKey).toBeUndefined();
  });
});

describe("SLICE-262-0a: resolveIntelSigningKey", () => {
  it("derives public key from a raw 32-byte seed", () => {
    const key = resolveIntelSigningKey(cfgWith());
    expect(key).not.toBeNull();
    expect(key!.keyId).toBe("intel-test-1");
    expect(key!.privateKey).toHaveLength(32);
    expect(key!.publicKey).toHaveLength(32);
  });

  it("returns null without a seed (fail-closed, no ephemeral key)", () => {
    expect(resolveIntelSigningKey(cfgWith({ signingPrivateKey: undefined }))).toBeNull();
  });

  it("returns null on a wrong-length seed", () => {
    expect(
      resolveIntelSigningKey(cfgWith({ signingPrivateKey: Buffer.alloc(16).toString("base64") })),
    ).toBeNull();
  });
});

describe("SLICE-262-0a: routes", () => {
  it("GET /api/intel/status returns service info + key_id", async () => {
    const app = buildApp(resolveIntelSigningKey(cfgWith()));
    const res = await app.request("/api/intel/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.service).toBe("agent-surface-intel");
    expect(body.status).toBe("ok");
    expect(body.version).toBe(INTEL_API_VERSION);
    expect(body.key_id).toBe("intel-test-1");
  });

  it("GET /.well-known/agentbadge-keys.json publishes the public key", async () => {
    const key = resolveIntelSigningKey(cfgWith())!;
    const app = buildApp(key);
    const res = await app.request("/.well-known/agentbadge-keys.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("max-age");
    const body = await res.json();
    expect(body.keys).toHaveLength(1);
    const entry = body.keys[0];
    expect(entry.key_id).toBe("intel-test-1");
    expect(entry.algorithm).toBe("ed25519");
    expect(entry.public_key).toBe(toPublicKeyEntry(key).public_key);
    expect(Buffer.from(entry.public_key, "base64")).toHaveLength(32);
  });

  it("enabled without key → 503 intel_key_missing on both endpoints", async () => {
    const app = buildApp(null);
    for (const path of ["/api/intel/status", "/.well-known/agentbadge-keys.json"]) {
      const res = await app.request(path);
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe("intel_key_missing");
    }
  });

  it("sign with env seed → verify against the published public key (end-to-end)", async () => {
    const key = resolveIntelSigningKey(cfgWith())!;
    const app = buildApp(key);
    const res = await app.request("/.well-known/agentbadge-keys.json");
    const { keys } = await res.json();

    const pkcs8Prefix = Buffer.from([
      0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
      0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
    ]);
    const privObj = createPrivateKey({
      key: Buffer.concat([pkcs8Prefix, Buffer.from(SEED_B64, "base64")]),
      format: "der",
      type: "pkcs8",
    });
    const payload = Buffer.from("intel-envelope-fixture");
    const signature = sign(null, payload, privObj);

    const spkiPrefix = Buffer.from([
      0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
      0x70, 0x03, 0x21, 0x00,
    ]);
    const pubObj = createPublicKey({
      key: Buffer.concat([spkiPrefix, Buffer.from(keys[0].public_key, "base64")]),
      format: "der",
      type: "spki",
    });
    expect(verify(null, payload, pubObj, signature)).toBe(true);
  });

  it("keygen path: generateSigningKey output feeds resolve path shape", () => {
    const gen = generateSigningKey("intel-gen-1");
    expect(gen.algorithm).toBe("ed25519");
    expect(toPublicKeyEntry(gen).status).toBe("active");
  });
});
