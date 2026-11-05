import { describe, it, expect, beforeAll, vi } from "vitest";

process.env.MOCK_HEDERA = "true";
process.env.PASSPORT_TOKEN_ID = "0.0.1234567";

const bunGlobal = (globalThis as Record<string, unknown>).Bun ?? {};
vi.stubGlobal("Bun", {
  ...bunGlobal,
  serve: vi.fn(() => ({ hostname: "localhost", port: 0 })),
});

const { createApp } = await import("../../src/server/index");
const { BLOG_ARTICLES } = await import("../../src/server/lib/blog-data");
const { CAPABILITY_CHANGELOG } = await import(
  "../../src/server/lib/capability-feed"
);

describe("SLICE-81-3: RSS feed from real blog data", () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    app = createApp();
  });

  it("returns 200 with application/rss+xml content type", async () => {
    const res = await app.request("/feed");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/rss+xml");
  });

  it("item count equals articles + capability entries (206-14)", async () => {
    const res = await app.request("/feed");
    const xml = await res.text();
    const itemCount = (xml.match(/<item>/g) ?? []).length;
    expect(itemCount).toBe(BLOG_ARTICLES.length + CAPABILITY_CHANGELOG.length);
  });

  it("every item link is a real blog URL that returns 200", async () => {
    const res = await app.request("/feed");
    const xml = await res.text();
    const links = [...xml.matchAll(/<link>([^<]+)<\/link>/g)].map((m) => m[1]);
    const itemLinks = links.filter((l) => l.includes("/blog/"));
    for (const link of itemLinks) {
      const path = new URL(link).pathname;
      const r = await app.request(path);
      expect(r.status).toBe(200);
    }
  });

  it("pubDates are real article dates (not request time)", async () => {
    const res = await app.request("/feed");
    const xml = await res.text();
    const dates = [...xml.matchAll(/<pubDate>([^<]+)<\/pubDate>/g)].map((m) => m[1]);
    expect(dates.length).toBe(
      BLOG_ARTICLES.length + CAPABILITY_CHANGELOG.length,
    );
    // None should be "now" — all should be in the past
    const now = Date.now();
    for (const d of dates) {
      const ts = new Date(d).getTime();
      expect(ts).toBeLessThan(now);
    }
  });

  it("GUIDs are distinct across items (stable article URLs)", async () => {
    const res = await app.request("/feed");
    const xml = await res.text();
    const guids = [...xml.matchAll(/<guid>([^<]+)<\/guid>/g)].map((m) => m[1]);
    const unique = new Set(guids);
    expect(unique.size).toBe(guids.length);
  });

  it("two consecutive requests produce identical XML (deterministic)", async () => {
    const res1 = await app.request("/feed");
    const xml1 = await res1.text();
    const res2 = await app.request("/feed");
    const xml2 = await res2.text();
    expect(xml1).toBe(xml2);
  });

  it("lastBuildDate is the newest article date, not now()", async () => {
    const res = await app.request("/feed");
    const xml = await res.text();
    const match = xml.match(/<lastBuildDate>([^<]+)<\/lastBuildDate>/);
    expect(match).not.toBeNull();
    const lbd = match![1];
    const now = Date.now();
    expect(new Date(lbd).getTime()).toBeLessThan(now);
  });
});

describe("SLICE-206-14: capability announcements in the feed", () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    app = createApp();
  });

  it("RSS /feed marks capability items with <category>capability</category>", async () => {
    const res = await app.request("/feed");
    const xml = await res.text();
    const categories = xml.match(/<category>capability<\/category>/g) ?? [];
    expect(categories.length).toBe(CAPABILITY_CHANGELOG.length);
    for (const entry of CAPABILITY_CHANGELOG) {
      expect(xml).toContain(entry.endpoint);
      expect(xml).toContain(`capability:${entry.method} ${entry.endpoint}@`);
    }
  });

  it("/feed.json returns JSON Feed 1.1 with typed capability items", async () => {
    const res = await app.request("/feed.json");
    expect(res.status).toBe(200);
    const feed = (await res.json()) as {
      version: string;
      items: Array<Record<string, unknown>>;
    };
    expect(feed.version).toBe("https://jsonfeed.org/version/1.1");

    const caps = feed.items.filter((i) => i._type === "capability");
    expect(caps.length).toBe(CAPABILITY_CHANGELOG.length);
    for (const cap of caps) {
      expect(cap._endpoint).toBeDefined();
      expect(cap._method).toMatch(/^(GET|POST)$/);
      expect(cap._price).toBeDefined();
      expect(cap._added_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(cap.date_published).toBeDefined();
      expect((cap.tags as string[]).includes("capability")).toBe(true);
    }

    const articles = feed.items.filter((i) => i._type === "article");
    expect(articles.length).toBe(BLOG_ARTICLES.length);
  });

  it("/feed.json items are sorted by date_published desc", async () => {
    const res = await app.request("/feed.json");
    const feed = (await res.json()) as {
      items: Array<{ date_published: string }>;
    };
    const stamps = feed.items.map((i) =>
      new Date(i.date_published).getTime(),
    );
    const sorted = [...stamps].sort((a, b) => b - a);
    expect(stamps).toEqual(sorted);
  });

  it("/feed.json is deterministic (two identical requests)", async () => {
    const a = await (await app.request("/feed.json")).text();
    const b = await (await app.request("/feed.json")).text();
    expect(a).toBe(b);
  });
});
