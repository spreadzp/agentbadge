import { describe, it, expect } from "vitest";

const BASE = "http://localhost:4021";

describe("SLICE-122-5: JWKS endpoint GET /.well-known/jwks.json", () => {
  let body: Record<string, unknown>;

  it("returns 200", async () => {
    const res = await fetch(`${BASE}/.well-known/jwks.json`);
    expect(res.status).toBe(200);
    body = await res.json();
  });

  it("returns application/json content-type", async () => {
    const res = await fetch(`${BASE}/.well-known/jwks.json`);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("has keys array", async () => {
    if (!body) body = await (await fetch(`${BASE}/.well-known/jwks.json`)).json();
    expect(body).toHaveProperty("keys");
    expect(Array.isArray(body.keys)).toBe(true);
  });

  it("has at least one key", async () => {
    if (!body) body = await (await fetch(`${BASE}/.well-known/jwks.json`)).json();
    expect((body.keys as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it("first key has kty field", async () => {
    if (!body) body = await (await fetch(`${BASE}/.well-known/jwks.json`)).json();
    const firstKey = (body.keys as unknown[])[0] as Record<string, unknown>;
    expect(firstKey).toHaveProperty("kty");
    expect(typeof firstKey.kty).toBe("string");
  });

  it("first key has use field", async () => {
    if (!body) body = await (await fetch(`${BASE}/.well-known/jwks.json`)).json();
    const firstKey = (body.keys as unknown[])[0] as Record<string, unknown>;
    expect(firstKey).toHaveProperty("use");
    expect(firstKey.use).toBe("sig");
  });

  it("first key has alg field", async () => {
    if (!body) body = await (await fetch(`${BASE}/.well-known/jwks.json`)).json();
    const firstKey = (body.keys as unknown[])[0] as Record<string, unknown>;
    expect(firstKey).toHaveProperty("alg");
    expect(typeof firstKey.alg).toBe("string");
  });

  it("first key has kid field", async () => {
    if (!body) body = await (await fetch(`${BASE}/.well-known/jwks.json`)).json();
    const firstKey = (body.keys as unknown[])[0] as Record<string, unknown>;
    expect(firstKey).toHaveProperty("kid");
    expect(typeof firstKey.kid).toBe("string");
  });

  it("first key has crv field", async () => {
    if (!body) body = await (await fetch(`${BASE}/.well-known/jwks.json`)).json();
    const firstKey = (body.keys as unknown[])[0] as Record<string, unknown>;
    expect(firstKey).toHaveProperty("crv");
    expect(typeof firstKey.crv).toBe("string");
  });

  it("first key has x field (public key)", async () => {
    if (!body) body = await (await fetch(`${BASE}/.well-known/jwks.json`)).json();
    const firstKey = (body.keys as unknown[])[0] as Record<string, unknown>;
    expect(firstKey).toHaveProperty("x");
    expect(typeof firstKey.x).toBe("string");
  });

  it("first key kty is OKP (Octet Key Pair)", async () => {
    if (!body) body = await (await fetch(`${BASE}/.well-known/jwks.json`)).json();
    const firstKey = (body.keys as unknown[])[0] as Record<string, unknown>;
    expect(firstKey.kty).toBe("OKP");
  });

  it("first key alg is EdDSA", async () => {
    if (!body) body = await (await fetch(`${BASE}/.well-known/jwks.json`)).json();
    const firstKey = (body.keys as unknown[])[0] as Record<string, unknown>;
    expect(firstKey.alg).toBe("EdDSA");
  });

  it("first key crv is Ed25519", async () => {
    if (!body) body = await (await fetch(`${BASE}/.well-known/jwks.json`)).json();
    const firstKey = (body.keys as unknown[])[0] as Record<string, unknown>;
    expect(firstKey.crv).toBe("Ed25519");
  });

  it("has Cache-Control header", async () => {
    const res = await fetch(`${BASE}/.well-known/jwks.json`);
    expect(res.headers.get("cache-control")).toContain("max-age=3600");
  });
});

describe("SLICE-122-5: JWKS endpoint accessibility", () => {
  it("GET /.well-known/jwks.json returns valid JSON with keys", async () => {
    const res = await fetch(`${BASE}/.well-known/jwks.json`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("keys");
    expect(Array.isArray(data.keys)).toBe(true);
    expect(data.keys.length).toBeGreaterThanOrEqual(1);
  });
});

describe("SLICE-122-5: JWKS in llms.txt", () => {
  it("GET /llms.txt mentions /.well-known/jwks.json", async () => {
    const res = await fetch(`${BASE}/llms.txt`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("/.well-known/jwks.json");
  });
});
