import { describe, it, expect } from "vitest";

process.env.MOCK_HEDERA = "true";
const { createApp } = await import("../../src/server/index");
const { BLOG_ARTICLES } = await import("../../src/server/lib/blog-data");

// SLICE-259-16: HEAD conneg-parity + Accept: application/json on pages.
// HEAD must run the same negotiation as GET (headers identical, no
// body); application/json is honoured wherever a .json mirror exists
// (/faq.json, /feed.json, /blog/<slug>.json, ...) — 406 elsewhere.

const app = createApp();
const MD = { Accept: "text/markdown" };
const JSON_A = { Accept: "application/json" };

describe("HEAD conneg-parity", () => {
  it("HEAD / + Accept: text/markdown → text/markdown headers, no body", async () => {
    const res = await app.request("/", { method: "HEAD", headers: MD });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(res.headers.get("vary")).toContain("Accept");
    expect(await res.text()).toBe("");
  });

  it("HEAD /faq + Accept: text/markdown → text/markdown headers", async () => {
    const res = await app.request("/faq", { method: "HEAD", headers: MD });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(await res.text()).toBe("");
  });

  it("HEAD /faq + Accept: application/json → application/json headers", async () => {
    const res = await app.request("/faq", { method: "HEAD", headers: JSON_A });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.text()).toBe("");
  });

  it("HEAD / + Accept: application/json → application/json headers", async () => {
    const res = await app.request("/", { method: "HEAD", headers: JSON_A });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.text()).toBe("");
  });

  const article = BLOG_ARTICLES.find((a) => !a.canonical)!;
  it("HEAD blog page + markdown Accept → text/markdown headers", async () => {
    const res = await app.request(`/blog/${article.slug}`, {
      method: "HEAD",
      headers: MD,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(await res.text()).toBe("");
  });
});

describe("Accept: application/json on pages", () => {
  it("GET /faq + application/json → 200 structured Q&A JSON", async () => {
    const res = await app.request("/faq", { headers: JSON_A });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("vary")).toContain("Accept");
    const body = await res.json();
    expect(body.entries.length).toBeGreaterThan(40);
    expect(body.entries[0].question).toBeTruthy();
    expect(body.entries[0].answer).toBeTruthy();
  });

  it("GET /faq.json mirror exists and matches negotiated body", async () => {
    const mirror = await app.request("/faq.json");
    expect(mirror.status).toBe(200);
    expect(mirror.headers.get("content-type")).toContain("application/json");
    const negotiated = await app.request("/faq", { headers: JSON_A });
    expect(await negotiated.json()).toEqual(await mirror.json());
  });

  it("GET /feed + application/json → JSON feed via /feed.json mirror", async () => {
    const res = await app.request("/feed", { headers: JSON_A });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.version).toContain("jsonfeed.org");
  });

  it("GET page without .json mirror + application/json → 406", async () => {
    const res = await app.request("/contact", { headers: JSON_A });
    expect(res.status).toBe(406);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("json Accept on non-negotiable path is untouched (/api/rules stays its own JSON)", async () => {
    const res = await app.request("/api/rules", { headers: JSON_A });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
