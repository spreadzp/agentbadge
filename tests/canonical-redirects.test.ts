import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  hostNormalizationMiddleware,
  trailingSlashMiddleware,
} from "../src/server/middleware/canonical-redirects";

// SLICE-131-1: trailing-slash + host redirects must emit https Location behind proxy
function createApp() {
  const app = new Hono();
  app.use(hostNormalizationMiddleware());
  app.use(trailingSlashMiddleware());
  app.get("/agent-guide", (c) => c.text("ok"));
  app.get("/path", (c) => c.text("ok"));
  return app;
}

describe("SLICE-131-1: canonical redirects force https", () => {
  const app = createApp();

  it("trailing-slash redirect on prod host emits https Location", async () => {
    const res = await app.request("http://agentbadge.xyz/agent-guide/");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://agentbadge.xyz/agent-guide");
  });

  it("trailing-slash redirect preserves query string", async () => {
    const res = await app.request("http://agentbadge.xyz/path/?a=1&b=2");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://agentbadge.xyz/path?a=1&b=2");
  });

  it("www host redirect emits https apex Location", async () => {
    const res = await app.request("http://www.agentbadge.xyz/path?x=1", {
      headers: { host: "www.agentbadge.xyz" },
    });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://agentbadge.xyz/path?x=1");
  });

  it("fly.dev host redirect emits https apex Location", async () => {
    const res = await app.request("http://agent-passport-hedera.fly.dev/path", {
      headers: { host: "agent-passport-hedera.fly.dev" },
    });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://agentbadge.xyz/path");
  });

  it("localhost keeps original scheme (dev not broken)", async () => {
    const res = await app.request("http://localhost:4021/path/");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("http://localhost:4021/path");
  });

  it("non-trailing-slash path passes through", async () => {
    const res = await app.request("http://agentbadge.xyz/path");
    expect(res.status).toBe(200);
  });

  it("root path / is not redirected", async () => {
    const res = await app.request("http://agentbadge.xyz/");
    expect(res.status).toBe(404); // no route registered for / in test app — but no redirect
  });
});
