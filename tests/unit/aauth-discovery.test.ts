import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { wellKnownRoutes } from "../../src/server/routes/well-known";

// SLICE-PR3-7: AAuth discovery docs (AB-135 / AB-137).
describe("GET /.well-known/aauth.json", () => {
  let app: Hono;

  beforeAll(() => {
    app = new Hono();
    app.route("/", wellKnownRoutes);
  });

  it("returns 200 with JSON + Cache-Control", async () => {
    const res = await app.request("/.well-known/aauth.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Cache-Control")).not.toBeNull();
  });

  it("issuer matches the origin (RFC8414 §3.3 binding)", async () => {
    const res = await app.request("/.well-known/aauth.json");
    const body = await res.json();
    expect(body.issuer).toBe("https://agentbadge.xyz");
    expect(body.jwks_uri).toBe(`${body.issuer}/.well-known/jwks.json`);
  });

  it("points at the spec-canonical resource metadata", async () => {
    const res = await app.request("/.well-known/aauth.json");
    const body = await res.json();
    expect(body.aauth_resource_metadata).toBe(
      "https://agentbadge.xyz/.well-known/aauth-resource.json",
    );
  });

  it("publishes scope_descriptions (AB-137)", async () => {
    const res = await app.request("/.well-known/aauth.json");
    const body = await res.json();
    expect(Array.isArray(body.scope_descriptions)).toBe(true);
    expect(body.scope_descriptions.length).toBeGreaterThan(0);
    for (const s of body.scope_descriptions) {
      expect(s).toHaveProperty("scope");
      expect(s).toHaveProperty("description");
    }
  });
});

describe("GET /.well-known/aauth-resource.json", () => {
  let app: Hono;

  beforeAll(() => {
    app = new Hono();
    app.route("/", wellKnownRoutes);
  });

  it("returns 200 with draft-hardt-oauth-aauth-protocol fields", async () => {
    const res = await app.request("/.well-known/aauth-resource.json");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issuer).toBe("https://agentbadge.xyz");
    expect(body.jwks_uri).toBe(
      "https://agentbadge.xyz/.well-known/jwks.json",
    );
    expect(body.documentation_uri).toBe(
      "https://agentbadge.xyz/auth.md",
    );
  });
});
