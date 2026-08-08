import { describe, it, expect } from "vitest";
import { wellKnownRoutes } from "../../src/server/routes/well-known";

const app = wellKnownRoutes;

describe("SLICE-49-4: Auth.md + agent_auth block", () => {
  it("serves /auth.md as markdown", async () => {
    const res = await app.request("/auth.md", {
      headers: { Accept: "text/markdown, text/plain, */*" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
  });

  it("contains agent registration instructions", async () => {
    const res = await app.request("/auth.md");
    const text = await res.text();
    expect(text).toContain("agent");
    expect(text).toContain("register");
  });

  it("mentions OAuth Protected Resource endpoint", async () => {
    const res = await app.request("/auth.md");
    const text = await res.text();
    expect(text).toContain("oauth-protected-resource");
  });

  it("mentions Authorization Server endpoint", async () => {
    const res = await app.request("/auth.md");
    const text = await res.text();
    expect(text).toContain("oauth-authorization-server");
  });

  it("mentions supported identity types", async () => {
    const res = await app.request("/auth.md");
    const text = await res.text();
    expect(text).toContain("did:hcs");
    expect(text).toContain("NFT");
  });

  it("mentions credential types", async () => {
    const res = await app.request("/auth.md");
    const text = await res.text();
    expect(text).toContain("passport");
    expect(text).toContain("HCS");
  });

  it("oauth-authorization-server has agent_auth block", async () => {
    const res = await app.request("/.well-known/oauth-authorization-server");
    const body = await res.json();
    expect(body).toHaveProperty("agent_auth");
  });

  it("agent_auth has register_uri", async () => {
    const res = await app.request("/.well-known/oauth-authorization-server");
    const body = await res.json();
    expect(body.agent_auth).toHaveProperty("register_uri");
    expect(body.agent_auth.register_uri).toContain("/auth.md");
  });

  it("agent_auth has supported_identity_types", async () => {
    const res = await app.request("/.well-known/oauth-authorization-server");
    const body = await res.json();
    expect(body.agent_auth).toHaveProperty("supported_identity_types");
    expect(Array.isArray(body.agent_auth.supported_identity_types)).toBe(true);
    expect(body.agent_auth.supported_identity_types.length).toBeGreaterThan(0);
  });

  it("agent_auth has credential_types", async () => {
    const res = await app.request("/.well-known/oauth-authorization-server");
    const body = await res.json();
    expect(body.agent_auth).toHaveProperty("credential_types");
    expect(Array.isArray(body.agent_auth.credential_types)).toBe(true);
    expect(body.agent_auth.credential_types.length).toBeGreaterThan(0);
  });

  it("agent_auth has claims_endpoint", async () => {
    const res = await app.request("/.well-known/oauth-authorization-server");
    const body = await res.json();
    expect(body.agent_auth).toHaveProperty("claims_endpoint");
  });

  it("agent_auth has revocation_endpoint", async () => {
    const res = await app.request("/.well-known/oauth-authorization-server");
    const body = await res.json();
    expect(body.agent_auth).toHaveProperty("revocation_endpoint");
  });
});
