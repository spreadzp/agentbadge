import { describe, it, expect } from "vitest";
import { makeTestApp, setupMockEnv } from "../e2e/helpers";
import { PUBLIC_PAGES } from "../../src/server/lib/page-meta";

setupMockEnv();
const app = makeTestApp();

/**
 * SLICE-234-31: /join onboarding hub + /join-us alias.
 * Prod: /join ×9, /join-us ×9 → 404 (7d). Ops-inbox live question:
 * "how do I list my agent in the discovery directory?" — /join is
 * the canonical URL to answer with.
 */
describe("SLICE-234-31: /join page", () => {
  it("GET /join → 200 HTML", async () => {
    const res = await app.request("/join");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("contains all three audience sections", async () => {
    const html = await (await app.request("/join")).text();
    expect(html).toContain("Developers");
    expect(html).toContain("Businesses");
    expect(html).toContain("Agents");
    expect(html).toContain("Who are you?");
  });

  it("contains the real listing flow — passport → /ui/agents", async () => {
    const html = await (await app.request("/join")).text();
    expect(html).toContain("How to list your agent");
    expect(html).toContain("/passport/request");
    expect(html).toContain("/ui/agents");
    expect(html).toContain("/agent-guide/team/contact");
  });

  it("no fake forms — no <form> posting nowhere", async () => {
    const html = await (await app.request("/join")).text();
    expect(html).not.toContain("<form");
  });

  it("GET /join-us → 301 to /join", async () => {
    const res = await app.request("/join-us");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toContain("/join");
  });

  it("/join is in PUBLIC_PAGES (sitemap source)", () => {
    expect(PUBLIC_PAGES.some((p) => p.path === "/join")).toBe(true);
  });
});
