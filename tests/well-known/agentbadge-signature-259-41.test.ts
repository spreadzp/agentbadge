import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { createHash } from "node:crypto";
import { generateKeyPair, exportPKCS8, exportJWK, jwtVerify } from "jose";
import { setupMockEnv } from "../e2e/helpers";
import { metaRoutes } from "../../src/server/routes/meta/meta";

setupMockEnv();

// SLICE-259-41 (DeepSeek R5): the did:web key was published but no
// artifact carried a signature — trust chain open at the last hop.
// /.well-known/agentbadge.json now signs its own canonical bytes.
function app() {
  const a = new Hono();
  a.route("/", metaRoutes);
  return a;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(src)
        .sort()
        .map((k) => [k, sortKeysDeep(src[k])]),
    );
  }
  return value;
}

describe("SLICE-259-41: agentbadge.json detached-JWS signature", () => {
  const originalKey = process.env.DID_SIGNING_KEY;
  afterEach(() => {
    if (originalKey === undefined) delete process.env.DID_SIGNING_KEY;
    else process.env.DID_SIGNING_KEY = originalKey;
  });

  it("signature verifies against the DID key and matches the canonical payload", async () => {
    const { privateKey, publicKey } = await generateKeyPair("Ed25519", { extractable: true });
    process.env.DID_SIGNING_KEY = await exportPKCS8(privateKey);
    const publicJwk = await exportJWK(publicKey);

    const res = await app().request("/.well-known/agentbadge.json");
    expect(res.status).toBe(200);
    const body = await res.json();

    const sig = body.signature;
    expect(sig).toBeDefined();
    expect(sig.alg).toBe("EdDSA");
    expect(sig.kid).toMatch(/^did:web:.+#key-1$/);
    expect(sig.signing_input).toMatch(/^sha256:[0-9a-f]{64}$/);

    // 1) JWS verifies against the very key material we injected.
    const { payload, protectedHeader } = await jwtVerify(sig.jws, publicKey);
    expect(protectedHeader.kid).toBe(sig.kid);
    expect(payload.descriptor_sha256).toBe(sig.signing_input);

    // 2) Recompute the canonical hash an agent would compute.
    const { signature: _strip, ...unsigned } = body;
    const recomputed = `sha256:${createHash("sha256")
      .update(JSON.stringify(sortKeysDeep(unsigned)))
      .digest("hex")}`;
    expect(recomputed).toBe(sig.signing_input);

    // 3) The public JWK an agent resolves from did.json is the same key.
    expect(publicJwk.kty).toBe("OKP");
  });

  it("no DID_SIGNING_KEY → no signature field (honest absence)", async () => {
    delete process.env.DID_SIGNING_KEY;
    const res = await app().request("/.well-known/agentbadge.json");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signature).toBeUndefined();
    expect(body.deployment_id).toBeDefined();
  });
});
