/**
 * SLICE-200-01 F4: JWKS round-trip regression.
 *
 * A JWT signed with DID_SIGNING_KEY (Ed25519 PKCS8) whose header
 * kid equals the did:web verification-method id must verify
 * against the set served by getJwks() via jose createLocalJWKSet.
 * Also: no DID_SIGNING_KEY → honest empty set.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  generateKeyPair,
  exportPKCS8,
  importPKCS8,
  SignJWT,
  jwtVerify,
  createLocalJWKSet,
} from "jose";
import { getJwks } from "../src/server/lib/jwks";

describe("SLICE-200-01 F4: getJwks round-trip", () => {
  const originalKey = process.env.DID_SIGNING_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.DID_SIGNING_KEY;
    else process.env.DID_SIGNING_KEY = originalKey;
  });

  it("no DID_SIGNING_KEY → empty keys (honest absence)", () => {
    delete process.env.DID_SIGNING_KEY;
    expect(getJwks()).toEqual({ keys: [] });
  });

  it("signed JWT verifies against served JWKS (kid = did:web vm id)", async () => {
    const { privateKey } = await generateKeyPair("Ed25519", { extractable: true });
    const pkcs8 = await exportPKCS8(privateKey);
    process.env.DID_SIGNING_KEY = pkcs8;

    const jwks = getJwks();
    expect(jwks.keys).toHaveLength(1);

    const servedKid = jwks.keys[0].kid;
    expect(servedKid).toMatch(/^did:web:.+#key-1$/);
    expect(jwks.keys[0].kty).toBe("OKP");
    expect(jwks.keys[0].crv).toBe("Ed25519");
    expect(jwks.keys[0].alg).toBe("EdDSA");

    const key = await importPKCS8(pkcs8, "EdDSA");
    const jwt = await new SignJWT({ iss: "did:web:test", sub: "did:web:test" })
      .setProtectedHeader({ alg: "EdDSA", kid: servedKid })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(key);

    const { payload } = await jwtVerify(jwt, createLocalJWKSet(jwks));
    expect(payload.iss).toBe("did:web:test");
  });

  it("JWT with wrong kid does NOT verify", async () => {
    const { privateKey } = await generateKeyPair("Ed25519", { extractable: true });
    const pkcs8 = await exportPKCS8(privateKey);
    process.env.DID_SIGNING_KEY = pkcs8;

    const key = await importPKCS8(pkcs8, "EdDSA");
    const jwt = await new SignJWT({ iss: "x" })
      .setProtectedHeader({ alg: "EdDSA", kid: "did:web:evil.example#key-1" })
      .sign(key);

    await expect(jwtVerify(jwt, createLocalJWKSet(getJwks()))).rejects.toThrow();
  });
});
